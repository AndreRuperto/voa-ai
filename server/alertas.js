// Um alerta da AeroAPI por voo (R1), apagado depois do `in`, do cancelamento, de 24 h da chegada (R2)
// ou quando sai o último inscrito (R3). Ver docs/02-v1-alertas.md e docs/04-integracao-aeroapi.md.
import { lerVoo, dataDaPartida } from './voos.js';
import { lerConfig } from './limites.js';

/** Erro de regra de negócio com código e HTTP do contrato. */
export class ErroRegra extends Error {
  constructor(http, codigo, mensagem) {
    super(mensagem);
    this.http = http;
    this.codigo = codigo;
  }
}

/** URL do webhook com o segredo (target_url). */
export function urlWebhook() {
  const base = (process.env.URL_PUBLICA || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/webhook/aeroapi/${process.env.WEBHOOK_SEGREDO || ''}`;
}

/** Corpo do POST /alerts (doc 04). `start`/`end` = data do voo no fuso da partida. */
export function corpoDoAlerta(d, { modoEconomico = false } = {}) {
  const data = dataDaPartida(d);
  return {
    ident: d.ident_icao || d.ident,
    origin: d.origin?.code_icao || d.origin?.code || null,
    destination: d.destination?.code_icao || d.destination?.code || null,
    start: data,
    end: data,
    eta: 40,
    events: {
      out: false, off: true, on: true, in: !modoEconomico,
      departure: false, arrival: false, cancelled: true, diverted: true, filed: false,
    },
    target_url: urlWebhook(),
  };
}

const travas = new Map();
/** Serializa operações de alerta por voo (evita dois alertas para o mesmo voo). */
async function comTrava(chave, fn) {
  const antes = travas.get(chave) || Promise.resolve();
  let liberar;
  const minha = new Promise((r) => { liberar = r; });
  const fila = antes.then(() => minha);
  travas.set(chave, fila);
  await antes;
  try {
    return await fn();
  } finally {
    liberar();
    if (travas.get(chave) === fila) travas.delete(chave);
  }
}

/** Alertas criados hoje (UTC), para o teto diário. */
function alertasCriadosHoje(db, agora) {
  const dia = agora.toISOString().slice(0, 10);
  return db.prepare("SELECT COUNT(*) n FROM CHAMADA_API WHERE endpoint = 'POST /alerts' AND status BETWEEN 200 AND 299 AND substr(em, 1, 10) = ?").get(dia).n;
}

/**
 * Garante que o voo tem um alerta na AeroAPI (R1: um por voo, compartilhado).
 * @returns {Promise<number>} alert_id
 */
export async function garantirAlerta(ctx, faFlightId, { quem } = {}) {
  return comTrava(faFlightId, async () => {
    const v = lerVoo(ctx.db, faFlightId);
    if (!v) throw new ErroRegra(404, 'nao_encontrado', 'Voo não encontrado.');
    if (v.alert_id) return v.alert_id;
    const cfg = lerConfig(ctx.db);
    if (alertasCriadosHoje(ctx.db, ctx.agora()) >= cfg.teto_alertas_dia) {
      throw new ErroRegra(429, 'limite', 'Hoje já chegamos ao número máximo de voos acompanhados. Tente de novo amanhã.');
    }
    const id = await ctx.aeroapi.criarAlerta(corpoDoAlerta(v.dados, { modoEconomico: cfg.modo_economico }), { fa_flight_id: faFlightId, quem });
    ctx.db.prepare('UPDATE VOO SET alert_id = ? WHERE fa_flight_id = ?').run(id, faFlightId);
    return id;
  });
}

/** Apaga o alerta do voo na AeroAPI (se houver) e limpa o alert_id. */
export async function apagarAlertaDoVoo(ctx, faFlightId, { quem } = {}) {
  return comTrava(faFlightId, async () => {
    const v = lerVoo(ctx.db, faFlightId);
    if (!v?.alert_id) return false;
    await ctx.aeroapi.apagarAlerta(v.alert_id, { fa_flight_id: faFlightId, quem });
    ctx.db.prepare('UPDATE VOO SET alert_id = NULL WHERE fa_flight_id = ?').run(faFlightId);
    return true;
  });
}

/** R3: se ninguém mais acompanha o voo, apaga o alerta. Erros da AeroAPI só vão para o log. */
export async function apagarSeUltimo(ctx, faFlightId, op = {}) {
  const { n } = ctx.db.prepare('SELECT COUNT(*) n FROM INSCRICAO WHERE fa_flight_id = ?').get(faFlightId);
  if (n > 0) return false;
  try {
    return await apagarAlertaDoVoo(ctx, faFlightId, op);
  } catch (e) {
    console.warn(`[alertas] não consegui apagar o alerta de ${faFlightId}: ${e.message}`);
    return false;
  }
}
