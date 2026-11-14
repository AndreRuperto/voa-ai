import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarMensagem } from '../server/mensagens.js';

// Voo no formato do contrato, com os nomes do exemplo da docs/02.
const voo = {
  fa_flight_id: 'TAP103-1', ident: 'TAP103', ident_iata: 'TP103',
  origem: { iata: 'LIS', cidade: 'Lisboa', fuso: 'Europe/Lisbon' },
  destino: { iata: 'GRU', cidade: 'Guarulhos', fuso: 'America/Sao_Paulo' },
  horarios: {
    saida_prevista: '2026-12-20T10:30:00Z', saida_estimada: '2026-12-20T10:45:00Z', saida_real: '2026-12-20T10:47:00Z',
    decolagem_real: '2026-12-20T11:00:00Z',
    pouso_previsto: '2026-12-20T21:30:00Z', pouso_estimado: '2026-12-20T21:30:00Z', pouso_real: '2026-12-20T21:52:00Z',
    chegada_prevista: '2026-12-20T21:40:00Z', chegada_estimada: '2026-12-20T21:40:00Z', chegada_real: null,
  },
  estado: 'em_voo', atraso_min: 0, progresso: 0.5,
};
const corpo = (ev, op = {}, v = voo) => montarMensagem(ev, v, { apelido: 'Mãe', ...op })?.corpo;

test('out', () => assert.equal(corpo('out'), '🚪 O voo da Mãe saiu do portão em Lisboa'));

test('off e departure', () => {
  assert.equal(corpo('off'), '🛫 O voo da Mãe decolou de Lisboa. Chegada prevista às 18:40');
  assert.equal(corpo('departure'), corpo('off'));
});

test('minutes_out (eta)', () => {
  assert.equal(corpo('minutes_out', { agora: new Date('2026-12-20T20:50:00Z') }), '⏳ O voo da Mãe pousa em cerca de 40 min em Guarulhos. Hora de sair!');
});

test('on e arrival', () => {
  assert.equal(corpo('on'), '🛬 O voo da Mãe pousou em Guarulhos às 18:52');
  assert.equal(corpo('arrival'), corpo('on'));
});

test('in', () => assert.equal(corpo('in'), '✅ A Mãe chegou ao portão. Desembarque em breve'));

test('cancelled', () => assert.equal(corpo('cancelled'), '❌ O voo da Mãe foi cancelado pela companhia'));

test('diverted', () => {
  assert.equal(corpo('diverted', { desvio: { cidade: 'Campinas' } }), '⚠️ O voo da Mãe foi desviado para Campinas');
  assert.equal(corpo('diverted'), '⚠️ O voo da Mãe foi desviado');
});

test('atraso', () => {
  const atrasado = { ...voo, atraso_min: 35, horarios: { ...voo.horarios, chegada_estimada: '2026-12-20T22:15:00Z' } };
  assert.equal(corpo('atraso', {}, atrasado), '🕒 O voo da Mãe está atrasado 35 min. Nova chegada: 19:15');
});

test('sem apelido usa o número do voo', () => {
  assert.equal(montarMensagem('off', voo).corpo, '🛫 O voo TAP103 decolou de Lisboa. Chegada prevista às 18:40');
  assert.equal(montarMensagem('in', voo).corpo, '✅ O voo TAP103 chegou ao portão. Desembarque em breve');
});

test('horário no fuso do destino', () => {
  const lisboa = { ...voo, destino: { ...voo.destino, fuso: 'Europe/Lisbon' } };
  assert.equal(corpo('on', {}, lisboa), '🛬 O voo da Mãe pousou em Guarulhos às 21:52');
});

test('eventos sem aviso devolvem null', () => {
  for (const ev of ['filed', 'change', 'power_on', 'position_only_arrival', 'qualquer']) assert.equal(montarMensagem(ev, voo), null);
});
