// Tarefas periódicas: checagens de atraso antes da partida (3 h, 1 h, 15 min), rede de segurança
// 30 min depois da chegada estimada, apagar alertas 24 h depois da chegada (R2) e limpar dados 7 dias
// depois do pouso. Ver docs/02-v1-alertas.md e docs/04-integracao-aeroapi.md.
import { apagarAlertaDoVoo } from './alertas.js';
import { lerVoo, salvarVoo, chegada } from './voos.js';
import { verificarAtraso, avisarUmaVez, chaveEvento } from './webhook.js';

const MIN = 60_000;
const MARCOS_ANTES = [{ nome: '3h', min: 180 }, { nome: '1h', min: 60 }, { nome: '15m', min: 15 }];
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/** Consulta o voo na AeroAPI e grava. */
async function atualizar(ctx, fa) {
  const f = await ctx.aeroapi.vooPorId(fa, { quem: 'agendador' });
  if (f) salvarVoo(ctx.db, f, ctx.agora());
  return f;
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
          await verificarAtraso(ctx, fa);
        }
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
