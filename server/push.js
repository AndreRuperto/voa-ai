// Web Push (VAPID). Inscrições mortas (404/410) são removidas.
import * as webpush from 'web-push';
import { montarMensagem } from './mensagens.js';

/**
 * Envio real pelo web-push. Sem chaves VAPID, só registra no log.
 * @returns {(sub: {endpoint:string, keys:{p256dh:string, auth:string}}, payload: string) => Promise<void>}
 */
export function criarEnvioWebPush() {
  let configurado = null;
  return async (sub, payload) => {
    if (configurado === null) {
      const { VAPID_PUBLICA: pub, VAPID_PRIVADA: priv, VAPID_CONTATO: contato } = process.env;
      configurado = Boolean(pub && priv);
      if (configurado) webpush.setVapidDetails(contato || 'mailto:admin@voa-ai.invalid', pub, priv);
      else console.warn('[push] VAPID_PUBLICA/VAPID_PRIVADA vazias: pushes não serão enviados.');
    }
    if (!configurado) return;
    await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' });
  };
}

/** Converte o PushSubscription do navegador em colunas (ou null se inválido). */
/**
 * Hosts dos serviços de push dos navegadores (Chrome/Edge/Android, Firefox, Safari/iOS, Windows). Endpoint de
 * outro host seria o servidor mandando POST para qualquer lugar (docs/revisao: Web Push, SSRF limitado).
 */
const HOSTS_PUSH = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

export function hostDePushValido(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS_PUSH.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export function lerPushSubscription(p) {
  if (!p || typeof p !== 'object') return null;
  const endpoint = typeof p.endpoint === 'string' ? p.endpoint : null;
  const p256dh = p.keys?.p256dh, auth = p.keys?.auth;
  if (!endpoint || !hostDePushValido(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  return { endpoint, p256dh, auth };
}

/** Quem recebe o aviso de um voo: cada inscrição, mais os aparelhos das contas inscritas. Sem endpoints repetidos. */
export function destinatarios(db, faFlightId) {
  const inscricoes = db.prepare('SELECT * FROM INSCRICAO WHERE fa_flight_id = ? ORDER BY criado_em').all(faFlightId);
  const vistos = new Set();
  const lista = [];
  const add = (apelido, endpoint, p256dh, auth) => {
    if (!endpoint || vistos.has(endpoint)) return;
    vistos.add(endpoint);
    lista.push({ apelido, sub: { endpoint, keys: { p256dh, auth } } });
  };
  for (const i of inscricoes) {
    add(i.apelido, i.push_endpoint, i.push_p256dh, i.push_auth);
    const ap = db.prepare('SELECT push_endpoint, push_p256dh, push_auth FROM APARELHO WHERE id = ?').get(i.aparelho_id);
    if (ap) add(i.apelido, ap.push_endpoint, ap.push_p256dh, ap.push_auth);
    if (i.usuario_id) {
      for (const a of db.prepare('SELECT push_endpoint, push_p256dh, push_auth FROM APARELHO WHERE usuario_id = ?').all(i.usuario_id)) {
        add(i.apelido, a.push_endpoint, a.push_p256dh, a.push_auth);
      }
    }
  }
  return lista;
}

/** Apaga um endpoint morto das inscrições e dos aparelhos. */
export function removerEndpoint(db, endpoint) {
  db.prepare('UPDATE INSCRICAO SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL WHERE push_endpoint = ?').run(endpoint);
  db.prepare('UPDATE APARELHO SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL WHERE push_endpoint = ?').run(endpoint);
}

/**
 * Envia o aviso de um evento a todos os inscritos no voo.
 * Payload JSON: {titulo, corpo, url, tag, evento, fa_flight_id}.
 * @param {object} ctx {db, enviarPush, agora}
 * @param {string} evento event_code ou "atraso"
 * @param {object} voo objeto Voo do contrato
 * @param {{desvio?: object|null}} [op]
 * @returns {Promise<number>} quantos pushes foram aceitos
 */
export async function notificarVoo(ctx, evento, voo, op = {}) {
  let enviados = 0;
  for (const d of destinatarios(ctx.db, voo.fa_flight_id)) {
    const m = montarMensagem(evento, voo, { apelido: d.apelido, agora: ctx.agora(), desvio: op.desvio });
    if (!m) return 0;
    const payload = JSON.stringify({
      titulo: m.titulo, corpo: m.corpo,
      url: `/v/${encodeURIComponent(voo.fa_flight_id)}`,
      tag: `${voo.fa_flight_id}:${evento}`, evento, fa_flight_id: voo.fa_flight_id,
    });
    try {
      await ctx.enviarPush(d.sub, payload);
      enviados++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) removerEndpoint(ctx.db, d.sub.endpoint);
      else console.warn(`[push] falhou (${e?.statusCode || e?.message})`);
    }
  }
  return enviados;
}
