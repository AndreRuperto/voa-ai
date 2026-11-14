// Utilitários dos testes: AeroAPI falsa (fetch injetado), servidor numa porta livre e cliente com cookies.
// Os voos daqui existem só nos testes; o servidor de verdade não tem dados falsos.
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco } from '../server/db.js';
import { criarContexto, criarApp } from '../server/app.js';

export const SEGREDO = 'segredo-de-teste-0123456789abcdefghijklmnopqrstuv';

export function prepararAmbiente(extra = {}) {
  Object.assign(process.env, {
    AEROAPI_KEY: 'chave-teste',
    WEBHOOK_SEGREDO: SEGREDO,
    URL_PUBLICA: 'http://localhost:3000',
    GOOGLE_CLIENT_ID: 'cliente-teste.apps.googleusercontent.com',
    ADMIN_EMAILS: 'admin@exemplo.com',
    CREDITO_MENSAL_USD: '5',
    VAPID_PUBLICA: '',
    VAPID_PRIVADA: '',
    ...extra,
  });
}

/** Voo no formato da AeroAPI (/flights). Horários em ISO UTC. */
export function vooAeroapi(sobre = {}) {
  return {
    fa_flight_id: 'TAP103-1763000000-schedule-0001',
    ident: 'TAP103', ident_icao: 'TAP103', ident_iata: 'TP103',
    operator: 'TAP', operator_icao: 'TAP', operator_iata: 'TP',
    aircraft_type: 'A339',
    origin: { code: 'LPPT', code_icao: 'LPPT', code_iata: 'LIS', name: 'Lisbon', city: 'Lisbon', timezone: 'Europe/Lisbon' },
    destination: { code: 'SBGR', code_icao: 'SBGR', code_iata: 'GRU', name: 'Guarulhos', city: 'Sao Paulo', timezone: 'America/Sao_Paulo' },
    scheduled_out: '2026-11-14T15:00:00Z', estimated_out: '2026-11-14T15:00:00Z', actual_out: null,
    scheduled_off: '2026-11-14T15:15:00Z', estimated_off: '2026-11-14T15:15:00Z', actual_off: null,
    scheduled_on: '2026-11-14T23:30:00Z', estimated_on: '2026-11-14T23:30:00Z', actual_on: null,
    scheduled_in: '2026-11-14T23:40:00Z', estimated_in: '2026-11-14T23:40:00Z', actual_in: null,
    cancelled: false, diverted: false, status: 'Scheduled', progress_percent: 0,
    ...sobre,
  };
}

/**
 * AeroAPI falsa. `rotas` mapeia "MÉTODO /caminho" (sem a base) para uma função (url, corpo) → {status, json, headers}.
 * Guarda as chamadas em `chamadas`.
 */
export function aeroapiFalsa(rotas = {}) {
  const chamadas = [];
  let proximoAlerta = 1000;
  const padrao = {
    'POST /alerts': () => ({ status: 201, json: null, headers: { location: `/aeroapi/alerts/${++proximoAlerta}` } }),
    'DELETE /alerts/*': () => ({ status: 204, json: null }),
  };
  async function buscar(url, init = {}) {
    const u = new URL(url);
    const caminho = u.pathname.replace(/^\/aeroapi/, '');
    const metodo = init.method || 'GET';
    const corpo = init.body ? JSON.parse(init.body) : null;
    chamadas.push({ metodo, caminho, query: Object.fromEntries(u.searchParams), corpo, chave: init.headers?.['x-apikey'] });
    const todas = { ...padrao, ...rotas };
    const fn = todas[`${metodo} ${caminho}`] || Object.entries(todas).find(([k]) => {
      const [m, p] = k.split(' ');
      return m === metodo && p.endsWith('*') && caminho.startsWith(p.slice(0, -1));
    })?.[1];
    if (!fn) return new Response(JSON.stringify({ title: 'não simulado' }), { status: 404 });
    const r = await fn(u, corpo);
    return new Response(r.json == null ? (r.status === 204 ? null : '') : JSON.stringify(r.json), { status: r.status, headers: r.headers || {} });
  }
  return { buscar, chamadas };
}

/** Sobe o app numa porta livre. */
export async function subir({ fetch, agora, enviarPush, verificarGoogle } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), '.voa-ai-teste-'));
  mkdirSync(join(pasta, 'admin'));
  writeFileSync(join(pasta, 'index.html'), '<!doctype html><title>Voa Aí</title>');
  writeFileSync(join(pasta, 'admin', 'index.html'), '<!doctype html><title>Admin</title>');
  writeFileSync(join(pasta, 'app.js'), 'export {};');
  const pushes = [];
  const relogio = { atual: agora || new Date('2026-11-14T12:00:00Z') };
  const db = abrirBanco(':memory:');
  const ctx = criarContexto({
    db,
    fetch,
    esperar: async () => {},
    agora: () => relogio.atual,
    enviarPush: enviarPush || (async (sub, payload) => { pushes.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); }),
    verificarGoogle: verificarGoogle || (async (t) => JSON.parse(Buffer.from(t, 'base64url').toString())),
    pastaPublica: pasta,
  });
  const servidor = createServer(criarApp(ctx));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    ctx, db, pushes, relogio, base,
    fechar: () => new Promise((r) => { servidor.close(r); servidor.closeAllConnections?.(); }),
    cliente: () => criarCliente(base),
  };
}

/** Token falso aceito pelo verificador dos testes. */
export const tokenGoogle = (dados) => Buffer.from(JSON.stringify({ email_verified: true, ...dados })).toString('base64url');

/** Cliente HTTP com cookies (um "aparelho"). */
export function criarCliente(base) {
  const jar = {};
  return {
    jar,
    async pedir(caminho, { metodo = 'GET', corpo, csrf = true, cabecalhos = {} } = {}) {
      const h = { ...cabecalhos };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.cookie = cookie;
      if (csrf && metodo !== 'GET') h['x-requested-with'] = 'voa-ai';
      if (corpo !== undefined) h['content-type'] = 'application/json';
      const r = await fetch(base + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo), redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) {
        const [par, ...attrs] = sc.split(';');
        const [k, v] = par.split('=');
        if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) delete jar[k.trim()];
        else jar[k.trim()] = v;
      }
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch { /* não JSON */ }
      return { status: r.status, json, texto, headers: r.headers };
    },
  };
}

export const SUB = (n = 1) => ({ endpoint: `https://push.exemplo.com/sub/${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } });
