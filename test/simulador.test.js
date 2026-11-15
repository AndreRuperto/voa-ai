import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../server/db.js';
import { criarAeroapi } from '../server/aeroapi.js';
import { criarFetchSimulado, simulacaoLigada, CATALOGO } from '../server/simulador.js';

const AGORA = Date.parse('2026-11-15T15:00:00Z');
const api = () => criarAeroapi({
  db: abrirBanco(':memory:'), agora: () => new Date(AGORA), chave: () => 'simulada', bloqueado: () => false,
  fetch: criarFetchSimulado({ agora: () => AGORA }),
});

test('simulação não liga em produção', () => {
  assert.equal(simulacaoLigada({ AEROAPI_SIMULADA: '1' }), true);
  assert.equal(simulacaoLigada({ AEROAPI_SIMULADA: '1', RAILWAY_ENVIRONMENT_NAME: 'production' }), false);
  assert.equal(simulacaoLigada({ AEROAPI_SIMULADA: '1', NODE_ENV: 'production' }), false);
  assert.equal(simulacaoLigada({}), false);
});

test('busca por número: IATA vira ICAO e há sempre um voo no ar', async () => {
  const a = api();
  assert.deepEqual(await a.canonical('TP1018'), ['TAP1018']);
  for (const item of CATALOGO) {
    const voos = await a.voosPorIdent(item.icao, { start: '2026-11-15T00:00:00Z', end: '2026-11-16T00:00:00Z' });
    assert.equal(voos.length, 3);
    const noAr = voos.filter((v) => v.actual_off && !v.actual_on);
    const antes = voos.filter((v) => v.actual_on);
    assert.ok(noAr.length + antes.length >= 1, item.iata);
    assert.equal(voos[0].origin.code_iata, item.de);
  }
});

test('voo pelo id e por rota; alertas respondem', async () => {
  const a = api();
  const [v] = await a.voosPorIdent('GLO1402', { start: '2026-11-15T00:00:00Z', end: '2026-11-16T00:00:00Z' });
  assert.equal((await a.vooPorId(v.fa_flight_id)).fa_flight_id, v.fa_flight_id);
  const rota = await a.voosEntre('SBGR', 'SBRJ', { start: '2026-11-15T14:00:00Z', end: '2026-11-15T16:00:00Z' });
  assert.ok(rota.length >= 7 && rota.every((f) => f.ident === 'GLO1402'));
  assert.equal(await a.criarAlerta({}), 1);
  await a.apagarAlerta(1);
});
