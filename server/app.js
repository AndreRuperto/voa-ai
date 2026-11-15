// Monta o contexto (banco, AeroAPI, push) e o tratador HTTP. Separado do index.js para os testes.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from './db.js';
import { criarAeroapi } from './aeroapi.js';
import { criarEnvioWebPush } from './push.js';
import { criarVerificadorGoogle, garantirAparelho, usuarioDaSessao, ehAdmin, APARELHO_DIAS } from './contas.js';
import { criarRoteador, enviarJson, enviarErro, tratarErro, lerCookies, cookie, adicionarCookie, caminhoSeguro, servirArquivo } from './http.js';
import { registrarApi } from './rotas/api.js';
import { registrarAdmin } from './rotas/admin.js';
import { registrarWebhook } from './rotas/webhook.js';
import { criarLimitePorIp, grupoDoPedido, ipDoPedido, mensagemLimiteIp } from './limiteip.js';
import { lerConfig } from './limites.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} [op]
 * @param {import('node:sqlite').DatabaseSync} [op.db]
 * @param {typeof fetch} [op.fetch] fetch usado pela AeroAPI (injetável nos testes)
 * @param {(ms:number)=>Promise<void>} [op.esperar]
 * @param {Function} [op.enviarPush]
 * @param {Function} [op.verificarGoogle]
 * @param {() => Date} [op.agora]
 * @param {string} [op.pastaPublica]
 */
export function criarContexto(op = {}) {
  const agora = op.agora || (() => new Date());
  const db = op.db || abrirBanco(process.env.DB_CAMINHO || join(RAIZ, 'dados', 'voa-ai.sqlite'));
  const tarefas = new Set();
  const ctx = {
    db,
    agora,
    aeroapi: op.aeroapi || criarAeroapi({ db, fetch: op.fetch, esperar: op.esperar, agora }),
    enviarPush: op.enviarPush || criarEnvioWebPush(),
    verificarGoogle: op.verificarGoogle || criarVerificadorGoogle(),
    pastaPublica: op.pastaPublica || join(RAIZ, 'public'),
    limiteIp: op.limiteIp || criarLimitePorIp({ agora: () => agora().getTime() }),
    /** Roda trabalho depois da resposta (ex.: webhook). */
    emSegundoPlano(fn) {
      const p = Promise.resolve().then(fn).catch((e) => console.error('[segundo plano]', e));
      tarefas.add(p);
      p.finally(() => tarefas.delete(p));
      return p;
    },
    /** Espera o trabalho em segundo plano terminar (testes e desligamento). */
    async aguardarTarefas() {
      while (tarefas.size) await Promise.all([...tarefas]);
    },
  };
  return ctx;
}

const PRECISA_CSRF = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** Tratador HTTP do Voa Aí. */
export function criarApp(ctx) {
  const r = criarRoteador();
  r.rota('GET', '/saude', ({ res }) => enviarJson(res, 200, { ok: true }));
  registrarWebhook(r);
  registrarApi(r);
  registrarAdmin(r);

  return async function tratar(req, res) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return enviarErro(res, 400, 'invalido');
    }
    const caminho = url.pathname;
    const metodo = req.method || 'GET';
    try {
      const cookies = lerCookies(req);
      const sessaoId = cookies.sessao || null;
      const ehApi = caminho.startsWith('/api/');
      const ehAdminCaminho = caminho === '/admin' || caminho.startsWith('/admin/') || caminho.startsWith('/api/admin/');

      const usuario = usuarioDaSessao(ctx.db, sessaoId, ctx.agora());
      if (ehAdminCaminho && !ehAdmin(usuario)) return enviarErro(res, 404, 'nao_encontrado');

      if (ehApi && PRECISA_CSRF.has(metodo) && req.headers['x-requested-with'] !== 'voa-ai') {
        return enviarErro(res, 403, 'proibido', 'Falta o cabeçalho X-Requested-With: voa-ai.');
      }

      // Limite por IP antes de qualquer trabalho (admin fica de fora: já é só para ADMIN_EMAILS).
      const grupo = grupoDoPedido(metodo, caminho);
      if (grupo) {
        const max = grupo === 'consulta' ? lerConfig(ctx.db).limite_ip_consultas : undefined;
        const v = ctx.limiteIp.contar(grupo, ipDoPedido(req), max);
        if (!v.ok) {
          res.setHeader('retry-after', String(v.esperarS));
          return enviarErro(res, 429, 'muitos_pedidos', mensagemLimiteIp(v.esperarS));
        }
      }

      let quem = { aparelhoId: null, usuario };
      if (ehApi) {
        const ap = garantirAparelho(ctx.db, cookies.aparelho, ctx.agora());
        if (ap.novo) adicionarCookie(res, cookie('aparelho', ap.id, { maxAgeDias: APARELHO_DIAS, seguro: /^https:/i.test(process.env.URL_PUBLICA || '') }));
        quem = { aparelhoId: ap.id, usuario };
      }

      const achado = r.achar(metodo, caminho);
      if (achado?.fn) return await achado.fn({ ctx, req, res, url, params: achado.params, quem, sessaoId });
      if (achado?.metodos) {
        res.setHeader('allow', achado.metodos.join(', '));
        return enviarErro(res, 405, 'invalido', 'Método não permitido.');
      }
      if (ehApi || caminho.startsWith('/webhook/')) return enviarErro(res, 404, 'nao_encontrado');
      if (metodo !== 'GET' && metodo !== 'HEAD') return enviarErro(res, 405, 'invalido', 'Método não permitido.');

      // Estáticos (public/) e o painel (public/admin/, já liberado acima só para admin).
      const raiz = ctx.pastaPublica;
      if (caminho === '/admin') { res.writeHead(301, { location: '/admin/' }); return res.end(); }
      if (/^\/v\/[^/]+\/?$/.test(caminho)) {
        if (servirArquivo(req, res, join(raiz, 'index.html'))) return;
        return enviarErro(res, 404, 'nao_encontrado');
      }
      const arquivo = caminhoSeguro(raiz, caminho);
      if (arquivo && servirArquivo(req, res, arquivo)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
    } catch (e) {
      tratarErro(res, e);
    }
  };
}
