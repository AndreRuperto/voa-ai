// Painel de admin: /api/admin/* (404 para quem não está em ADMIN_EMAILS). Ver docs/12 e docs/13.
import { enviarJson, lerJson } from '../http.js';
import { lerConfig, gravarConfig } from '../limites.js';
import { lerVoo, vooDaLinha, vooAtivo } from '../voos.js';
import { apagarAlertaDoVoo, ErroRegra } from '../alertas.js';
import { voosAtivos } from '../inscricoes.js';
import { apagarConta, auditar } from '../contas.js';

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** Resumo do mês (AAAA-MM). */
export function resumoDoMes(ctx, mes) {
  const db = ctx.db;
  const agora = ctx.agora();
  const credito = Number(process.env.CREDITO_MENSAL_USD) || 5;
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

  r.rota('GET', '/api/admin/voos', ({ ctx, res }) => {
    const db = ctx.db;
    const agora = ctx.agora();
    const linhas = db.prepare(`
      SELECT v.fa_flight_id, v.alert_id,
        (SELECT COUNT(*) FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id) inscritos,
        (SELECT COUNT(*) FROM CHAMADA_API c WHERE c.fa_flight_id = v.fa_flight_id AND c.tipo = 'alerta_entregue') entregues,
        (SELECT COALESCE(SUM(custo), 0) FROM CHAMADA_API c WHERE c.fa_flight_id = v.fa_flight_id) custo
      FROM VOO v
      WHERE v.alert_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM INSCRICAO i WHERE i.fa_flight_id = v.fa_flight_id)
         OR EXISTS (SELECT 1 FROM EVENTO e WHERE e.fa_flight_id = v.fa_flight_id)
      ORDER BY v.scheduled_out DESC
      LIMIT 500`).all();
    enviarJson(res, 200, {
      voos: linhas.map((l) => ({
        voo: vooDaLinha(lerVoo(db, l.fa_flight_id), agora),
        inscritos: l.inscritos,
        alertas_entregues: l.entregues,
        custo_usd: r6(l.custo),
        alert_id: l.alert_id,
      })),
    });
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
