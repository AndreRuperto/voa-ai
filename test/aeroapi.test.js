import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../server/db.js';
import { criarAeroapi, ErroAeroapi } from '../server/aeroapi.js';

const resposta = (status, json, headers = {}) => new Response(json == null ? null : JSON.stringify(json), { status, headers });

test('sem chave: erro tipado aeroapi_sem_chave (503) e nenhuma chamada', async () => {
  let chamou = false;
  const api = criarAeroapi({ db: abrirBanco(), chave: () => '', fetch: async () => { chamou = true; } });
  assert.equal(api.temChave(), false);
  await assert.rejects(api.voosPorIdent('TAP103', {}), (e) => e instanceof ErroAeroapi && e.codigo === 'aeroapi_sem_chave' && e.http === 503);
  assert.equal(chamou, false);
});

test('429 e 5xx: tenta de novo com espera e registra o preço', async () => {
  const db = abrirBanco();
  const esperas = [];
  const fila = [resposta(429, {}, { 'retry-after': '2' }), resposta(503, {}), resposta(200, { flights: [{ fa_flight_id: 'A' }], num_pages: 2 })];
  const api = criarAeroapi({ db, chave: () => 'k', fetch: async () => fila.shift(), esperar: async (ms) => { esperas.push(ms); } });
  const voos = await api.voosPorIdent('TAP103', { start: 'a', end: 'b' });
  assert.equal(voos.length, 1);
  assert.deepEqual(esperas, [2000, 2000]);
  const l = db.prepare('SELECT * FROM CHAMADA_API').all();
  assert.equal(l.length, 1);
  assert.equal(l[0].endpoint, 'GET /flights/{ident}');
  assert.equal(l[0].paginas, 2);
  assert.equal(l[0].custo, 0.01);
});

test('erro depois das tentativas: aeroapi_falhou (502)', async () => {
  const api = criarAeroapi({ db: abrirBanco(), chave: () => 'k', tentativas: 1, esperar: async () => {}, fetch: async () => resposta(500, { title: 'x' }) });
  await assert.rejects(api.vooPorId('A'), (e) => e.codigo === 'aeroapi_falhou' && e.http === 502);
});

test('criar alerta lê o id do Location', async () => {
  const api = criarAeroapi({ db: abrirBanco(), chave: () => 'k', fetch: async () => resposta(201, null, { location: '/aeroapi/alerts/98765' }) });
  assert.equal(await api.criarAlerta({ ident: 'TAP103' }), 98765);
});
