// SQLite (node:sqlite) e migrações. Ver docs/03-arquitetura.md e docs/12-contas-admin-rotas.md.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Cada item é uma migração; a posição é a versão (PRAGMA user_version). */
const MIGRACOES = [
  `
  CREATE TABLE VOO (
    fa_flight_id   TEXT PRIMARY KEY,
    ident          TEXT NOT NULL,
    origem         TEXT,
    destino        TEXT,
    scheduled_out  TEXT,
    estimated_out  TEXT,
    actual_out     TEXT,
    actual_off     TEXT,
    scheduled_in   TEXT,
    estimated_in   TEXT,
    actual_on      TEXT,
    actual_in      TEXT,
    cancelado      INTEGER NOT NULL DEFAULT 0,
    desviado       INTEGER NOT NULL DEFAULT 0,
    status         TEXT,
    alert_id       INTEGER,
    dados_json     TEXT NOT NULL,          -- voo normalizado no formato da AeroAPI
    ultimo_atraso_avisado INTEGER,         -- minutos do último aviso de atraso
    checagens      TEXT NOT NULL DEFAULT '[]', -- marcos do agendador já feitos
    atualizado_em  TEXT NOT NULL
  );
  CREATE INDEX voo_alert ON VOO(alert_id);

  CREATE TABLE USUARIO (
    id            TEXT PRIMARY KEY,
    google_sub    TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL,
    nome          TEXT,
    foto          TEXT,
    bloqueado     INTEGER NOT NULL DEFAULT 0,
    criado_em     TEXT NOT NULL,
    ultimo_acesso TEXT
  );

  CREATE TABLE SESSAO (
    id         TEXT PRIMARY KEY,
    usuario_id TEXT NOT NULL REFERENCES USUARIO(id) ON DELETE CASCADE,
    criado_em  TEXT NOT NULL,
    expira_em  TEXT NOT NULL
  );

  CREATE TABLE APARELHO (
    id            TEXT PRIMARY KEY,
    usuario_id    TEXT REFERENCES USUARIO(id) ON DELETE SET NULL,
    push_endpoint TEXT,
    push_p256dh   TEXT,
    push_auth     TEXT,
    criado_em     TEXT NOT NULL,
    ultimo_acesso TEXT
  );
  CREATE INDEX aparelho_usuario ON APARELHO(usuario_id);

  CREATE TABLE INSCRICAO (
    id            TEXT PRIMARY KEY,
    fa_flight_id  TEXT NOT NULL REFERENCES VOO(fa_flight_id) ON DELETE CASCADE,
    aparelho_id   TEXT NOT NULL,
    usuario_id    TEXT REFERENCES USUARIO(id) ON DELETE SET NULL,
    apelido       TEXT,
    push_endpoint TEXT,
    push_p256dh   TEXT,
    push_auth     TEXT,
    criado_em     TEXT NOT NULL
  );
  CREATE INDEX inscricao_voo ON INSCRICAO(fa_flight_id);
  CREATE INDEX inscricao_aparelho ON INSCRICAO(aparelho_id);
  CREATE INDEX inscricao_usuario ON INSCRICAO(usuario_id);

  CREATE TABLE EVENTO (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fa_flight_id  TEXT,
    alert_id      INTEGER,
    event_code    TEXT,
    chave         TEXT,                  -- deduplicação: alert_id|evento|horário
    payload_json  TEXT NOT NULL,
    recebido_em   TEXT NOT NULL,
    notificado    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX evento_voo ON EVENTO(fa_flight_id);
  CREATE INDEX evento_chave ON EVENTO(chave);

  CREATE TABLE BUSCA_ROTA (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    busca_id    TEXT NOT NULL,           -- agrupa os pares de uma mesma busca
    origem      TEXT NOT NULL,
    destino     TEXT NOT NULL,
    data        TEXT NOT NULL,
    cache       INTEGER NOT NULL,
    quem        TEXT NOT NULL,           -- "u:<usuario>" ou "a:<aparelho>"
    em          TEXT NOT NULL
  );
  CREATE INDEX busca_quem ON BUSCA_ROTA(quem, em);

  CREATE TABLE CHAMADA_API (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo         TEXT NOT NULL,          -- canonical, flights, rota, alerts, alerta_entregue
    endpoint     TEXT NOT NULL,
    preco        REAL NOT NULL,
    paginas      INTEGER NOT NULL DEFAULT 1,
    custo        REAL NOT NULL,          -- preco × paginas
    status       INTEGER,
    fa_flight_id TEXT,
    ref          TEXT,                   -- ex.: par da rota "LIS-GRU"
    quem         TEXT,
    em           TEXT NOT NULL
  );
  CREATE INDEX chamada_em ON CHAMADA_API(em);
  CREATE INDEX chamada_voo ON CHAMADA_API(fa_flight_id);

  CREATE TABLE CONFIG (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  CREATE TABLE AUDITORIA (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_email TEXT NOT NULL,
    acao        TEXT NOT NULL,
    detalhe     TEXT,
    em          TEXT NOT NULL
  );

  CREATE TABLE CACHE (
    chave     TEXT PRIMARY KEY,          -- ex.: "voos:TAP103:2026-11-14", "rota:LPPT:SBGR:2026-11-14"
    valor     TEXT NOT NULL,
    expira_em TEXT NOT NULL
  );
  `,
  `
  -- Avisos de gasto já mandados aos admins (um por mês e marco): 50, 80, teto, duro.
  CREATE TABLE AVISO_GASTO (
    mes       TEXT NOT NULL,
    marco     TEXT NOT NULL,
    gasto_usd REAL NOT NULL,
    enviados  INTEGER NOT NULL,          -- quantos aparelhos de admin receberam o push
    em        TEXT NOT NULL,
    PRIMARY KEY (mes, marco)
  );
  `,
  `
  -- Avisos de conexão em risco: o último nível avisado por par de trechos (inscrição A | inscrição B).
  CREATE TABLE AVISO_CONEXAO (
    chave TEXT PRIMARY KEY,
    risco TEXT NOT NULL,                 -- ok | apertada | perdida
    em    TEXT NOT NULL
  );
  `,
];

/**
 * Abre o banco e aplica as migrações pendentes.
 * @param {string} [caminho] arquivo do SQLite, ou ":memory:"
 * @returns {DatabaseSync}
 */
export function abrirBanco(caminho = ':memory:') {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrar(db);
  return db;
}

/** @param {DatabaseSync} db */
export function migrar(db) {
  const { user_version: versao } = db.prepare('PRAGMA user_version').get();
  for (let v = versao; v < MIGRACOES.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRACOES[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Roda `fn` numa transação. */
export function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Lê do cache (tabela CACHE) se ainda não expirou. */
export function lerCache(db, chave, agora = new Date()) {
  const l = db.prepare('SELECT valor, expira_em FROM CACHE WHERE chave = ?').get(chave);
  if (!l || l.expira_em <= agora.toISOString()) return null;
  return JSON.parse(l.valor);
}

/** Grava no cache por `ms` milissegundos. */
export function gravarCache(db, chave, valor, ms, agora = new Date()) {
  db.prepare('INSERT INTO CACHE (chave, valor, expira_em) VALUES (?, ?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, expira_em = excluded.expira_em')
    .run(chave, JSON.stringify(valor), new Date(agora.getTime() + ms).toISOString());
}
