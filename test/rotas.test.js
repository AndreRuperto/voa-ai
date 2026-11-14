import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi } from './ajuda.js';

prepararAmbiente();
const api = aeroapiFalsa({
  'GET /airports/*': (u) => {
    const [, , de, , , para] = u.pathname.replace(/^\/aeroapi/, '').split('/');
    const seg = vooAeroapi({
      fa_flight_id: `X${de}${para}-1-schedule-0001`,
      origin: { code: de, code_icao: de, timezone: 'Europe/Lisbon' },
      destination: { code: para, code_icao: para, timezone: 'America/Sao_Paulo' },
    });
    const comEscala = { segments: [seg, { ...seg, fa_flight_id: 'ESCALA' }] };
    return { status: 200, json: { flights: [{ segments: [seg] }, comEscala], num_pages: 1 } };
  },
});
let s;
before(async () => { s = await subir({ fetch: api.buscar }); });
after(() => s.fechar());
const rotaCalls = () => api.chamadas.filter((c) => c.caminho.startsWith('/airports/'));

test('busca por rota: só voos sem escala, cache de 30 min por par+dia', async () => {
  const c = s.cliente();
  const r = await c.pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14');
  assert.equal(r.status, 200);
  assert.equal(r.json.pares.length, 1);
  const p = r.json.pares[0];
  assert.deepEqual([p.de, p.para, p.cache], ['LIS', 'GRU', false]);
  assert.equal(p.voos.length, 1);
  assert.equal(rotaCalls()[0].caminho, '/airports/LPPT/flights/to/SBGR');
  assert.equal(rotaCalls()[0].query.connection, 'nonstop');

  const r2 = await s.cliente().pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14');
  assert.equal(r2.json.pares[0].cache, true);
  assert.equal(rotaCalls().length, 1, 'cache compartilhado entre aparelhos');

  s.relogio.atual = new Date('2026-11-14T12:31:00Z');
  const r3 = await s.cliente().pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14');
  assert.equal(r3.json.pares[0].cache, false, 'cache expira em 30 min');
  assert.equal(rotaCalls().length, 2);
  s.relogio.atual = new Date('2026-11-14T12:00:00Z');
});

test('no máximo 3 pares por busca', async () => {
  const r = await s.cliente().pedir('/api/rotas/buscar?de=LIS,OPO&para=GRU,GIG&data=2026-11-14');
  assert.equal(r.status, 400);
  assert.equal(r.json.erro, 'invalido');
  const ok3 = await s.cliente().pedir('/api/rotas/buscar?de=LIS,OPO&para=GRU&data=2026-11-14');
  assert.equal(ok3.status, 200);
  assert.equal(ok3.json.pares.length, 2);
});

test('limite de buscas por dia (3 sem conta) → 429 limite', async () => {
  const c = s.cliente();
  for (let i = 0; i < 3; i++) assert.equal((await c.pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14')).status, 200);
  const r = await c.pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14');
  assert.equal(r.status, 429);
  assert.equal(r.json.erro, 'limite');
  assert.equal((await c.pedir('/api/eu')).json.uso.buscas_rota_hoje, 3);
});

test('aeroporto desconhecido → 400; rota pausada → 503 pausado', async () => {
  assert.equal((await s.cliente().pedir('/api/rotas/buscar?de=XXX&para=GRU&data=2026-11-14')).status, 400);
  s.db.prepare("INSERT INTO CONFIG (chave, valor) VALUES ('rota_pausada', 'true')").run();
  const r = await s.cliente().pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14');
  assert.equal(r.status, 503);
  assert.equal(r.json.erro, 'pausado');
  s.db.prepare("DELETE FROM CONFIG WHERE chave = 'rota_pausada'").run();
});

test('lugares: países em PT-BR e aeroportos grandes primeiro', async () => {
  const c = s.cliente();
  const p = await c.pedir('/api/lugares/paises');
  const pt = p.json.paises.find((x) => x.codigo === 'PT');
  assert.equal(pt.nome, 'Portugal');
  assert.ok(pt.aeroportos >= 3);
  assert.equal(p.json.paises.find((x) => x.codigo === 'DE').nome, 'Alemanha');
  const a = await c.pedir('/api/lugares/aeroportos?pais=PT');
  assert.ok(a.json.aeroportos.some((x) => x.iata === 'LIS'));
  const grandes = a.json.aeroportos.map((x) => x.grande);
  assert.deepEqual(grandes, [...grandes].sort((x, y) => y - x));
  assert.deepEqual(Object.keys(a.json.aeroportos[0]), ['iata', 'icao', 'nome', 'cidade', 'lat', 'lon', 'grande']);
  assert.equal((await c.pedir('/api/lugares/aeroportos')).status, 400);
});
