// Consultas que podem chamar a AeroAPI: busca por número (R4, R6), voo por id e busca por rota (doc 12).
import { randomUUID } from 'node:crypto';
import { lerCache, gravarCache } from './db.js';
import { ErroAeroapi, MENSAGEM_SEM_CHAVE } from './aeroapi.js';
import { ErroRegra } from './alertas.js';
import { lerVoo, salvarVoo, vooDaLinha, vooAtivo, dataDaPartida } from './voos.js';
import { lerConfig, limitesPara, gastoDoMes } from './limites.js';
import { aeroporto } from './lugares.js';

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const CACHE_IDENT_MS = 10 * MIN;
const CACHE_ROTA_MS = 30 * MIN;
const CACHE_CANONICAL_MS = 7 * DIA;
const ATUALIZAR_APOS_MS = 15 * MIN;

const diaIso = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * R4: aceita de "hoje" até +2 dias. "Hoje" é o dia UTC de 12 h atrás, para quem está a oeste de Greenwich à noite.
 * @returns {string} a data validada
 */
export function validarData(data, agora) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) {
    throw new ErroRegra(400, 'invalido', 'Data inválida. Use o formato AAAA-MM-DD.');
  }
  const min = diaIso(agora.getTime() - 12 * 60 * MIN);
  const max = diaIso(agora.getTime() + 2 * DIA);
  if (data < min || data > max) throw new ErroRegra(400, 'invalido', 'Dá para acompanhar voos de hoje até daqui a 2 dias.');
  return data;
}

/** Janela larga em UTC que cobre o dia local em qualquer fuso, dentro dos limites da AeroAPI. */
function janela(data, agora) {
  const base = Date.parse(`${data}T00:00:00Z`);
  const ini = Math.max(base - 14 * 60 * MIN, agora.getTime() - 10 * DIA + MIN);
  const fim = Math.min(base + DIA + 14 * 60 * MIN, agora.getTime() + 2 * DIA - MIN);
  const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { start: iso(ini), end: iso(fim) };
}

/** Normaliza o número digitado ("tp 103" → "TP103"). */
export function normalizarIdent(ident) {
  const i = String(ident || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{3,8}$/.test(i) || !/\d/.test(i)) throw new ErroRegra(400, 'invalido', 'Número de voo inválido. Exemplos: TP103, LA3054.');
  return i;
}

const pareceIcao = (i) => /^[A-Z]{3}\d{1,4}[A-Z]?$/.test(i);

function exigirChave(ctx) {
  if (!ctx.aeroapi.temChave()) throw new ErroAeroapi('aeroapi_sem_chave', MENSAGEM_SEM_CHAVE);
}

/** Lê voos do banco por id, na ordem; null se algum sumiu (cache inválido). */
function voosDoBanco(ctx, ids) {
  const r = [];
  for (const id of ids) {
    const l = lerVoo(ctx.db, id);
    if (!l) return null;
    r.push(vooDaLinha(l, ctx.agora()));
  }
  return r;
}

function guardarVoos(ctx, voos, data) {
  const agora = ctx.agora();
  return voos
    .filter((f) => f?.fa_flight_id && dataDaPartida(f) === data)
    .map((f) => salvarVoo(ctx.db, f, agora).linha)
    .sort((a, b) => String(a.dados.scheduled_out || a.dados.scheduled_off).localeCompare(String(b.dados.scheduled_out || b.dados.scheduled_off)));
}

/** IATA → ICAO pelo /canonical, com cache longo. */
async function identIcao(ctx, ident, quem) {
  if (pareceIcao(ident)) return ident;
  const chave = `canonical:${ident}`;
  const c = lerCache(ctx.db, chave, ctx.agora());
  if (c) return c;
  const idents = await ctx.aeroapi.canonical(ident, { quem });
  const r = idents[0] || ident;
  gravarCache(ctx.db, chave, r, CACHE_CANONICAL_MS, ctx.agora());
  return r;
}

/** GET /api/voos/buscar */
export async function buscarPorIdent(ctx, { ident, data }, quem) {
  const agora = ctx.agora();
  const i = normalizarIdent(ident);
  validarData(data, agora);
  const chave = `voos:${i}:${data}`;
  const c = lerCache(ctx.db, chave, agora);
  if (c) {
    const voos = voosDoBanco(ctx, c);
    if (voos) return voos;
  }
  exigirChave(ctx);
  const icao = await identIcao(ctx, i, quem);
  const brutos = await ctx.aeroapi.voosPorIdent(icao, { ...janela(data, agora), quem });
  const linhas = guardarVoos(ctx, brutos, data);
  gravarCache(ctx.db, chave, linhas.map((l) => l.fa_flight_id), CACHE_IDENT_MS, agora);
  return linhas.map((l) => vooDaLinha(l, agora));
}

/**
 * Voo pelo fa_flight_id: do banco; se tiver mais de 15 min e não terminou, atualiza na AeroAPI.
 * Sem chave, devolve o que está no banco (ou 503 se não houver nada).
 * @returns {Promise<object>} linha do VOO
 */
export async function obterVoo(ctx, faFlightId, { quem } = {}) {
  if (typeof faFlightId !== 'string' || !faFlightId || faFlightId.length > 120) throw new ErroRegra(400, 'invalido', 'Voo inválido.');
  const agora = ctx.agora();
  const l = lerVoo(ctx.db, faFlightId);
  const velho = l && agora.getTime() - Date.parse(l.atualizado_em) > (ctx.atualizarAposMs ?? ATUALIZAR_APOS_MS);
  if (l && (!velho || !vooAtivo(l.dados, agora))) return l;
  if (!ctx.aeroapi.temChave()) {
    if (l) return l;
    throw new ErroAeroapi('aeroapi_sem_chave', MENSAGEM_SEM_CHAVE);
  }
  try {
    const f = await ctx.aeroapi.vooPorId(faFlightId, { quem });
    if (!f) {
      if (l) return l;
      throw new ErroRegra(404, 'nao_encontrado', 'Voo não encontrado. Confira o número e a data.');
    }
    return salvarVoo(ctx.db, f, agora).linha;
  } catch (e) {
    if (l && e instanceof ErroAeroapi) return l;
    throw e;
  }
}

export { gastoDoMes };

/** Buscas por rota feitas hoje (UTC) por quem. */
export function buscasRotaHoje(db, quem, agora) {
  return db.prepare('SELECT COUNT(DISTINCT busca_id) n FROM BUSCA_ROTA WHERE quem = ? AND substr(em, 1, 10) = ?').get(quem, diaIso(agora.getTime())).n;
}

function lerAeroportos(lista, lado) {
  const cods = String(lista || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!cods.length) throw new ErroRegra(400, 'invalido', `Escolha pelo menos um aeroporto de ${lado}.`);
  return [...new Set(cods)].map((c) => {
    const a = aeroporto(c);
    if (!a) throw new ErroRegra(400, 'invalido', `Aeroporto desconhecido: ${c}.`);
    return a;
  });
}

/** Viagens com escala de um par, guardadas e filtradas pelo dia da 1ª saída (cache de 30 min por par). */
async function viagensDoPar(ctx, o, d, data, quem) {
  const agora = ctx.agora();
  const chave = `rota1:${o.icao || o.iata}:${d.icao || d.iata}`;
  let pares = lerCache(ctx.db, chave, agora);
  let doCache = Boolean(pares);
  if (pares && pares.some(([a, b]) => !lerVoo(ctx.db, a) || !lerVoo(ctx.db, b))) { pares = null; doCache = false; }
  if (!pares) {
    exigirChave(ctx);
    const brutas = await ctx.aeroapi.viagensComEscala(o.icao || o.iata, d.icao || d.iata, { quem, ref: `${o.iata}-${d.iata}-escala` });
    pares = brutas.filter(([a, b]) => a?.fa_flight_id && b?.fa_flight_id)
      .map(([a, b]) => [salvarVoo(ctx.db, a, agora).linha.fa_flight_id, salvarVoo(ctx.db, b, agora).linha.fa_flight_id]);
    gravarCache(ctx.db, chave, pares, CACHE_ROTA_MS, agora);
  }
  const viagens = pares
    .map(([a, b]) => [lerVoo(ctx.db, a), lerVoo(ctx.db, b)])
    .filter(([a, b]) => a && b && dataDaPartida(a.dados) === data)
    .map(([a, b]) => ({ pernas: [vooDaLinha(a, agora), vooDaLinha(b, agora)] }))
    .sort((x, y) => String(x.pernas[0].horarios.saida_prevista).localeCompare(String(y.pernas[0].horarios.saida_prevista)));
  return { viagens, doCache };
}

/** GET /api/rotas/buscar (com `escala`, também as viagens com uma escala: mais uma consulta por par). */
export async function buscarRota(ctx, { de, para, data, escala = false }, { quem, temConta }) {
  const agora = ctx.agora();
  validarData(data, agora);
  const origens = lerAeroportos(de, 'origem');
  const destinos = lerAeroportos(para, 'destino');
  const pares = [];
  for (const o of origens) for (const d of destinos) if (o.iata !== d.iata) pares.push([o, d]);
  if (!pares.length) throw new ErroRegra(400, 'invalido', 'Origem e destino precisam ser diferentes.');
  if (pares.length > 3) throw new ErroRegra(400, 'invalido', 'No máximo 3 pares de aeroportos por busca.');

  const cfg = lerConfig(ctx.db);
  if (cfg.rota_pausada) throw new ErroRegra(503, 'pausado', 'A busca por rota está pausada agora. Busque pelo número do voo.');
  if (gastoDoMes(ctx.db, agora) >= cfg.teto_mensal_usd) throw new ErroRegra(503, 'pausado', 'A busca por rota está pausada até o mês que vem. Busque pelo número do voo.');
  const lim = limitesPara(ctx.db, temConta).buscas_rota;
  if (buscasRotaHoje(ctx.db, quem, agora) >= lim) {
    throw new ErroRegra(429, 'limite', `Você já fez ${lim} buscas por rota hoje. Busque pelo número do voo ou tente amanhã.`);
  }

  const resultado = [];
  for (const [o, d] of pares) {
    const chave = `rota:${o.icao || o.iata}:${d.icao || d.iata}:${data}`;
    const c = lerCache(ctx.db, chave, agora);
    const doCache = c && voosDoBanco(ctx, c);
    let item;
    if (doCache) item = { de: o.iata, para: d.iata, cache: true, voos: doCache };
    else {
      exigirChave(ctx);
      const brutos = await ctx.aeroapi.voosEntre(o.icao || o.iata, d.icao || d.iata, { ...janela(data, agora), quem, ref: `${o.iata}-${d.iata}` });
      const linhas = guardarVoos(ctx, brutos, data);
      gravarCache(ctx.db, chave, linhas.map((l) => l.fa_flight_id), CACHE_ROTA_MS, agora);
      item = { de: o.iata, para: d.iata, cache: false, voos: linhas.map((l) => vooDaLinha(l, agora)) };
    }
    if (escala) {
      const { viagens, doCache: vc } = await viagensDoPar(ctx, o, d, data, quem);
      item.viagens = viagens;
      item.cache = item.cache && vc;
    }
    resultado.push(item);
  }

  const buscaId = randomUUID();
  const st = ctx.db.prepare('INSERT INTO BUSCA_ROTA (busca_id, origem, destino, data, cache, quem, em) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const p of resultado) st.run(buscaId, p.de, p.para, data, p.cache ? 1 : 0, quem, agora.toISOString());
  return resultado;
}
