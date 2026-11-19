// Tarefas periódicas: checagens de atraso antes da partida (3 h, 1 h, 15 min), rede de segurança
// 30 min depois da chegada estimada, apagar alertas 24 h depois da chegada (R2) e limpar dados 7 dias
// depois do pouso. Ver docs/02-v1-alertas.md e docs/04-integracao-aeroapi.md.
// Sem alertas no plano (Personal, ADR-009), o agendador também consulta os voos nos momentos que importam
// e avisa decolagem, pouso, chegada ao portão, cancelamento e desvio.
import { apagarAlertaDoVoo } from './alertas.js';
import { lerConfig } from './limites.js';
import { lerVoo, salvarVoo, chegada, vooDaLinha } from './voos.js';
import { verificarAtraso, avisarUmaVez, chaveEvento } from './webhook.js';
import { verificarGasto } from './avisosgasto.js';
import { verificarConexoes } from './conexoes.js';

const MIN = 60_000;
const MARCOS_ANTES = [{ nome: '3h', min: 180 }, { nome: '1h', min: 60 }, { nome: '15m', min: 15 }];
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/** Consulta o voo na AeroAPI e grava. */
async function atualizar(ctx, fa) {
  const f = await ctx.aeroapi.vooPorId(fa, { quem: 'agendador' });
  if (f) salvarVoo(ctx.db, f, ctx.agora());
  return f;
}

const primeiro = (...isos) => isos.map(ms).find(Number.isFinite) ?? NaN;

/**
 * De quanto em quanto tempo (min) consultar um voo sem alerta, ou null para não consultar agora.
 * Mais vezes perto da decolagem e do pouso, poucas no cruzeiro; antes de 20 min da saída ficam só os marcos.
 * Custo (US$ 0,005 cada): ~14 consultas num voo de 2 h, ~25 num de 12 h. Ver ADR-009.
 */
export function intervaloDeConsulta(d, t, { modoEconomico = false } = {}) {
  if (!d || d.cancelled || d.actual_in) return null;
  if (d.actual_on) {                                    // pousou: espera a chegada ao portão por até 90 min
    if (modoEconomico) return null;
    return t <= ms(d.actual_on) + 90 * MIN ? 10 : null;
  }
  if (d.actual_off) {                                   // voando
    const fim = primeiro(d.estimated_on, d.scheduled_on, d.estimated_in, d.scheduled_in);
    if (!Number.isFinite(fim)) return 45;
    if (t < fim - 40 * MIN) return 45;
    return t <= fim + 120 * MIN ? 10 : 30;
  }
  const saida = primeiro(d.estimated_off, d.estimated_out, d.scheduled_off, d.scheduled_out);
  if (!Number.isFinite(saida) || t < saida - 20 * MIN) return null;
  if (t <= saida + 60 * MIN) return 10;
  return t <= saida + 12 * 60 * MIN ? 30 : null;        // atraso longo: de meia em meia hora, por até 12 h
}

/** Ordem dos eventos do voo: avisa só o mais recente que ainda não foi avisado. */
const SEQUENCIA = [['in', 'actual_in'], ['on', 'actual_on'], ['off', 'actual_off']];

/**
 * Voo sem alerta: avisa o que já está nos dados e ainda não foi avisado. Olha o estado, não a diferença,
 * porque quem abre a página do voo também atualiza os dados e "engoliria" a mudança.
 * Só conta eventos depois da primeira inscrição (quem entra com o avião no ar não recebe "decolou").
 * A chave de deduplicação é a mesma da rede de segurança (alert_id vazio), então nada se repete.
 */
export async function avisarPendentes(ctx, fa, { modoEconomico = false } = {}) {
  const l = lerVoo(ctx.db, fa);
  if (!l || l.alert_id) return null;
  const d = l.dados;
  if (d.cancelled) {
    return (await avisarUmaVez(ctx, { chave: chaveEvento(null, 'cancelled', d), evento: 'cancelled', faFlightId: fa })) ? 'cancelled' : null;
  }
  if (d.diverted) {   // avisa o desvio uma vez; depois, segue avisando o pouso no aeroporto alternativo
    const desvio = vooDaLinha(l, ctx.agora()).destino;
    if (await avisarUmaVez(ctx, { chave: chaveEvento(null, 'diverted', d), evento: 'diverted', faFlightId: fa, desvio })) return 'diverted';
  }
  const { desde } = ctx.db.prepare('SELECT MIN(criado_em) desde FROM INSCRICAO WHERE fa_flight_id = ?').get(fa);
  const inicio = ms(desde);
  for (const [evento, campo] of SEQUENCIA) {
    if (evento === 'in' && modoEconomico) continue;
    const quando = ms(d[campo]);
    if (!Number.isFinite(quando)) continue;
    if (Number.isFinite(inicio) && quando < inicio) break;   // aconteceu antes de alguém acompanhar
    const avisou = await avisarUmaVez(ctx, { chave: chaveEvento(null, evento, d), evento, faFlightId: fa });
    if (evento !== 'off') return avisou ? evento : null;      // pousou: atraso não importa mais
    if (avisou) return 'off';
    break;
  }
  await verificarAtraso(ctx, fa);
  return null;
}

function marcar(db, fa, feitos) {
  db.prepare('UPDATE VOO SET checagens = ? WHERE fa_flight_id = ?').run(JSON.stringify(feitos), fa);
}

/** Uma rodada do agendador. Exportada para testes e para rodar à mão. */
export async function rodarCiclo(ctx) {
  const db = ctx.db;
  const agora = ctx.agora();
  const t = agora.getTime();
  const temChave = ctx.aeroapi.temChave();
  const cfg = lerConfig(db);

  // 0. Gasto do mês: avisa os admins a 50% e 80% do crédito, no teto mensal e no teto duro.
  try { await verificarGasto(ctx); } catch (e) { console.warn(`[agendador] avisos de gasto: ${e.message}`); }

  // Voos com alguém inscrito e ainda não terminados.
  const voos = db.prepare(`SELECT DISTINCT v.fa_flight_id FROM VOO v JOIN INSCRICAO i ON i.fa_flight_id = v.fa_flight_id
                           WHERE v.cancelado = 0 AND v.actual_in IS NULL`).all();
  for (const { fa_flight_id: fa } of voos) {
    try {
      const l = lerVoo(db, fa);
      const d = l.dados;
      const feitos = JSON.parse(l.checagens || '[]');

      // 1. Antes da decolagem: 3 h, 1 h e 15 min antes da partida prevista. Só o marco mais recente que venceu.
      const saida = ms(d.scheduled_out || d.scheduled_off);
      if (temChave && !d.actual_off && Number.isFinite(saida) && t < saida + 30 * MIN) {
        const vencidos = MARCOS_ANTES.filter((m) => t >= saida - m.min * MIN && !feitos.includes(m.nome));
        if (vencidos.length) {
          for (const m of vencidos) feitos.push(m.nome);
          marcar(db, fa, feitos);
          await atualizar(ctx, fa);
          if (l.alert_id) await verificarAtraso(ctx, fa);
          else await avisarPendentes(ctx, fa, { modoEconomico: cfg.modo_economico });
        }
      }

      // 1b. Sem alerta (plano Personal): consulta nos momentos que importam e avisa o que mudou.
      if (temChave && !l.alert_id) {
        const atual = lerVoo(db, fa);
        const iv = intervaloDeConsulta(atual.dados, t, { modoEconomico: cfg.modo_economico });
        const idade = t - ms(atual.atualizado_em);
        if (iv != null && !(idade < iv * MIN)) await atualizar(ctx, fa);
        // Mesmo sem consultar agora: a página do voo pode ter trazido um evento novo.
        await avisarPendentes(ctx, fa, { modoEconomico: cfg.modo_economico });
      }

      // 2. Rede de segurança: 30 min depois da chegada estimada, se o pouso não chegou pelo webhook.
      const fim = ms(chegada(d).estimada);
      if (temChave && !d.actual_on && !feitos.includes('rede') && Number.isFinite(fim) && t >= fim + 30 * MIN) {
        feitos.push('rede');
        marcar(db, fa, feitos);
        const f = await atualizar(ctx, fa);
        const nova = lerVoo(db, fa);
        if (f && nova.dados.actual_on) {
          await avisarUmaVez(ctx, { chave: chaveEvento(nova.alert_id, 'on', nova.dados), evento: 'on', faFlightId: fa });
        } else if (f && nova.dados.cancelled) {
          await avisarUmaVez(ctx, { chave: chaveEvento(nova.alert_id, 'cancelled', nova.dados), evento: 'cancelled', faFlightId: fa });
        }
      }
    } catch (e) {
      console.warn(`[agendador] ${fa}: ${e.message}`);
    }
  }

  // 2b. Viagens com conexão: avisa se a troca de avião ficou apertada ou deve ser perdida (sem custo na AeroAPI).
  try { await verificarConexoes(ctx); } catch (e) { console.warn(`[agendador] conexões: ${e.message}`); }

  // 3. R2: apagar alertas 24 h depois da chegada prevista (ou já terminados).
  for (const l of db.prepare('SELECT fa_flight_id, scheduled_in, estimated_in, cancelado, actual_in FROM VOO WHERE alert_id IS NOT NULL').all()) {
    const fimPrev = ms(l.estimated_in || l.scheduled_in);
    const venceu = Number.isFinite(fimPrev) && t >= fimPrev + 24 * 60 * MIN;
    if (!(venceu || l.cancelado || l.actual_in)) continue;
    if (!temChave) continue;
    try {
      await apagarAlertaDoVoo(ctx, l.fa_flight_id, { quem: 'agendador' });
    } catch (e) {
      console.warn(`[agendador] alerta de ${l.fa_flight_id}: ${e.message}`);
    }
  }

  // 4. Privacidade: apagar voos, inscrições e eventos 7 dias depois do pouso (ou da chegada prevista).
  const corte = new Date(t - 7 * 24 * 60 * MIN).toISOString();
  const velhos = db.prepare(`SELECT fa_flight_id FROM VOO WHERE alert_id IS NULL
                             AND COALESCE(actual_in, actual_on, estimated_in, scheduled_in, scheduled_out) < ?`).all(corte);
  for (const { fa_flight_id: fa } of velhos) {
    db.prepare('DELETE FROM EVENTO WHERE fa_flight_id = ?').run(fa);
    db.prepare('DELETE FROM INSCRICAO WHERE fa_flight_id = ?').run(fa);
    db.prepare('DELETE FROM VOO WHERE fa_flight_id = ?').run(fa);
  }
  db.prepare('DELETE FROM EVENTO WHERE fa_flight_id IS NULL AND recebido_em < ?').run(corte);

  // 5. Arrumação: sessões e cache vencidos.
  db.prepare('DELETE FROM SESSAO WHERE expira_em < ?').run(agora.toISOString());
  db.prepare('DELETE FROM CACHE WHERE expira_em < ?').run(agora.toISOString());
  db.prepare('DELETE FROM AVISO_CONEXAO WHERE em < ?').run(corte);
  return { voos: voos.length, apagados: velhos.length };
}

/** Liga o agendador. Devolve uma função para parar. */
export function iniciarAgendador(ctx, { intervaloMs = 60_000 } = {}) {
  let rodando = false;
  const passo = async () => {
    if (rodando) return;
    rodando = true;
    try { await rodarCiclo(ctx); } catch (e) { console.warn(`[agendador] ${e.message}`); } finally { rodando = false; }
  };
  const id = setInterval(passo, intervaloMs);
  id.unref?.();
  setTimeout(passo, 5_000).unref?.();
  return () => clearInterval(id);
}
