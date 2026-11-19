// Painel de admin: /api/admin/* (404 para quem não está em ADMIN_EMAILS). Ver docs/12 e docs/13.
import { enviarJson, lerJson } from '../http.js';
import { lerConfig, gravarConfig } from '../limites.js';
import { lerVoo, salvarVoo, vooDaLinha, vooAtivo } from '../voos.js';
import { lerCache, gravarCache } from '../db.js';
import { aeroporto } from '../lugares.js';
import { ErroAeroapi, MENSAGEM_SEM_CHAVE } from '../aeroapi.js';
import { apagarAlertaDoVoo, ErroRegra } from '../alertas.js';
import { voosAtivos } from '../inscricoes.js';
import { apagarConta, auditar } from '../contas.js';
import { avisosDoMes, avisarAdmins, aparelhosDosAdmins } from '../avisosgasto.js';
import { creditoMensal } from '../limites.js';

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const HORA = 3_600_000;

/** Fase do voo agora, para agrupar a lista do admin. */
export function faseDoVoo(d) {
  if (d.cancelled) return 'cancelado';
  if (d.actual_on || d.actual_in) return 'pousou';
  if (d.actual_off) return 'no_ar';
  return 'para_decolar';
}
const ORDEM_FASE = { no_ar: 0, para_decolar: 1, pousou: 2, cancelado: 3 };

/** Intervalo mínimo entre duas consultas pagas das partidas do mesmo aeroporto (evita clique duplo). */
export const PARTIDAS_CACHE_MS = 10 * 60_000;

/** Resumo do mês (AAAA-MM). */
export function resumoDoMes(ctx, mes) {
  const db = ctx.db;
  const agora = ctx.agora();
  const credito = creditoMensal();
  const cfg = lerConfig(db);
  const gasto = db.prepare('SELECT COALESCE(SUM(custo), 0) s FROM CHAMADA_API WHERE substr(em, 1, 7) = ?').get(mes).s;
  const [ano, m] = mes.split('-').map(Number);
  const diasNoMes = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const mesAtual = agora.toISOString().slice(0, 7);
  let projecao = gasto;
  if (mes === mesAtual) {
    const decorrido = (agora.getTime() - Date.UTC(ano, m - 1, 1)) / 86_400_000;
    projecao = decorrido > 0 ? (gasto / Math.max(decorrido, 1)) * diasNoMes : gasto;
  }
  const porDia = db.prepare('SELECT substr(em, 1, 10) dia, SUM(custo) usd FROM CHAMADA_API WHERE substr(em, 1, 7) = ? GROUP BY dia ORDER BY dia').all(mes);
  const porTipo = db.prepare('SELECT tipo, COUNT(*) chamadas, SUM(custo) usd FROM CHAMADA_API WHERE substr(em, 1, 7) = ? GROUP BY tipo ORDER BY usd DESC').all(mes);
  const ativos = db.prepare('SELECT DISTINCT fa_flight_id FROM INSCRICAO').all()
    .filter(({ fa_flight_id: fa }) => { const v = lerVoo(db, fa); return v && vooAtivo(v.dados, agora); }).length;
  return {
    mes,
    credito_usd: credito,
    teto_mensal_usd: cfg.teto_mensal_usd,
    teto_duro_usd: cfg.teto_duro_usd,
    avisos_gasto: avisosDoMes(db, mes),
    gasto_usd: r6(gasto),
    projecao_usd: r6(projecao),
    por_dia: porDia.map((l) => ({ dia: l.dia, usd: r6(l.usd) })),
    por_tipo: porTipo.map((l) => ({ tipo: l.tipo, chamadas: l.chamadas, usd: r6(l.usd) })),
    voos_ativos: ativos,
    alertas_entregues: db.prepare("SELECT COUNT(*) n FROM CHAMADA_API WHERE tipo = 'alerta_entregue' AND substr(em, 1, 7) = ?").get(mes).n,
    contas: db.prepare('SELECT COUNT(*) n FROM USUARIO').get().n,
    buscas_rota: db.prepare('SELECT COUNT(DISTINCT busca_id) n FROM BUSCA_ROTA WHERE substr(em, 1, 7) = ?').get(mes).n,
  };
}

/** @param {ReturnType<import('../http.js').criarRoteador>} r */
export function registrarAdmin(r) {
  r.rota('GET', '/api/admin/resumo', ({ ctx, res, url }) => {
    const mes = url.searchParams.get('mes') || ctx.agora().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroRegra(400, 'invalido', 'Mês inválido. Use AAAA-MM.');
    enviarJson(res, 200, resumoDoMes(ctx, mes));
  });

  r.rota('GET', '/api/admin/avisos', ({ ctx, res }) => {
    enviarJson(res, 200, { aparelhos_com_push: aparelhosDosAdmins(ctx.db).length });
  });

  r.rota('POST', '/api/admin/avisos/teste', async ({ ctx, res }) => {
    const enviados = await avisarAdmins(ctx, { titulo: 'Aviso de teste', corpo: 'Os avisos de gasto da AeroAPI chegam assim neste aparelho.', tag: 'teste' });
    enviarJson(res, 200, { enviados });
  });

  // Voos que o app já conhece (buscados, acompanhados ou trazidos pelas partidas), sem chamar a AeroAPI.
  // Sem ?todos=1, só os de agora: partida nas últimas 24 h ou nas próximas 24 h, ou com alguém acompanhando.
  r.rota('GET', '/api/admin/voos', ({ ctx, res, url }) => {
    const db = ctx.db;
    const agora = ctx.agora();
    const todos = url.searchParams.get('todos') === '1';
    const de = new Date(agora.getTime() - 24 * HORA).toISOString(), ate = new Date(agora.getTime() + 24 * HORA).toISOString();
    const linhas = db.prepare(`
      SELECT v.fa_flight_id, v.alert_id,
        (SELECT COUNT(*) FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id) inscritos,
        (SELECT COUNT(DISTINCT i.usuario_id) FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id AND i.usuario_id IS NOT NULL) contas,
        (SELECT COUNT(*) FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id AND i.usuario_id IS NULL) aparelhos,
        (SELECT GROUP_CONCAT(DISTINCT i.apelido) FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id AND i.apelido IS NOT NULL AND i.apelido <> '') apelidos,
        (SELECT COUNT(*) FROM CHAMADA_API c WHERE c.fa_flight_id = v.fa_flight_id AND c.tipo = 'alerta_entregue') entregues,
        (SELECT COUNT(*) FROM CHAMADA_API c WHERE c.fa_flight_id = v.fa_flight_id AND c.tipo <> 'alerta_entregue') consultas,
        (SELECT COALESCE(SUM(custo), 0) FROM CHAMADA_API c WHERE c.fa_flight_id = v.fa_flight_id) custo
      FROM VOO v
      WHERE ? OR v.alert_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id)
         OR COALESCE(v.scheduled_out, v.scheduled_in) BETWEEN ? AND ?
      LIMIT 1000`).all(todos ? 1 : 0, de, ate);
    const voos = linhas.map((l) => {
      const linha = lerVoo(db, l.fa_flight_id);
      return {
        voo: vooDaLinha(linha, agora),
        fase: faseDoVoo(linha.dados),
        inscritos: l.inscritos,
        quem: { apelidos: l.apelidos ? String(l.apelidos).split(',') : [], contas: l.contas, aparelhos: l.aparelhos },
        consultas: l.consultas,
        alertas_entregues: l.entregues,
        custo_usd: r6(l.custo),
        alert_id: l.alert_id,
        _saida: linha.dados.estimated_off || linha.dados.scheduled_off || linha.dados.scheduled_out || '',
      };
    });
    // No ar e para decolar: o próximo primeiro. Pousados e cancelados: o mais recente primeiro.
    voos.sort((a, b) => (ORDEM_FASE[a.fase] - ORDEM_FASE[b.fase])
      || (a.fase === 'pousou' || a.fase === 'cancelado' ? b._saida.localeCompare(a._saida) : a._saida.localeCompare(b._saida)));
    const contagem = { no_ar: 0, para_decolar: 0, pousou: 0, cancelado: 0 };
    for (const v of voos) { contagem[v.fase]++; delete v._saida; }
    enviarJson(res, 200, { voos, contagem });
  });

  // Partidas de um aeroporto, sob demanda (o admin aperta o botão): uma página paga, até 15 voos, guardados no banco.
  // Protegida pelo teto duro como qualquer chamada; o mesmo aeroporto em menos de 10 min sai do cache, de graça.
  r.rota('POST', '/api/admin/partidas', async ({ ctx, req, res, quem }) => {
    const corpo = await lerJson(req);
    const codigo = String(corpo?.aeroporto || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(codigo)) throw new ErroRegra(400, 'invalido', 'Informe o aeroporto com o código de 3 letras (ex.: GRU).');
    const a = aeroporto(codigo);
    if (!a?.icao) throw new ErroRegra(400, 'invalido', `Não achamos o aeroporto ${codigo}.`);
    const agora = ctx.agora();
    const chave = `partidas:${a.icao}`;
    const guardado = lerCache(ctx.db, chave, agora);
    if (guardado) { enviarJson(res, 200, { ...guardado, aeroporto: a.iata, em_cache: true, custo_usd: 0 }); return; }
    if (!ctx.aeroapi.temChave()) throw new ErroAeroapi('aeroapi_sem_chave', MENSAGEM_SEM_CHAVE);
    const antes = ctx.db.prepare('SELECT COALESCE(SUM(custo), 0) s FROM CHAMADA_API').get().s;
    const brutos = await ctx.aeroapi.partidas(a.icao, {
      start: new Date(agora.getTime() - 30 * 60_000).toISOString().slice(0, 19) + 'Z',
      end: new Date(agora.getTime() + 6 * HORA).toISOString().slice(0, 19) + 'Z',
      quem: `admin:${quem.usuario.email}`,
    });
    const ids = brutos.filter((f) => f?.fa_flight_id).map((f) => salvarVoo(ctx.db, f, agora).linha.fa_flight_id);
    const custo = r6(ctx.db.prepare('SELECT COALESCE(SUM(custo), 0) s FROM CHAMADA_API').get().s - antes);
    const resposta = { aeroporto: a.iata, voos: ids.length, atualizado_em: agora.toISOString() };
    gravarCache(ctx.db, chave, resposta, PARTIDAS_CACHE_MS, agora);
    auditar(ctx.db, quem.usuario.email, 'partidas', { aeroporto: a.iata, voos: ids.length, custo_usd: custo }, agora);
    enviarJson(res, 200, { ...resposta, em_cache: false, custo_usd: custo });
  });

  r.rota('POST', '/api/admin/voos/:id/parar', async ({ ctx, res, params, quem }) => {
    const v = lerVoo(ctx.db, params.id);
    if (!v) throw new ErroRegra(404, 'nao_encontrado', 'Voo não encontrado.');
    if (v.alert_id) await apagarAlertaDoVoo(ctx, params.id, { quem: `admin:${quem.usuario.email}` });
    const { changes } = ctx.db.prepare('DELETE FROM INSCRICAO WHERE fa_flight_id = ?').run(params.id);
    auditar(ctx.db, quem.usuario.email, 'parar_voo', { fa_flight_id: params.id, alert_id: v.alert_id, inscricoes: Number(changes) }, ctx.agora());
    enviarJson(res, 204);
  });

  r.rota('GET', '/api/admin/contas', ({ ctx, res }) => {
    const db = ctx.db;
    const agora = ctx.agora();
    const mes = agora.toISOString().slice(0, 7);
    const contas = db.prepare('SELECT * FROM USUARIO ORDER BY ultimo_acesso DESC').all().map((u) => ({
      id: u.id,
      email: u.email,
      nome: u.nome,
      foto: u.foto || null,
      voos_ativos: voosAtivos(db, { aparelhoId: '', usuario: u }, agora),
      buscas_mes: db.prepare('SELECT COUNT(DISTINCT busca_id) n FROM BUSCA_ROTA WHERE quem = ? AND substr(em, 1, 7) = ?').get(`u:${u.id}`, mes).n,
      ultimo_acesso: u.ultimo_acesso,
      bloqueado: Boolean(u.bloqueado),
    }));
    enviarJson(res, 200, { contas });
  });

  r.rota('POST', '/api/admin/contas/:id/bloquear', async ({ ctx, req, res, params, quem }) => {
    const corpo = await lerJson(req);
    if (typeof corpo.bloqueado !== 'boolean') throw new ErroRegra(400, 'invalido', 'Envie {"bloqueado": true|false}.');
    const u = ctx.db.prepare('SELECT id, email FROM USUARIO WHERE id = ?').get(params.id);
    if (!u) throw new ErroRegra(404, 'nao_encontrado', 'Conta não encontrada.');
    ctx.db.prepare('UPDATE USUARIO SET bloqueado = ? WHERE id = ?').run(corpo.bloqueado ? 1 : 0, u.id);
    if (corpo.bloqueado) ctx.db.prepare('DELETE FROM SESSAO WHERE usuario_id = ?').run(u.id);
    auditar(ctx.db, quem.usuario.email, corpo.bloqueado ? 'bloquear_conta' : 'desbloquear_conta', { id: u.id, email: u.email }, ctx.agora());
    enviarJson(res, 204);
  });

  r.rota('DELETE', '/api/admin/contas/:id', ({ ctx, res, params, quem }) => {
    const u = ctx.db.prepare('SELECT id, email FROM USUARIO WHERE id = ?').get(params.id);
    if (!u) throw new ErroRegra(404, 'nao_encontrado', 'Conta não encontrada.');
    apagarConta(ctx.db, u.id);
    auditar(ctx.db, quem.usuario.email, 'apagar_conta', { id: u.id, email: u.email }, ctx.agora());
    enviarJson(res, 204);
  });

  r.rota('GET', '/api/admin/rotas', ({ ctx, res }) => {
    const db = ctx.db;
    const rotas = db.prepare(`
      SELECT b.origem de, b.destino para, COUNT(*) buscas, SUM(b.cache) acertos_cache,
        (SELECT COALESCE(SUM(custo), 0) FROM CHAMADA_API c WHERE c.tipo = 'rota' AND c.ref = b.origem || '-' || b.destino) custo
      FROM BUSCA_ROTA b GROUP BY b.origem, b.destino ORDER BY buscas DESC LIMIT 200`).all();
    enviarJson(res, 200, { rotas: rotas.map((l) => ({ de: l.de, para: l.para, buscas: l.buscas, acertos_cache: l.acertos_cache, custo_usd: r6(l.custo) })) });
  });

  r.rota('GET', '/api/admin/config', ({ ctx, res }) => {
    const auditoria = ctx.db.prepare('SELECT em, admin_email, acao, detalhe FROM AUDITORIA ORDER BY id DESC LIMIT 100').all();
    enviarJson(res, 200, { config: lerConfig(ctx.db), auditoria });
  });

  r.rota('PUT', '/api/admin/config', async ({ ctx, req, res, quem }) => {
    const r2 = gravarConfig(ctx.db, await lerJson(req));
    if (!r2.ok) throw new ErroRegra(400, 'invalido', r2.mensagem);
    for (const m of r2.mudancas) auditar(ctx.db, quem.usuario.email, 'mudar_config', m, ctx.agora());
    const auditoria = ctx.db.prepare('SELECT em, admin_email, acao, detalhe FROM AUDITORIA ORDER BY id DESC LIMIT 100').all();
    enviarJson(res, 200, { config: lerConfig(ctx.db), auditoria });
  });
}
