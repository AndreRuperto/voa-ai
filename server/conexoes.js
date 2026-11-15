// Aviso de conexão em risco. A viagem é deduzida dos voos que cada pessoa acompanha, com a mesma regra
// do front (public/viagens.js, ADR-008). O agendador chama a cada minuto; nada aqui consulta a AeroAPI.
//
// Avisa quando a troca de avião fica pior do que a companhia planejou (horários previstos):
//   ok → apertada (< 45 min de portão a portão) → perdida (chega depois da saída do próximo).
// Cada nível avisa uma vez por par de trechos; se depois voltar ao planejado, avisa que normalizou.
// Cancelado e desviado já têm aviso próprio do voo, então ficam de fora.
import { agruparViagens, conexao } from '../public/viagens.js';
import { lerVoo, vooDaLinha } from './voos.js';
import { removerEndpoint } from './push.js';
import { hora } from './mensagens.js';

const NIVEL = { ok: 0, apertada: 1, perdida: 2 };
const PAROU = ['cancelado', 'desviado'];

/** O mesmo voo só com os horários planejados (para saber o risco "de fábrica" da conexão). */
function planejado(v) {
  const h = Object.fromEntries(Object.entries(v.horarios || {}).filter(([k]) => /previst[oa]$/.test(k)));
  return { ...v, estado: 'previsto', horarios: h };
}

const lugar = (l) => l?.cidade || l?.nome || l?.iata || 'a escala';
const cod = (v) => v.ident_iata || v.ident;
function duracao(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
const chegadaDe = (v) => { const h = v.horarios || {}; return h.chegada_real || h.chegada_estimada || h.chegada_prevista || h.pouso_estimado || h.pouso_previsto; };
const saidaDe = (v) => { const h = v.horarios || {}; return h.saida_real || h.saida_estimada || h.saida_prevista; };

/** Texto do aviso (o fuso é o do aeroporto da escala). */
export function mensagemConexao(nivel, a, b, { apelido = null, minutos }) {
  const onde = lugar(a.destino), fuso = a.destino?.fuso, nome = (apelido || '').trim();
  const quem = nome ? `A ${nome}` : 'Quem viaja';
  const chega = hora(chegadaDe(a), fuso), sai = hora(saidaDe(b), fuso);
  if (nivel === 'perdida') return {
    titulo: nome ? `${nome} pode perder a conexão em ${onde}` : `Pode perder a conexão em ${onde}`,
    corpo: `⚠️ O ${cod(a)} deve chegar às ${chega}, depois da saída do ${cod(b)} (${sai}). Vale falar com a companhia.`,
  };
  if (nivel === 'apertada') return {
    titulo: `Conexão apertada em ${onde}`,
    corpo: `🕒 O ${cod(a)} chega às ${chega} e o ${cod(b)} sai às ${sai}. ${quem} vai ter ${duracao(minutos)} para trocar de avião.`,
  };
  return {
    titulo: `Conexão em ${onde} em dia`,
    corpo: `✅ Com o novo horário, ${quem.toLowerCase() === 'quem viaja' ? 'sobram' : `a ${nome} tem`} ${duracao(minutos)} para trocar de avião em ${onde}.`,
  };
}

/** Aparelhos de quem acompanha a inscrição: a própria, o aparelho dela e os aparelhos da conta. Sem repetir. */
function aparelhosDaInscricao(db, i) {
  const vistos = new Set(), lista = [];
  const add = (e, p, a) => { if (e && !vistos.has(e)) { vistos.add(e); lista.push({ endpoint: e, keys: { p256dh: p, auth: a } }); } };
  add(i.push_endpoint, i.push_p256dh, i.push_auth);
  const ap = db.prepare('SELECT push_endpoint, push_p256dh, push_auth FROM APARELHO WHERE id = ?').get(i.aparelho_id);
  if (ap) add(ap.push_endpoint, ap.push_p256dh, ap.push_auth);
  if (i.usuario_id) for (const x of db.prepare('SELECT push_endpoint, push_p256dh, push_auth FROM APARELHO WHERE usuario_id = ?').all(i.usuario_id)) add(x.push_endpoint, x.push_p256dh, x.push_auth);
  return lista;
}

async function enviar(ctx, subs, payload) {
  let n = 0;
  for (const sub of subs) {
    try { await ctx.enviarPush(sub, payload); n++; } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) removerEndpoint(ctx.db, sub.endpoint);
      else console.warn(`[conexão] push falhou (${e?.statusCode || e?.message})`);
    }
  }
  return n;
}

/**
 * Uma rodada: confere as conexões de todo mundo e avisa o que mudou.
 * @returns {Promise<number>} quantos avisos saíram (pares, não aparelhos)
 */
export async function verificarConexoes(ctx) {
  const db = ctx.db, agora = ctx.agora();
  const linhas = db.prepare(`SELECT i.* FROM INSCRICAO i JOIN VOO v ON v.fa_flight_id = i.fa_flight_id WHERE v.actual_in IS NULL OR v.actual_in > ?`)
    .all(new Date(agora.getTime() - 24 * 3600_000).toISOString());
  // cada pessoa: a conta, se tiver; senão, o aparelho
  const porDono = new Map();
  for (const i of linhas) {
    const l = lerVoo(db, i.fa_flight_id); if (!l) continue;
    const dono = i.usuario_id ? `u:${i.usuario_id}` : `a:${i.aparelho_id}`;
    if (!porDono.has(dono)) porDono.set(dono, []);
    porDono.get(dono).push({ ...i, id: i.id, apelido: i.apelido, voo: vooDaLinha(l, agora) });
  }
  let avisos = 0;
  for (const lista of porDono.values()) {
    for (const { pernas } of agruparViagens(lista)) {
      for (let j = 1; j < pernas.length; j++) {
        const pa = pernas[j - 1], pb = pernas[j], a = pa.voo, b = pb.voo;
        if (PAROU.includes(a.estado) || PAROU.includes(b.estado)) continue;
        const partiu = !!b.horarios?.saida_real || ['em_voo', 'pousou', 'no_portao_destino'].includes(b.estado);
        if (partiu) continue;
        const atual = conexao(a, b), plano = conexao(planejado(a), planejado(b));
        const chave = `${pa.id}|${pb.id}`;
        const antes = db.prepare('SELECT risco FROM AVISO_CONEXAO WHERE chave = ?').get(chave)?.risco ?? null;
        const base = Math.max(NIVEL[plano.risco], NIVEL[antes ?? 'ok']);
        let nivel = null;
        if (NIVEL[atual.risco] > base) nivel = atual.risco;                                  // piorou
        else if (antes && NIVEL[antes] > NIVEL[plano.risco] && NIVEL[atual.risco] <= NIVEL[plano.risco]) nivel = 'ok';   // voltou ao planejado
        if (!nivel) continue;
        db.prepare(`INSERT INTO AVISO_CONEXAO (chave, risco, em) VALUES (?, ?, ?)
                    ON CONFLICT(chave) DO UPDATE SET risco = excluded.risco, em = excluded.em`).run(chave, nivel === 'ok' ? 'ok' : nivel, agora.toISOString());
        const apelido = pernas.find((p) => p.apelido)?.apelido || null;
        const m = mensagemConexao(nivel, a, b, { apelido, minutos: atual.minutos });
        const subs = aparelhosDaInscricao(db, pb);
        const payload = JSON.stringify({ titulo: m.titulo, corpo: m.corpo, url: `/v/${encodeURIComponent(b.fa_flight_id)}`,
          tag: `conexao:${chave}`, evento: `conexao_${nivel}`, fa_flight_id: b.fa_flight_id });
        await enviar(ctx, subs, payload);
        avisos++;
      }
    }
  }
  return avisos;
}
