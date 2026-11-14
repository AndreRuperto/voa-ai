import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, tokenGoogle } from './ajuda.js';

prepararAmbiente();
const api = aeroapiFalsa({
  'GET /flights/*': (u) => ({ status: 200, json: { flights: [vooAeroapi({ fa_flight_id: decodeURIComponent(u.pathname.split('/').pop()) })] } }),
});
let s, admin, comum, anonimo;
before(async () => {
  s = await subir({ fetch: api.buscar });
  admin = s.cliente(); comum = s.cliente(); anonimo = s.cliente();
  await admin.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: tokenGoogle({ sub: 'a', email: 'Admin@Exemplo.com', name: 'Dona' }) } });
  await comum.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: tokenGoogle({ sub: 'c', email: 'comum@exemplo.com' }) } });
});
after(() => s.fechar());

test('/admin e /api/admin/* dão 404 para quem não é admin', async () => {
  for (const c of [anonimo, comum]) {
    assert.equal((await c.pedir('/admin/')).status, 404);
    assert.equal((await c.pedir('/admin/painel.js')).status, 404);
    assert.equal((await c.pedir('/api/admin/resumo')).status, 404);
    assert.equal((await c.pedir('/api/admin/config', { metodo: 'PUT', corpo: { rota_pausada: true } })).status, 404);
  }
  const pagina = await admin.pedir('/admin/');
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get('content-type'), /text\/html/);
  assert.equal((await admin.pedir('/api/eu')).json.conta.admin, true);
});

test('CSRF: POST/PUT/DELETE em /api/* sem X-Requested-With → 403', async () => {
  const r = await anonimo.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: 'X' }, csrf: false });
  assert.equal(r.status, 403);
  assert.equal((await anonimo.pedir('/api/sessao', { metodo: 'DELETE', csrf: false })).status, 403);
  assert.equal((await admin.pedir('/api/admin/config', { metodo: 'PUT', corpo: {}, csrf: false })).status, 403);
  const wh = await fetch(`${s.base}/webhook/aeroapi/errado`, { method: 'POST', body: '{}' });
  assert.equal(wh.status, 404, 'webhook não exige o cabeçalho');
});

test('resumo soma CHAMADA_API e alertas entregues', async () => {
  await comum.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: 'TAP9-1-schedule-0001', apelido: 'Ana' } });
  const r = await admin.pedir('/api/admin/resumo?mes=2026-11');
  assert.equal(r.status, 200);
  assert.equal(r.json.mes, '2026-11');
  assert.equal(r.json.credito_usd, 5);
  assert.equal(r.json.gasto_usd, 0.005);
  assert.equal(r.json.voos_ativos, 1);
  assert.equal(r.json.contas, 2);
  assert.ok(r.json.por_tipo.some((t) => t.tipo === 'flights' && t.chamadas === 1));
  assert.deepEqual(r.json.por_dia, [{ dia: '2026-11-14', usd: 0.005 }]);
  assert.equal((await admin.pedir('/api/admin/resumo?mes=13')).status, 400);
});

test('voos, contas, bloquear e parar', async () => {
  const voos = await admin.pedir('/api/admin/voos');
  assert.equal(voos.json.voos.length, 1);
  assert.equal(voos.json.voos[0].inscritos, 1);
  assert.ok(voos.json.voos[0].alert_id);

  const contas = await admin.pedir('/api/admin/contas');
  const c = contas.json.contas.find((x) => x.email === 'comum@exemplo.com');
  assert.equal(c.voos_ativos, 1);
  assert.equal(c.bloqueado, false);

  assert.equal((await admin.pedir(`/api/admin/contas/${c.id}/bloquear`, { metodo: 'POST', corpo: { bloqueado: true } })).status, 204);
  assert.equal((await comum.pedir('/api/eu')).json.conta, null, 'bloquear derruba a sessão');

  const parar = await admin.pedir('/api/admin/voos/TAP9-1-schedule-0001/parar', { metodo: 'POST' });
  assert.equal(parar.status, 204);
  assert.ok(api.chamadas.some((x) => x.metodo === 'DELETE' && x.caminho.startsWith('/alerts/')));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM INSCRICAO').get().n, 0);
});

test('config: muda limites com validação e auditoria', async () => {
  const ruim = await admin.pedir('/api/admin/config', { metodo: 'PUT', corpo: { limite_voos_anonimo: 'muito' } });
  assert.equal(ruim.status, 400);
  assert.equal((await admin.pedir('/api/admin/config', { metodo: 'PUT', corpo: { chave_nova: 1 } })).status, 400);
  const r = await admin.pedir('/api/admin/config', { metodo: 'PUT', corpo: { limite_voos_anonimo: 2, rota_pausada: true } });
  assert.equal(r.status, 200);
  assert.equal(r.json.config.limite_voos_anonimo, 2);
  assert.equal(r.json.config.rota_pausada, true);
  const g = await admin.pedir('/api/admin/config');
  assert.ok(g.json.auditoria.some((a) => a.acao === 'mudar_config' && a.admin_email === 'Admin@Exemplo.com'));
  assert.ok(g.json.auditoria.some((a) => a.acao === 'bloquear_conta'));
  assert.equal((await anonimo.pedir('/api/eu')).json.limites.voos, 2);
  assert.equal((await anonimo.pedir('/api/config')).json.limites.rota_pausada, true);
});

test('estáticos: /v/:id cai no index.html; caminho fora de public dá 404', async () => {
  const v = await anonimo.pedir('/v/TAP103-1-schedule-0001');
  assert.equal(v.status, 200);
  assert.match(v.texto, /Voa Aí/);
  const raiz = await anonimo.pedir('/');
  assert.equal(raiz.status, 200, 'pasta pública dentro de um caminho com ponto (ex.: .claude/) também serve');
  assert.equal((await anonimo.pedir('/.env')).status, 404);
  const js = await anonimo.pedir('/app.js');
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.equal((await anonimo.pedir('/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await anonimo.pedir('/saude')).json.ok, true);
  assert.equal((await anonimo.pedir('/api/nada')).status, 404);
});
