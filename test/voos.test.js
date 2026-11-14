import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapearVoo, normalizarVoo, calcularEstado, atrasoMin, dataDaPartida } from '../server/voos.js';
import { vooAeroapi } from './ajuda.js';

const agora = new Date('2026-11-14T12:00:00Z');

test('mapeia o voo da AeroAPI para o objeto Voo do contrato', () => {
  const v = mapearVoo(normalizarVoo(vooAeroapi()), { agora });
  assert.equal(v.fa_flight_id, 'TAP103-1763000000-schedule-0001');
  assert.equal(v.ident, 'TAP103');
  assert.equal(v.ident_iata, 'TP103');
  assert.equal(v.aeronave, 'A339');
  assert.ok(v.companhia && v.companhia !== 'TAP', 'nome da companhia vem da lista estática');
  assert.equal(v.origem.iata, 'LIS');
  assert.equal(v.origem.icao, 'LPPT');
  assert.equal(v.origem.fuso, 'Europe/Lisbon');
  assert.equal(typeof v.origem.lat, 'number');
  assert.equal(v.destino.iata, 'GRU');
  assert.equal(v.destino.fuso, 'America/Sao_Paulo');
  assert.deepEqual(Object.keys(v.horarios), [
    'saida_prevista', 'saida_estimada', 'saida_real', 'decolagem_real',
    'pouso_previsto', 'pouso_estimado', 'pouso_real', 'chegada_prevista', 'chegada_estimada', 'chegada_real',
  ]);
  assert.equal(v.horarios.saida_prevista, '2026-11-14T15:00:00Z');
  assert.equal(v.horarios.chegada_prevista, '2026-11-14T23:40:00Z');
  assert.equal(v.estado, 'previsto');
  assert.equal(v.atraso_min, 0);
  assert.equal(v.progresso, 0);
  assert.equal(typeof v.atualizado_em, 'string');
});

test('aeroporto desconhecido vem com lat/lon null', () => {
  const v = mapearVoo(normalizarVoo(vooAeroapi({ destination: { code: 'ZZZZ', code_icao: 'ZZZZ', name: 'Pista X', city: 'Lugar', timezone: 'UTC' } })), { agora });
  assert.equal(v.destino.lat, null);
  assert.equal(v.destino.lon, null);
  assert.equal(v.destino.nome, 'Pista X');
});

test('estado: atrasado, no_portao, em_voo, pousou, no_portao_destino, cancelado, desviado', () => {
  const e = (sobre, quando = agora) => calcularEstado(normalizarVoo(vooAeroapi(sobre)), quando);
  assert.equal(e({}), 'previsto');
  assert.equal(e({ estimated_out: '2026-11-14T15:20:00Z' }), 'atrasado');
  assert.equal(e({ estimated_out: '2026-11-14T15:14:00Z' }), 'previsto', '14 min não é atraso');
  assert.equal(e({}, new Date('2026-11-14T14:40:00Z')), 'no_portao');
  assert.equal(e({ actual_out: '2026-11-14T15:02:00Z' }), 'no_portao');
  assert.equal(e({ actual_out: '2026-11-14T15:02:00Z', actual_off: '2026-11-14T15:20:00Z', estimated_out: '2026-11-14T15:40:00Z' }), 'em_voo', 'atrasado só vale antes de decolar');
  assert.equal(e({ actual_off: '2026-11-14T15:20:00Z', actual_on: '2026-11-14T23:25:00Z' }), 'pousou');
  assert.equal(e({ actual_on: '2026-11-14T23:25:00Z', actual_in: '2026-11-14T23:35:00Z' }), 'no_portao_destino');
  assert.equal(e({ cancelled: true }), 'cancelado');
  assert.equal(e({ diverted: true, actual_off: '2026-11-14T15:20:00Z' }), 'desviado');
});

test('atraso_min usa a chegada estimada − prevista, arredondado, nunca negativo', () => {
  assert.equal(atrasoMin(normalizarVoo(vooAeroapi({ estimated_in: '2026-11-15T00:15:20Z' }))), 35);
  assert.equal(atrasoMin(normalizarVoo(vooAeroapi({ estimated_in: '2026-11-14T23:20:00Z' }))), 0);
});

test('progresso: 0 antes, fração do tempo em voo, 1 depois', () => {
  const emVoo = normalizarVoo(vooAeroapi({ actual_off: '2026-11-14T15:30:00Z', estimated_on: '2026-11-14T23:30:00Z' }));
  assert.equal(mapearVoo(emVoo, { agora: new Date('2026-11-14T19:30:00Z') }).progresso, 0.5);
  const pousou = normalizarVoo(vooAeroapi({ actual_off: '2026-11-14T15:30:00Z', actual_on: '2026-11-14T23:30:00Z' }));
  assert.equal(mapearVoo(pousou, { agora }).progresso, 1);
});

test('webhook com aeroporto em texto não apaga os dados que já estavam no banco', () => {
  const antes = normalizarVoo(vooAeroapi());
  const depois = normalizarVoo({
    fa_flight_id: antes.fa_flight_id, origin: 'LPPT', destination: 'SBGR', origin_icao: 'LPPT', destination_icao: 'SBGR',
    actual_off: '2026-11-14T15:20:00Z', estimated_in: null,
  }, antes);
  assert.equal(depois.origin.timezone, 'Europe/Lisbon');
  assert.equal(depois.estimated_in, '2026-11-14T23:40:00Z');
  assert.equal(depois.actual_off, '2026-11-14T15:20:00Z');
});

test('data da partida no fuso da origem', () => {
  assert.equal(dataDaPartida(normalizarVoo(vooAeroapi({ scheduled_out: '2026-11-15T00:30:00Z', origin: { code_icao: 'SBGR', code_iata: 'GRU', timezone: 'America/Sao_Paulo' } }))), '2026-11-14');
});

test('nomes em português e curtos (server/dados/nomes-pt.json)', async () => {
  const { aeroporto } = await import('../server/lugares.js');
  assert.equal(aeroporto('LIS').cidade, 'Lisboa');
  assert.equal(aeroporto('LIS').nome, 'Lisboa');
  assert.equal(aeroporto('GRU').nome, 'Guarulhos');
  assert.equal(aeroporto('GRU').cidade, 'São Paulo');
  assert.equal(aeroporto('SBGL').nome, 'Galeão');
  const v = mapearVoo(normalizarVoo(vooAeroapi()), { agora });
  assert.equal(v.origem.cidade, 'Lisboa');
  assert.equal(v.destino.nome, 'Guarulhos');
});
