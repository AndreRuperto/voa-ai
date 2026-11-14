// Conta Google opcional, sessões e admin (docs/12-contas-admin-rotas.md).
import { randomBytes, randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { ErroRegra } from './alertas.js';
import { moverParaConta } from './inscricoes.js';

export const SESSAO_DIAS = 30;
export const APARELHO_DIAS = 400;

/** ID aleatório para cookie (32 bytes, base64url). */
export const idAleatorio = () => randomBytes(32).toString('base64url');

/**
 * Verificador real do ID token do Google: assinatura, aud = GOOGLE_CLIENT_ID, iss e exp.
 * @returns {(token: string) => Promise<object>} payload do token
 */
export function criarVerificadorGoogle() {
  const cliente = new OAuth2Client();
  return async (token) => {
    const ticket = await cliente.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    return ticket.getPayload();
  };
}

/** E-mails de admin (ADMIN_EMAILS, separados por vírgula), em minúsculas. */
export function emailsAdmin() {
  return (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export const ehAdmin = (u) => Boolean(u && !u.bloqueado && emailsAdmin().includes(String(u.email).toLowerCase()));

/** Garante a linha do aparelho; devolve o id (novo se o cookie não existir no banco). */
export function garantirAparelho(db, idCookie, agora) {
  const iso = agora.toISOString();
  if (idCookie && /^[A-Za-z0-9_-]{20,64}$/.test(idCookie)) {
    const ex = db.prepare('SELECT id, ultimo_acesso FROM APARELHO WHERE id = ?').get(idCookie);
    if (ex) {
      if (!ex.ultimo_acesso || ex.ultimo_acesso.slice(0, 13) !== iso.slice(0, 13)) {
        db.prepare('UPDATE APARELHO SET ultimo_acesso = ? WHERE id = ?').run(iso, idCookie);
      }
      return { id: idCookie, novo: false };
    }
  }
  const id = idAleatorio();
  db.prepare('INSERT INTO APARELHO (id, criado_em, ultimo_acesso) VALUES (?, ?, ?)').run(id, iso, iso);
  return { id, novo: true };
}

/** Usuário da sessão (ou null se não existe, expirou ou foi apagada). */
export function usuarioDaSessao(db, sessaoId, agora) {
  if (!sessaoId) return null;
  const l = db.prepare('SELECT u.*, s.expira_em FROM SESSAO s JOIN USUARIO u ON u.id = s.usuario_id WHERE s.id = ?').get(sessaoId);
  if (!l) return null;
  if (l.expira_em <= agora.toISOString()) {
    db.prepare('DELETE FROM SESSAO WHERE id = ?').run(sessaoId);
    return null;
  }
  return { id: l.id, email: l.email, nome: l.nome, foto: l.foto, bloqueado: Boolean(l.bloqueado), ultimo_acesso: l.ultimo_acesso };
}

/**
 * POST /api/sessao: valida o token, cria/atualiza o USUARIO, liga o aparelho e move as inscrições.
 * @returns {Promise<{sessaoId: string, usuario: object}>}
 */
export async function entrar(ctx, aparelhoId, credential) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new ErroRegra(503, 'login_indisponivel', 'O login com Google ainda não está configurado neste servidor.');
  if (typeof credential !== 'string' || credential.length < 20) throw new ErroRegra(400, 'invalido', 'Falta o token do Google.');
  let p;
  try {
    p = await ctx.verificarGoogle(credential);
  } catch {
    throw new ErroRegra(401, 'token_invalido', 'Não foi possível confirmar sua conta Google. Tente de novo.');
  }
  if (!p?.sub || !p.email || p.email_verified === false) throw new ErroRegra(401, 'token_invalido', 'Sua conta Google precisa ter um e-mail confirmado.');

  const agora = ctx.agora().toISOString();
  const db = ctx.db;
  let u = db.prepare('SELECT * FROM USUARIO WHERE google_sub = ?').get(p.sub);
  if (u?.bloqueado) throw new ErroRegra(403, 'bloqueado', 'Esta conta está bloqueada.');
  if (u) {
    db.prepare('UPDATE USUARIO SET email = ?, nome = ?, foto = ?, ultimo_acesso = ? WHERE id = ?').run(p.email, p.name || null, p.picture || null, agora, u.id);
  } else {
    const id = randomUUID();
    db.prepare('INSERT INTO USUARIO (id, google_sub, email, nome, foto, criado_em, ultimo_acesso) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, p.sub, p.email, p.name || null, p.picture || null, agora, agora);
    u = { id };
  }
  const sessaoId = idAleatorio();
  const expira = new Date(ctx.agora().getTime() + SESSAO_DIAS * 86_400_000).toISOString();
  db.prepare('INSERT INTO SESSAO (id, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)').run(sessaoId, u.id, agora, expira);
  db.prepare('UPDATE APARELHO SET usuario_id = ? WHERE id = ?').run(u.id, aparelhoId);
  moverParaConta(db, aparelhoId, u.id);
  return { sessaoId, usuario: usuarioDaSessao(db, sessaoId, ctx.agora()) };
}

/** DELETE /api/sessao: o aparelho volta a ser anônimo e fica com os voos que já tinha. */
export function sair(db, sessaoId, aparelhoId) {
  if (sessaoId) db.prepare('DELETE FROM SESSAO WHERE id = ?').run(sessaoId);
  db.prepare('UPDATE APARELHO SET usuario_id = NULL WHERE id = ?').run(aparelhoId);
}

/** Apaga a conta: USUARIO, sessões e o vínculo dos aparelhos. As inscrições ficam nos aparelhos, anônimas. */
export function apagarConta(db, usuarioId) {
  db.prepare('DELETE FROM SESSAO WHERE usuario_id = ?').run(usuarioId);
  db.prepare('UPDATE APARELHO SET usuario_id = NULL WHERE usuario_id = ?').run(usuarioId);
  db.prepare('UPDATE INSCRICAO SET usuario_id = NULL WHERE usuario_id = ?').run(usuarioId);
  db.prepare('DELETE FROM USUARIO WHERE id = ?').run(usuarioId);
}

/** Registra uma ação de admin. */
export function auditar(db, adminEmail, acao, detalhe, agora) {
  db.prepare('INSERT INTO AUDITORIA (admin_email, acao, detalhe, em) VALUES (?, ?, ?, ?)')
    .run(adminEmail, acao, typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe), agora.toISOString());
}
