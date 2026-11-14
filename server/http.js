// Utilitários HTTP: roteador mínimo, JSON, cookies, corpo e arquivos estáticos.
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { ErroAeroapi } from './aeroapi.js';
import { ErroRegra } from './alertas.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
};

/** Mensagens padrão para os códigos de erro do contrato. */
const MENSAGENS = {
  invalido: 'Pedido inválido.',
  nao_encontrado: 'Não encontrado.',
  limite: 'Você chegou ao limite.',
  pausado: 'Este recurso está pausado agora.',
  proibido: 'Pedido recusado.',
  interno: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
};

export function enviarJson(res, status, corpo, cabecalhos = {}) {
  const texto = corpo === undefined ? '' : JSON.stringify(corpo);
  res.writeHead(status, {
    ...(texto ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    'cache-control': 'no-store',
    ...cabecalhos,
  });
  res.end(texto);
}

export function enviarErro(res, status, erro, mensagem) {
  enviarJson(res, status, { erro, mensagem: mensagem || MENSAGENS[erro] || 'Erro.' });
}

/** Converte exceções conhecidas na resposta de erro do contrato. */
export function tratarErro(res, e) {
  if (res.headersSent) return;
  if (e instanceof ErroRegra || e instanceof ErroAeroapi) return enviarErro(res, e.http, e.codigo, e.message);
  if (e?.codigo && e?.http) return enviarErro(res, e.http, e.codigo, e.message);
  console.error('[http] erro interno:', e);
  enviarErro(res, 500, 'interno');
}

export function lerCookies(req) {
  const r = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (k) try { r[k] = decodeURIComponent(parte.slice(i + 1).trim()); } catch { /* cookie malformado */ }
  }
  return r;
}

/** Monta um Set-Cookie. `maxAgeDias` 0 apaga. */
export function cookie(nome, valor, { maxAgeDias, seguro }) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.round(maxAgeDias * 86400)}`];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function adicionarCookie(res, valor) {
  const atual = res.getHeader('set-cookie');
  res.setHeader('set-cookie', atual ? [].concat(atual, valor) : [valor]);
}

/** Lê o corpo como JSON (até `limite` bytes). Lança ErroRegra 400 se não for JSON. */
export function lerJson(req, limite = 100_000) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) { reject(new ErroRegra(413, 'invalido', 'Corpo grande demais.')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const texto = Buffer.concat(partes).toString('utf8');
      if (!texto.trim()) return resolve({});
      try { resolve(JSON.parse(texto)); } catch { reject(new ErroRegra(400, 'invalido', 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

/**
 * Roteador mínimo: `rota('GET', '/api/voos/:id', fn)`.
 * @returns {{rota: Function, achar: (metodo:string, caminho:string) => ({fn: Function, params: object}|{metodos: string[]}|null)}}
 */
export function criarRoteador() {
  const rotas = [];
  return {
    rota(metodo, padrao, fn) {
      const nomes = [];
      const re = new RegExp('^' + padrao.replace(/\/:([a-z_]+)/g, (_, n) => { nomes.push(n); return '/([^/]+)'; }) + '/?$');
      rotas.push({ metodo, re, nomes, fn });
    },
    achar(metodo, caminho) {
      const metodos = [];
      for (const r of rotas) {
        const m = r.re.exec(caminho);
        if (!m) continue;
        if (r.metodo !== metodo && !(metodo === 'HEAD' && r.metodo === 'GET')) { metodos.push(r.metodo); continue; }
        const params = {};
        r.nomes.forEach((n, i) => { try { params[n] = decodeURIComponent(m[i + 1]); } catch { params[n] = m[i + 1]; } });
        return { fn: r.fn, params };
      }
      return metodos.length ? { metodos } : null;
    },
  };
}

/** Caminho de arquivo dentro de `raiz`, ou null se sair dela. */
export function caminhoSeguro(raiz, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('\0')) return null;
  const alvo = normalize(join(raiz, p));
  const base = normalize(raiz + sep);
  if (alvo !== normalize(raiz) && !alvo.startsWith(base)) return null;
  if (alvo.slice(normalize(raiz).length).split(sep).some((s) => s.startsWith('.') && s.length > 1)) return null;
  return alvo;
}

/** Serve um arquivo, se existir. Devolve false se não existe. */
export function servirArquivo(req, res, arquivo) {
  let st;
  try { st = statSync(arquivo); } catch { return false; }
  if (st.isDirectory()) return servirArquivo(req, res, join(arquivo, 'index.html'));
  if (!st.isFile()) return false;
  const ext = extname(arquivo).toLowerCase();
  // Os nomes dos arquivos não têm versão: HTML, CSS e JS sempre revalidam (ETag → 304),
  // senão um deploy novo convive uma hora com CSS/JS velhos no navegador. Só imagens e fontes ficam em cache.
  const estavel = ['.png', '.svg', '.ico', '.woff2', '.json'].includes(ext);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); res.end(); return true; }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': estavel ? 'public, max-age=86400' : 'no-cache',
    etag,
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(arquivo).pipe(res);
  return true;
}
