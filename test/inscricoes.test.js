import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, SUB, tokenGoogle } from './ajuda.js';

prepararAmbiente();
const fa = (n) => `TAP10${n}-1763000000-schedule-0001`;
const api = aeroapiFalsa({
  'GET /flights/TP103/canonical': () => ({ status: 200, json: { idents: [{ ident: 'TAP103', ident_type: 'designator' }] } }),
  'GET /flights/TAP103': () => ({ status: 200, json: { flights: [vooAeroapi()], num_pages: 1 } }),
  'GET /flights/*': (u) => {
    const id = decodeURIComponent(u.pathname.split('/').pop());
    return { status: 200, json: { flights: [vooAeroapi({ fa_flight_id: id, ident: id.split('-')[0], ident_icao: id.split('-')[0] })] } };
  },
});
let s;
before(async () => { s = await subir({ fetch: api.buscar }); });
after(() => s.fechar());

const conta = (metodo, caminho) => api.chamadas.filter((c) => c.metodo === metodo && (caminho instanceof RegExp ? caminho.test(c.caminho) : c.caminho === caminho)).length;

test('busca por número: IATA vira ICAO pelo /canonical (R6) e o resultado fica em cache', async () => {
  const c = s.cliente();
  const r = await c.pedir('/api/voos/buscar?ident=tp103&data=2026-11-14');
  assert.equal(r.status, 200);
  assert.equal(r.json.voos.length, 1);
  assert.equal(r.json.voos[0].ident, 'TAP103');
  assert.ok(c.jar.aparelho, 'cookie do aparelho criado na primeira chamada');
  const r2 = await c.pedir('/api/voos/buscar?ident=TP103&data=2026-11-14');
  assert.equal(r2.json.voos.length, 1);
  assert.equal(conta('GET', '/flights/TAP103'), 1, 'segunda busca veio do cache');
  assert.equal(conta('GET', '/flights/TP103/canonical'), 1);
  const custo = s.db.prepare("SELECT SUM(custo) s FROM CHAMADA_API WHERE tipo IN ('canonical','flights')").get().s;
  assert.equal(Math.round(custo * 1000) / 1000, 0.006);
});

test('R4: data fora de hoje..+2 → 400 invalido', async () => {
  const r = await s.cliente().pedir('/api/voos/buscar?ident=TAP103&data=2026-11-20');
  assert.equal(r.status, 400);
  assert.equal(r.json.erro, 'invalido');
  assert.ok(r.json.mensagem);
});

test('R1: duas pessoas no mesmo voo compartilham um alerta; R3: só apaga quando sai o último', async () => {
  const a = s.cliente(), b = s.cliente();
  const ra = await a.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: fa(3), apelido: 'Mãe', push: SUB(1) } });
  assert.equal(ra.status, 201);
  assert.equal(ra.json.voo.fa_flight_id, fa(3));
  const rb = await b.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: fa(3), apelido: 'Ana', push: null } });
  assert.equal(rb.status, 201);
  assert.equal(conta('POST', '/alerts'), 1);
  const corpoAlerta = api.chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/alerts').corpo;
  assert.equal(corpoAlerta.origin, 'LPPT');
  assert.equal(corpoAlerta.destination, 'SBGR');
  assert.equal(corpoAlerta.start, '2026-11-14');
  assert.equal(corpoAlerta.eta, 40);
  assert.equal(corpoAlerta.events.off, true);
  assert.match(corpoAlerta.target_url, /\/webhook\/aeroapi\/segredo-de-teste/);

  const lista = await a.pedir('/api/inscricoes');
  assert.equal(lista.json.inscricoes.length, 1);
  assert.equal(lista.json.inscricoes[0].apelido, 'Mãe');
  assert.equal(lista.json.inscricoes[0].voo.ident, 'TAP103');

  const del = await a.pedir(`/api/inscricoes/${ra.json.id}`, { metodo: 'DELETE' });
  assert.equal(del.status, 204);
  assert.equal(conta('DELETE', /^\/alerts\//), 0, 'ainda tem inscrito');
  const outro = await a.pedir(`/api/inscricoes/${rb.json.id}`, { metodo: 'DELETE' });
  assert.equal(outro.status, 404, 'não apaga inscrição de outro aparelho');
  await b.pedir(`/api/inscricoes/${rb.json.id}`, { metodo: 'DELETE' });
  assert.equal(conta('DELETE', /^\/alerts\//), 1);
});

test('PUT /api/inscricoes/:id/push liga o push depois', async () => {
  const c = s.cliente();
  const r = await c.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: fa(4), apelido: null, push: null } });
  const p = await c.pedir(`/api/inscricoes/${r.json.id}/push`, { metodo: 'PUT', corpo: { push: SUB(9) } });
  assert.equal(p.status, 204);
  assert.equal(s.db.prepare('SELECT push_endpoint FROM INSCRICAO WHERE id = ?').get(r.json.id).push_endpoint, SUB(9).endpoint);
  const ruim = await c.pedir(`/api/inscricoes/${r.json.id}/push`, { metodo: 'PUT', corpo: { push: { endpoint: 'http://x' } } });
  assert.equal(ruim.status, 400);
});

test('limite: 5 voos ativos por aparelho sem conta → 6º dá 429 limite', async () => {
  const c = s.cliente();
  for (let n = 0; n < 5; n++) {
    const r = await c.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: `LIM${n}-1-schedule-0001` } });
    assert.equal(r.status, 201, `voo ${n}`);
  }
  const r = await c.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: 'LIM9-1-schedule-0001' } });
  assert.equal(r.status, 429);
  assert.equal(r.json.erro, 'limite');
  const repetido = await c.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: 'LIM0-1-schedule-0001', apelido: 'Pai' } });
  assert.equal(repetido.status, 200, 'mesmo voo de novo só atualiza');
  const eu = await c.pedir('/api/eu');
  assert.deepEqual(eu.json.limites, { voos: 5, buscas_rota: 3 });
  assert.equal(eu.json.uso.voos, 5);
  assert.equal(eu.json.conta, null);
});

test('entrar com Google leva as inscrições do aparelho para a conta, sem duplicar', async () => {
  const cel = s.cliente(), pc = s.cliente();
  const token = tokenGoogle({ sub: 'g-1', email: 'pessoa@exemplo.com', name: 'Pessoa' });
  await pc.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: token } });
  await pc.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: fa(5), apelido: 'Ana' } });
  await cel.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: fa(5), apelido: 'Ana' } });
  await cel.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: fa(6), apelido: 'Pai' } });
  const r = await cel.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: token } });
  assert.equal(r.status, 200);
  assert.equal(r.json.conta.email, 'pessoa@exemplo.com');
  assert.equal(r.json.conta.admin, false);
  assert.deepEqual(r.json.limites, { voos: 15, buscas_rota: 10 });
  assert.equal(r.json.uso.voos, 2);
  const lista = await pc.pedir('/api/inscricoes');
  assert.deepEqual(lista.json.inscricoes.map((i) => i.voo.fa_flight_id).sort(), [fa(5), fa(6)]);
  // Sair: o aparelho volta a ser anônimo e continua com os voos que já tinha.
  const sair = await cel.pedir('/api/sessao', { metodo: 'DELETE' });
  assert.equal(sair.status, 204);
  const eu = await cel.pedir('/api/eu');
  assert.equal(eu.json.conta, null);
  assert.ok((await cel.pedir('/api/inscricoes')).json.inscricoes.some((i) => i.voo.fa_flight_id === fa(6)));
});

test('sem AEROAPI_KEY: rotas que chamam a AeroAPI dão 503 aeroapi_sem_chave', async () => {
  const antes = process.env.AEROAPI_KEY;
  process.env.AEROAPI_KEY = '';
  try {
    const c = s.cliente();
    const r = await c.pedir('/api/voos/buscar?ident=AZU4001&data=2026-11-14');
    assert.equal(r.status, 503);
    assert.equal(r.json.erro, 'aeroapi_sem_chave');
    const i = await c.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: 'NOVO1-1-schedule-0001' } });
    assert.equal(i.status, 503);
    assert.equal(i.json.erro, 'aeroapi_sem_chave');
    const cfg = await c.pedir('/api/config');
    assert.equal(cfg.json.aeroapi, false);
    const conhecido = await c.pedir(`/api/voos/${fa(3)}`);
    assert.equal(conhecido.status, 200, 'voo que já está no banco continua aparecendo');
  } finally {
    process.env.AEROAPI_KEY = antes;
  }
});
