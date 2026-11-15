// Rotas públicas de /api (docs/13-api.md).
import { enviarJson, lerJson, cookie, adicionarCookie } from '../http.js';
import { listarPaises, aeroportosDoPais } from '../lugares.js';
import { lerConfig, limitesPara } from '../limites.js';
import { buscarPorIdent, obterVoo, buscarRota, buscasRotaHoje } from '../consultas.js';
import { vooDaLinha } from '../voos.js';
import { listarInscricoes, criarInscricao, ligarPush, apagarInscricao, voosAtivos, rotuloQuem, guardarPushNoAparelho } from '../inscricoes.js';
import { lerPushSubscription } from '../push.js';
import { entrar, sair, apagarConta, ehAdmin, SESSAO_DIAS } from '../contas.js';
import { ErroRegra } from '../alertas.js';

/** Corpo de /api/eu. */
export function respostaEu(ctx, q) {
  const agora = ctx.agora();
  const u = q.usuario;
  return {
    conta: u ? { nome: u.nome, email: u.email, foto: u.foto, admin: ehAdmin(u) } : null,
    limites: limitesPara(ctx.db, Boolean(u)),
    uso: { voos: voosAtivos(ctx.db, q, agora), buscas_rota_hoje: buscasRotaHoje(ctx.db, rotuloQuem(q), agora) },
  };
}

const seguro = () => /^https:/i.test(process.env.URL_PUBLICA || '');

/** @param {ReturnType<import('../http.js').criarRoteador>} r */
export function registrarApi(r) {
  r.rota('GET', '/api/config', ({ ctx, res }) => {
    const c = lerConfig(ctx.db);
    enviarJson(res, 200, {
      google_client_id: process.env.GOOGLE_CLIENT_ID || null,
      vapid_publica: process.env.VAPID_PUBLICA || null,
      aeroapi: ctx.aeroapi.temChave(),
      simulada: !!ctx.simulada,
      limites: {
        voos_anonimo: c.limite_voos_anonimo,
        voos_conta: c.limite_voos_conta,
        buscas_rota_anonimo: c.limite_rota_anonimo,
        buscas_rota_conta: c.limite_rota_conta,
        rota_pausada: c.rota_pausada,
      },
    });
  });

  r.rota('GET', '/api/eu', ({ ctx, res, quem }) => enviarJson(res, 200, respostaEu(ctx, quem)));

  r.rota('DELETE', '/api/eu', ({ ctx, res, quem, sessaoId }) => {
    if (!quem.usuario) throw new ErroRegra(401, 'sem_sessao', 'Você não entrou com uma conta.');
    apagarConta(ctx.db, quem.usuario.id);
    if (sessaoId) adicionarCookie(res, cookie('sessao', '', { maxAgeDias: 0, seguro: seguro() }));
    enviarJson(res, 204);
  });

  r.rota('POST', '/api/sessao', async ({ ctx, req, res, quem }) => {
    const corpo = await lerJson(req);
    const { sessaoId, usuario } = await entrar(ctx, quem.aparelhoId, corpo.credential);
    adicionarCookie(res, cookie('sessao', sessaoId, { maxAgeDias: SESSAO_DIAS, seguro: seguro() }));
    enviarJson(res, 200, respostaEu(ctx, { aparelhoId: quem.aparelhoId, usuario }));
  });

  r.rota('DELETE', '/api/sessao', ({ ctx, res, quem, sessaoId }) => {
    sair(ctx.db, sessaoId, quem.aparelhoId);
    adicionarCookie(res, cookie('sessao', '', { maxAgeDias: 0, seguro: seguro() }));
    enviarJson(res, 204);
  });

  r.rota('GET', '/api/voos/buscar', async ({ ctx, res, url, quem }) => {
    const voos = await buscarPorIdent(ctx, { ident: url.searchParams.get('ident'), data: url.searchParams.get('data') }, rotuloQuem(quem));
    enviarJson(res, 200, { voos });
  });

  r.rota('GET', '/api/voos/:id', async ({ ctx, res, params, quem }) => {
    const l = await obterVoo(ctx, params.id, { quem: rotuloQuem(quem) });
    enviarJson(res, 200, vooDaLinha(l, ctx.agora()));
  });

  // Liga o push do aparelho sem voo (usado pelo painel de admin para os avisos de gasto).
  r.rota('PUT', '/api/aparelho/push', async ({ ctx, req, res, quem }) => {
    const push = lerPushSubscription((await lerJson(req))?.push);
    if (!push) throw new ErroRegra(400, 'invalido', 'Inscrição de push inválida.');
    guardarPushNoAparelho(ctx.db, quem.aparelhoId, push);
    enviarJson(res, 204);
  });

  r.rota('GET', '/api/inscricoes', ({ ctx, res, quem }) => enviarJson(res, 200, { inscricoes: listarInscricoes(ctx, quem) }));

  r.rota('POST', '/api/inscricoes', async ({ ctx, req, res, quem }) => {
    const { status, corpo } = await criarInscricao(ctx, quem, await lerJson(req));
    enviarJson(res, status, corpo);
  });

  r.rota('PUT', '/api/inscricoes/:id/push', async ({ ctx, req, res, params, quem }) => {
    ligarPush(ctx, quem, params.id, await lerJson(req));
    enviarJson(res, 204);
  });

  r.rota('DELETE', '/api/inscricoes/:id', async ({ ctx, res, params, quem }) => {
    await apagarInscricao(ctx, quem, params.id);
    enviarJson(res, 204);
  });

  r.rota('GET', '/api/lugares/paises', ({ res }) => enviarJson(res, 200, { paises: listarPaises() }, { 'cache-control': 'public, max-age=86400' }));

  r.rota('GET', '/api/lugares/aeroportos', ({ res, url }) => {
    const pais = url.searchParams.get('pais');
    if (!pais || !/^[A-Za-z]{2}$/.test(pais)) throw new ErroRegra(400, 'invalido', 'Informe o país com o código de 2 letras (ex.: PT).');
    enviarJson(res, 200, { aeroportos: aeroportosDoPais(pais) }, { 'cache-control': 'public, max-age=86400' });
  });

  r.rota('GET', '/api/rotas/buscar', async ({ ctx, res, url, quem }) => {
    if (quem.usuario?.bloqueado) throw new ErroRegra(403, 'bloqueado', 'Esta conta está bloqueada.');
    const p = url.searchParams;
    const pares = await buscarRota(ctx, { de: p.get('de'), para: p.get('para'), data: p.get('data'), escala: p.get('escala') === '1' },
      { quem: rotuloQuem(quem), temConta: Boolean(quem.usuario) });
    enviarJson(res, 200, { pares });
  });
}
