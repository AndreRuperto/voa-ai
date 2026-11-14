// Voo da AeroAPI → objeto `Voo` do contrato (docs/13-api.md), e persistência na tabela VOO.
import { aeroporto, companhia } from './lugares.js';

const MIN = 60_000;
const CAMPOS_HORARIO = [
  'scheduled_out', 'estimated_out', 'actual_out',
  'scheduled_off', 'estimated_off', 'actual_off',
  'scheduled_on', 'estimated_on', 'actual_on',
  'scheduled_in', 'estimated_in', 'actual_in',
];
const CAMPOS_SIMPLES = [
  'ident', 'ident_icao', 'ident_iata', 'operator', 'operator_icao', 'operator_iata',
  'aircraft_type', 'registration', 'status', 'progress_percent', 'cancelled', 'diverted',
];

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const ok = (n) => Number.isFinite(n);

/** Normaliza um aeroporto da AeroAPI (objeto ou só o código) para {code, code_icao, code_iata, name, city, timezone}. */
function normalizarAeroporto(a, icao, iata) {
  if (a && typeof a === 'object') return a;
  if (!a && !icao && !iata) return null;
  const cod = String(a || icao || iata);
  return { code: cod, code_icao: icao || (cod.length === 4 ? cod : null), code_iata: iata || (cod.length === 3 ? cod : null) };
}

/**
 * Junta um voo vindo da AeroAPI (de /flights ou do webhook) com o que já está no banco.
 * Valores nulos novos não apagam valores conhecidos.
 * @param {object} novo
 * @param {object|null} [anterior]
 */
export function normalizarVoo(novo, anterior = null) {
  const r = { ...(anterior || {}) };
  r.fa_flight_id = novo.fa_flight_id || r.fa_flight_id;
  for (const c of [...CAMPOS_HORARIO, ...CAMPOS_SIMPLES]) {
    if (novo[c] !== undefined && novo[c] !== null) r[c] = novo[c];
    else if (r[c] === undefined) r[c] = null;
  }
  for (const lado of ['origin', 'destination']) {
    const n = normalizarAeroporto(novo[lado], novo[`${lado}_icao`], novo[`${lado}_iata`]);
    if (!n) continue;
    const ant = r[lado];
    const mesmo = ant && (ant.code === n.code || (n.code_icao && ant.code_icao === n.code_icao) || (n.code_iata && ant.code_iata === n.code_iata));
    r[lado] = mesmo ? { ...ant, ...Object.fromEntries(Object.entries(n).filter(([, v]) => v != null)) } : n;
  }
  r.cancelled = Boolean(r.cancelled);
  r.diverted = Boolean(r.diverted);
  return r;
}

/** Monta o objeto de aeroporto do contrato, completando pela lista estática. */
function lugar(a) {
  if (!a) return { iata: null, icao: null, nome: null, cidade: null, lat: null, lon: null, fuso: null };
  const est = aeroporto(a.code_icao) || aeroporto(a.code_iata) || aeroporto(a.code);
  return {
    iata: a.code_iata || est?.iata || null,
    icao: a.code_icao || est?.icao || null,
    nome: est?.nome || a.name || a.code || null,
    cidade: est?.cidade || a.city || null,
    lat: est?.lat ?? null,
    lon: est?.lon ?? null,
    fuso: a.timezone || est?.fuso || null,
  };
}

/** Chegada (portão) estimada e prevista, com o pouso como reserva. */
export function chegada(d) {
  return {
    prevista: d.scheduled_in || d.scheduled_on || null,
    estimada: d.estimated_in || d.estimated_on || d.scheduled_in || d.scheduled_on || null,
  };
}

/** Atraso da chegada em minutos (estimada − prevista), arredondado e nunca negativo. */
export function atrasoMin(d) {
  const c = chegada(d);
  const dif = ms(c.estimada) - ms(c.prevista);
  return ok(dif) ? Math.max(0, Math.round(dif / MIN)) : 0;
}

/** Atraso da saída (estimada − prevista) em minutos, podendo ser negativo. */
function atrasoSaidaMin(d) {
  const prev = d.scheduled_out || d.scheduled_off;
  const est = d.estimated_out || d.estimated_off;
  const dif = ms(est) - ms(prev);
  return ok(dif) ? Math.round(dif / MIN) : 0;
}

/**
 * Estado do voo, calculado pelos horários reais e por cancelled/diverted.
 * `no_portao`: embarque (até 30 min da saída estimada) ou já fora do portão, taxiando, sem decolar.
 * @returns {'previsto'|'no_portao'|'em_voo'|'pousou'|'no_portao_destino'|'atrasado'|'cancelado'|'desviado'}
 */
export function calcularEstado(d, agora = new Date()) {
  if (d.cancelled) return 'cancelado';
  if (d.diverted) return 'desviado';
  if (d.actual_in) return 'no_portao_destino';
  if (d.actual_on) return 'pousou';
  if (d.actual_off) return 'em_voo';
  if (atrasoSaidaMin(d) >= 15) return 'atrasado';
  const saida = ms(d.estimated_out || d.scheduled_out || d.estimated_off || d.scheduled_off);
  if (d.actual_out || (ok(saida) && agora.getTime() >= saida - 30 * MIN)) return 'no_portao';
  return 'previsto';
}

function calcularProgresso(d, estado, agora) {
  if (estado === 'pousou' || estado === 'no_portao_destino') return 1;
  if (estado !== 'em_voo') return 0;
  const ini = ms(d.actual_off);
  const fim = ms(d.estimated_on || d.scheduled_on || d.estimated_in || d.scheduled_in);
  if (ok(ini) && ok(fim) && fim > ini) {
    const p = (agora.getTime() - ini) / (fim - ini);
    return Math.round(Math.min(0.99, Math.max(0, p)) * 100) / 100;
  }
  return ok(Number(d.progress_percent)) ? Math.min(0.99, Number(d.progress_percent) / 100) : 0;
}

/**
 * @param {object} d voo normalizado (formato AeroAPI)
 * @param {{agora?: Date, atualizado_em?: string}} [op]
 */
export function mapearVoo(d, { agora = new Date(), atualizado_em } = {}) {
  const estado = calcularEstado(d, agora);
  const cia = d.operator_icao || d.operator;
  return {
    fa_flight_id: d.fa_flight_id,
    ident: d.ident_icao || d.ident,
    ident_iata: d.ident_iata || null,
    companhia: companhia(cia) || cia || null,
    aeronave: d.aircraft_type || null,
    origem: lugar(d.origin),
    destino: lugar(d.destination),
    horarios: {
      saida_prevista: d.scheduled_out || null,
      saida_estimada: d.estimated_out || null,
      saida_real: d.actual_out || null,
      decolagem_real: d.actual_off || null,
      pouso_previsto: d.scheduled_on || null,
      pouso_estimado: d.estimated_on || null,
      pouso_real: d.actual_on || null,
      chegada_prevista: d.scheduled_in || null,
      chegada_estimada: d.estimated_in || null,
      chegada_real: d.actual_in || null,
    },
    estado,
    atraso_min: atrasoMin(d),
    progresso: calcularProgresso(d, estado, agora),
    atualizado_em: atualizado_em || agora.toISOString(),
  };
}

/** O voo ainda conta como "ativo" (limite de voos, agendador)? */
export function vooAtivo(d, agora = new Date()) {
  if (d.cancelled || d.actual_in) return false;
  if (d.actual_on && agora.getTime() - ms(d.actual_on) > 2 * 60 * MIN) return false;
  const fim = ms(chegada(d).estimada);
  return !(ok(fim) && agora.getTime() > fim + 24 * 60 * MIN);
}

/** Data local (AAAA-MM-DD) de um instante num fuso. */
export function dataNoFuso(iso, fuso) {
  const t = ms(iso);
  if (!ok(t)) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuso || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/** Data local da partida, no fuso do aeroporto de origem. */
export function dataDaPartida(d) {
  const fuso = d.origin?.timezone || lugar(d.origin).fuso;
  return dataNoFuso(d.scheduled_out || d.scheduled_off || d.estimated_out, fuso);
}

// ---------- banco ----------

/** Lê a linha do VOO (com `dados` já em objeto) ou null. */
export function lerVoo(db, faFlightId) {
  const l = db.prepare('SELECT * FROM VOO WHERE fa_flight_id = ?').get(faFlightId);
  if (!l) return null;
  return { ...l, dados: JSON.parse(l.dados_json) };
}

/**
 * Grava (insere ou atualiza) um voo vindo da AeroAPI, juntando com o que já existe.
 * @returns {{linha: object, dados: object}}
 */
export function salvarVoo(db, novo, agora = new Date()) {
  const ant = lerVoo(db, novo.fa_flight_id);
  const d = normalizarVoo(novo, ant?.dados || null);
  db.prepare(`
    INSERT INTO VOO (fa_flight_id, ident, origem, destino, scheduled_out, estimated_out, actual_out, actual_off,
                     scheduled_in, estimated_in, actual_on, actual_in, cancelado, desviado, status, dados_json, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fa_flight_id) DO UPDATE SET
      ident = excluded.ident, origem = excluded.origem, destino = excluded.destino,
      scheduled_out = excluded.scheduled_out, estimated_out = excluded.estimated_out, actual_out = excluded.actual_out,
      actual_off = excluded.actual_off, scheduled_in = excluded.scheduled_in, estimated_in = excluded.estimated_in,
      actual_on = excluded.actual_on, actual_in = excluded.actual_in, cancelado = excluded.cancelado,
      desviado = excluded.desviado, status = excluded.status, dados_json = excluded.dados_json,
      atualizado_em = excluded.atualizado_em
  `).run(
    d.fa_flight_id, d.ident_icao || d.ident || '?',
    d.origin?.code_icao || d.origin?.code || null, d.destination?.code_icao || d.destination?.code || null,
    d.scheduled_out, d.estimated_out, d.actual_out, d.actual_off,
    d.scheduled_in || d.scheduled_on, chegada(d).estimada, d.actual_on, d.actual_in,
    d.cancelled ? 1 : 0, d.diverted ? 1 : 0, d.status || null,
    JSON.stringify(d), agora.toISOString(),
  );
  return { linha: lerVoo(db, d.fa_flight_id), dados: d };
}

/** Voo do contrato a partir da linha do banco. */
export function vooDaLinha(linha, agora = new Date()) {
  return mapearVoo(linha.dados, { agora, atualizado_em: linha.atualizado_em });
}
