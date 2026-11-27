import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../server/db.js';
import { criarAeroapi, criarPermissaoPaga, ErroAeroapi } from '../server/aeroapi.js';

// Plano Personal da AeroAPI é de uso pessoal, e visitante anônimo não pode gastar o orçamento do mês
// (docs/revisao: itens 1 e 2). Com AEROAPI_CONVIDADOS definida, só convidados e admins geram consulta paga.

const resposta = (status, json) => new Response(json == null ? null : JSON.stringify(json), { status });

function bancoComContas() {
  const db = abrirBanco();
  // O id da conta é texto aleatório (contas.js), não número.
  const ins = db.prepare('INSERT INTO USUARIO (id, google_sub, email, nome, foto, criado_em, ultimo_acesso) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const t = new Date().toISOString();
  ins.run('k1Rz', 'g1', 'convidada@exemplo.com', 'C', null, t, t);
  ins.run('Qp_2', 'g2', 'estranho@exemplo.com', 'E', null, t, t);
  ins.run('x-3A', 'g3', 'admin@exemplo.com', 'A', null, t, t);
  return db;
}

test('sem AEROAPI_CONVIDADOS, todo mundo pode (desenvolvimento e testes antigos)', () => {
  const pode = criarPermissaoPaga(abrirBanco(), {});
  assert.equal(pode('a:qualquer'), true);
  assert.equal(pode('u:nao-existe'), true);
});

test('com AEROAPI_CONVIDADOS: convidado e admin pagam; anônimo e conta de fora não', () => {
  const pode = criarPermissaoPaga(bancoComContas(), { AEROAPI_CONVIDADOS: 'Convidada@exemplo.com', ADMIN_EMAILS: 'admin@exemplo.com' });
  assert.equal(pode('u:k1Rz'), true);
  assert.equal(pode('u:x-3A'), true);
  assert.equal(pode('u:Qp_2'), false);
  assert.equal(pode('a:aparelho-novo'), false);
  assert.equal(pode('u:nao-existe'), false);
  // O agendador (voos já acompanhados) e as ações de admin continuam.
  assert.equal(pode('agendador'), true);
  assert.equal(pode('admin:admin@exemplo.com'), true);
  assert.equal(pode(undefined), true);
});

test('lista vazia: só admins', () => {
  const pode = criarPermissaoPaga(bancoComContas(), { AEROAPI_CONVIDADOS: '', ADMIN_EMAILS: 'admin@exemplo.com' });
  assert.equal(pode('u:k1Rz'), false);
  assert.equal(pode('u:x-3A'), true);
});

test('conta bloqueada não paga, mesmo convidada', () => {
  const db = bancoComContas();
  db.prepare('UPDATE USUARIO SET bloqueado = 1 WHERE id = ?').run('k1Rz');
  const pode = criarPermissaoPaga(db, { AEROAPI_CONVIDADOS: 'convidada@exemplo.com' });
  assert.equal(pode('u:k1Rz'), false);
});

test('anônimo não gera chamada paga: erro so_convidados (403) e nada registrado', async () => {
  const db = bancoComContas();
  let chamou = false;
  const api = criarAeroapi({
    db, chave: () => 'k', fetch: async () => { chamou = true; return resposta(200, { flights: [] }); },
    permitido: criarPermissaoPaga(db, { AEROAPI_CONVIDADOS: 'convidada@exemplo.com' }),
  });
  await assert.rejects(api.vooPorId('INVENTADO-123', { quem: 'a:aparelho-novo' }), (e) => e instanceof ErroAeroapi && e.codigo === 'so_convidados' && e.http === 403);
  assert.equal(chamou, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM CHAMADA_API').get().n, 0);
  // O convidado consulta normalmente.
  await api.vooPorId('X', { quem: 'u:k1Rz' });
  assert.equal(chamou, true);
});
