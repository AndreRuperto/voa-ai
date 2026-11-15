// Inscrições ("Meus voos"): limites (R5 / doc 12), alerta compartilhado (R1) e apagar no último (R3).
import { randomUUID } from 'node:crypto';
import { ErroRegra, garantirAlerta, apagarSeUltimo } from './alertas.js';
import { obterVoo } from './consultas.js';
import { lerVoo, vooAtivo, vooDaLinha } from './voos.js';
import { limitesPara } from './limites.js';
import { lerPushSubscription } from './push.js';

/**
 * Quem está pedindo.
 * @typedef {{aparelhoId: string, usuario: object|null}} Quem
 */

/** Rótulo de quem pediu, para CHAMADA_API e BUSCA_ROTA. */
export const rotuloQuem = (q) => (q.usuario ? `u:${q.usuario.id}` : `a:${q.aparelhoId}`);

function donoSql(q) {
  return q.usuario ? ['usuario_id = ?', q.usuario.id] : ['aparelho_id = ?', q.aparelhoId];
}

/** Inscrições de quem pede (da conta, se tiver sessão; senão do aparelho). */
export function inscricoesDe(db, q) {
  const [onde, valor] = donoSql(q);
  return db.prepare(`SELECT * FROM INSCRICAO WHERE ${onde} ORDER BY criado_em`).all(valor);
}

/** Quantos voos ativos quem pede acompanha. */
export function voosAtivos(db, q, agora) {
  const ids = new Set(inscricoesDe(db, q).map((i) => i.fa_flight_id));
  let n = 0;
  for (const id of ids) {
    const v = lerVoo(db, id);
    if (v && vooAtivo(v.dados, agora)) n++;
  }
  return n;
}

/** GET /api/inscricoes */
export function listarInscricoes(ctx, q) {
  const agora = ctx.agora();
  return inscricoesDe(ctx.db, q).map((i) => {
    const v = lerVoo(ctx.db, i.fa_flight_id);
    return { id: i.id, apelido: i.apelido, criado_em: i.criado_em, voo: v ? vooDaLinha(v, agora) : null };
  }).filter((i) => i.voo);
}

export function guardarPushNoAparelho(db, aparelhoId, p) {
  if (!p) return;
  db.prepare('UPDATE APARELHO SET push_endpoint = ?, push_p256dh = ?, push_auth = ? WHERE id = ?').run(p.endpoint, p.p256dh, p.auth, aparelhoId);
}

function lerApelido(apelido) {
  if (apelido == null || apelido === '') return null;
  if (typeof apelido !== 'string') throw new ErroRegra(400, 'invalido', 'Apelido inválido.');
  const a = apelido.trim().replace(/\s+/g, ' ');
  if (a.length > 40) throw new ErroRegra(400, 'invalido', 'O apelido pode ter até 40 letras.');
  return a || null;
}

/**
 * POST /api/inscricoes
 * @returns {Promise<{status: number, corpo: {id: string, voo: object}}>}
 */
export async function criarInscricao(ctx, q, corpo) {
  const agora = ctx.agora();
  if (q.usuario?.bloqueado) throw new ErroRegra(403, 'bloqueado', 'Esta conta está bloqueada.');
  const fa = corpo?.fa_flight_id;
  if (typeof fa !== 'string' || !fa) throw new ErroRegra(400, 'invalido', 'Falta o voo (fa_flight_id).');
  const apelido = lerApelido(corpo.apelido);
  const push = corpo.push == null ? null : lerPushSubscription(corpo.push);
  if (corpo.push != null && !push) throw new ErroRegra(400, 'invalido', 'Inscrição de push inválida.');

  const linha = await obterVoo(ctx, fa, { quem: rotuloQuem(q) });
  if (!vooAtivo(linha.dados, agora)) throw new ErroRegra(400, 'invalido', 'Esse voo já terminou.');

  const [onde, valor] = donoSql(q);
  const existente = ctx.db.prepare(`SELECT * FROM INSCRICAO WHERE ${onde} AND fa_flight_id = ?`).get(valor, fa);
  if (existente) {
    ctx.db.prepare('UPDATE INSCRICAO SET apelido = ?, push_endpoint = COALESCE(?, push_endpoint), push_p256dh = COALESCE(?, push_p256dh), push_auth = COALESCE(?, push_auth) WHERE id = ?')
      .run(apelido, push?.endpoint ?? null, push?.p256dh ?? null, push?.auth ?? null, existente.id);
    guardarPushNoAparelho(ctx.db, q.aparelhoId, push);
    return { status: 200, corpo: { id: existente.id, voo: vooDaLinha(lerVoo(ctx.db, fa), agora) } };
  }

  const lim = limitesPara(ctx.db, Boolean(q.usuario)).voos;
  if (voosAtivos(ctx.db, q, agora) >= lim) {
    throw new ErroRegra(429, 'limite', q.usuario
      ? `Você já acompanha ${lim} voos. Remova um para acompanhar outro.`
      : `Você já acompanha ${lim} voos neste aparelho. Remova um ou entre com Google para acompanhar até mais.`);
  }

  await garantirAlerta(ctx, fa, { quem: rotuloQuem(q) });

  const id = randomUUID();
  ctx.db.prepare(`INSERT INTO INSCRICAO (id, fa_flight_id, aparelho_id, usuario_id, apelido, push_endpoint, push_p256dh, push_auth, criado_em)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, fa, q.aparelhoId, q.usuario?.id ?? null, apelido, push?.endpoint ?? null, push?.p256dh ?? null, push?.auth ?? null, agora.toISOString());
  guardarPushNoAparelho(ctx.db, q.aparelhoId, push);
  return { status: 201, corpo: { id, voo: vooDaLinha(lerVoo(ctx.db, fa), agora) } };
}

function inscricaoDe(db, q, id) {
  const i = db.prepare('SELECT * FROM INSCRICAO WHERE id = ?').get(id);
  if (!i) return null;
  const minha = i.aparelho_id === q.aparelhoId || (q.usuario && i.usuario_id === q.usuario.id);
  return minha ? i : null;
}

/** PUT /api/inscricoes/:id/push */
export function ligarPush(ctx, q, id, corpo) {
  const i = inscricaoDe(ctx.db, q, id);
  if (!i) throw new ErroRegra(404, 'nao_encontrado', 'Inscrição não encontrada.');
  const push = lerPushSubscription(corpo?.push);
  if (!push) throw new ErroRegra(400, 'invalido', 'Inscrição de push inválida.');
  ctx.db.prepare('UPDATE INSCRICAO SET push_endpoint = ?, push_p256dh = ?, push_auth = ? WHERE id = ?').run(push.endpoint, push.p256dh, push.auth, id);
  guardarPushNoAparelho(ctx.db, q.aparelhoId, push);
}

/** DELETE /api/inscricoes/:id (R3: apaga o alerta se era o último). */
export async function apagarInscricao(ctx, q, id) {
  const i = inscricaoDe(ctx.db, q, id);
  if (!i) throw new ErroRegra(404, 'nao_encontrado', 'Inscrição não encontrada.');
  ctx.db.prepare('DELETE FROM INSCRICAO WHERE id = ?').run(id);
  await apagarSeUltimo(ctx, i.fa_flight_id, { quem: rotuloQuem(q) });
}

/**
 * Ao entrar: as inscrições anônimas do aparelho passam para a conta, sem duplicar o mesmo voo.
 * @returns {string[]} voos cujas inscrições duplicadas foram apagadas
 */
export function moverParaConta(db, aparelhoId, usuarioId) {
  const daConta = new Set(db.prepare('SELECT fa_flight_id FROM INSCRICAO WHERE usuario_id = ?').all(usuarioId).map((l) => l.fa_flight_id));
  const removidas = [];
  for (const i of db.prepare('SELECT * FROM INSCRICAO WHERE aparelho_id = ? AND usuario_id IS NULL ORDER BY criado_em').all(aparelhoId)) {
    if (daConta.has(i.fa_flight_id)) {
      db.prepare('DELETE FROM INSCRICAO WHERE id = ?').run(i.id);
      removidas.push(i.fa_flight_id);
    } else {
      db.prepare('UPDATE INSCRICAO SET usuario_id = ? WHERE id = ?').run(usuarioId, i.id);
      daConta.add(i.fa_flight_id);
    }
  }
  return removidas;
}
