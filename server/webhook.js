// Tratamento do callback da AeroAPI (docs/04-integracao-aeroapi.md, "Tratamento no servidor").
import { timingSafeEqual } from 'node:crypto';
import { registrarChamada } from './aeroapi.js';
import { apagarAlertaDoVoo } from './alertas.js';
import { EVENTO_NORMALIZADO } from './mensagens.js';
import { notificarVoo } from './push.js';
import { lerVoo, salvarVoo, vooDaLinha, atrasoMin } from './voos.js';

/** Horário real que identifica cada evento na deduplicação (R7). */
const CAMPO_TEMPO = { out: 'actual_out', off: 'actual_off', on: 'actual_on', in: 'actual_in' };

/** Diferença mínima (min) entre dois avisos de atraso, para não avisar a cada minuto de oscilação. */
export const PASSO_ATRASO_MIN = 5;
export const ATRASO_MINIMO = 15;

/** Compara o segredo da URL em tempo constante. */
export function segredoValido(recebido) {
  const certo = process.env.WEBHOOK_SEGREDO || '';
  if (!certo || typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido), b = Buffer.from(certo);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Detecção de atraso (doc 02): chegada estimada − prevista ≥ 15 min e mudou desde o último aviso.
 * @returns {Promise<boolean>} se avisou
 */
export async function verificarAtraso(ctx, faFlightId) {
  const l = lerVoo(ctx.db, faFlightId);
  if (!l) return false;
  const d = l.dados;
  if (d.cancelled || d.diverted || d.actual_on || d.actual_in) return false;
  const atraso = atrasoMin(d);
  if (atraso < ATRASO_MINIMO) return false;
  const ultimo = l.ultimo_atraso_avisado;
  if (ultimo != null && Math.abs(atraso - ultimo) < PASSO_ATRASO_MIN) return false;
  ctx.db.prepare('UPDATE VOO SET ultimo_atraso_avisado = ? WHERE fa_flight_id = ?').run(atraso, faFlightId);
  await notificarVoo(ctx, 'atraso', vooDaLinha(l, ctx.agora()));
  return true;
}

/**
 * Avisa um evento uma vez só (R7), pela chave alert_id|evento|horário.
 * @returns {Promise<boolean>} se avisou
 */
export async function avisarUmaVez(ctx, { chave, evento, faFlightId, eventoId = null, desvio = null }) {
  const ja = ctx.db.prepare('SELECT 1 FROM EVENTO WHERE chave = ? AND notificado = 1 LIMIT 1').get(chave);
  if (ja) return false;
  const l = lerVoo(ctx.db, faFlightId);
  if (!l) return false;
  if (eventoId != null) ctx.db.prepare('UPDATE EVENTO SET notificado = 1 WHERE id = ?').run(eventoId);
  else ctx.db.prepare('INSERT INTO EVENTO (fa_flight_id, alert_id, event_code, chave, payload_json, recebido_em, notificado) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(faFlightId, l.alert_id, evento, chave, '{"origem":"agendador"}', ctx.agora().toISOString());
  await notificarVoo(ctx, evento, vooDaLinha(l, ctx.agora()), { desvio });
  return true;
}

/** Chave de deduplicação de um evento. */
export function chaveEvento(alertId, evento, flight) {
  const campo = CAMPO_TEMPO[evento];
  return `${alertId ?? ''}|${evento}|${(campo && flight?.[campo]) || ''}`;
}

/**
 * Processa um callback já aceito (o 200 já foi respondido).
 * @param {object} ctx
 * @param {object} corpo JSON recebido
 */
export async function processarWebhook(ctx, corpo) {
  const db = ctx.db;
  const agora = ctx.agora();
  const flight = corpo && typeof corpo.flight === 'object' ? corpo.flight : null;
  const codigo = typeof corpo?.event_code === 'string' ? corpo.event_code : 'desconhecido';
  const alertId = Number.isFinite(Number(corpo?.alert_id)) ? Number(corpo.alert_id) : null;
  let fa = typeof flight?.fa_flight_id === 'string' ? flight.fa_flight_id : null;

  // Cada alerta entregue custa US$ 0,020 (doc 04).
  registrarChamada(db, { tipo: 'alerta_entregue', endpoint: 'POST /webhook/aeroapi', fa_flight_id: fa, ref: codigo }, agora);

  const evento = EVENTO_NORMALIZADO[codigo] || null;
  const chave = chaveEvento(alertId, evento || codigo, flight);
  const { lastInsertRowid: eventoId } = db.prepare(
    'INSERT INTO EVENTO (fa_flight_id, alert_id, event_code, chave, payload_json, recebido_em, notificado) VALUES (?, ?, ?, ?, ?, ?, 0)',
  ).run(fa, alertId, codigo, chave, JSON.stringify(corpo ?? null).slice(0, 100_000), agora.toISOString());

  let atual = fa ? lerVoo(db, fa) : null;
  if (!atual && alertId != null) {
    const porAlerta = db.prepare('SELECT fa_flight_id FROM VOO WHERE alert_id = ?').get(alertId);
    if (porAlerta) { fa = porAlerta.fa_flight_id; atual = lerVoo(db, fa); }
  }
  if (!atual || !flight) return { resultado: 'voo_desconhecido' };

  const destinoAntes = atual.dados.destination;
  const { linha } = salvarVoo(db, { ...flight, fa_flight_id: fa }, agora);

  let avisou = false;
  if (evento) {
    let desvio = null;
    if (evento === 'diverted') {
      const depois = linha.dados.destination;
      const mudou = depois && destinoAntes && (depois.code_icao || depois.code) !== (destinoAntes.code_icao || destinoAntes.code);
      if (mudou) desvio = vooDaLinha(linha, agora).destino;
    }
    avisou = await avisarUmaVez(ctx, { chave, evento, faFlightId: fa, eventoId: Number(eventoId), desvio });
  }

  if (!['on', 'in', 'cancelled', 'diverted'].includes(evento)) await verificarAtraso(ctx, fa);

  if (evento === 'in' || evento === 'cancelled') {
    try {
      await apagarAlertaDoVoo(ctx, fa);
    } catch (e) {
      console.warn(`[webhook] não consegui apagar o alerta de ${fa}: ${e.message}`);
    }
  }
  return { resultado: avisou ? 'avisado' : evento ? 'repetido' : 'ignorado' };
}
