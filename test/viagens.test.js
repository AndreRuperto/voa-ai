import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparViagens, conexao, momentoDaViagem } from '../public/viagens.js';

const t = (h) => new Date(Date.UTC(2026, 10, 15, 0, 0) + h * 3600_000).toISOString();
const voo = (id, de, para, sai, chega, estado = 'previsto', extra = {}) => ({
  fa_flight_id: id, estado, origem: { iata: de }, destino: { iata: para },
  horarios: { saida_prevista: t(sai), chegada_prevista: t(chega), ...extra },
});
const insc = (v, apelido = '') => ({ id: v.fa_flight_id, apelido, voo: v });

test('junta as pernas encadeadas e deixa voo solto sozinho', () => {
  const g = agruparViagens([
    insc(voo('B', 'DXB', 'NRT', 18, 28), 'Ana'),
    insc(voo('A', 'GRU', 'DXB', 1, 15), 'Ana'),
    insc(voo('X', 'GIG', 'CNF', 2, 3), 'Vô Zé'),
  ]);
  assert.deepEqual(g.map((x) => x.pernas.map((p) => p.id)), [['A', 'B'], ['X']]);
});

test('não junta pessoas diferentes, nem escala de mais de 24 h, nem aeroporto diferente', () => {
  const ids = (l) => agruparViagens(l).map((x) => x.pernas.map((p) => p.id));
  assert.deepEqual(ids([insc(voo('A', 'GRU', 'DXB', 1, 15), 'Ana'), insc(voo('B', 'DXB', 'NRT', 18, 28), 'Bia')]), [['A'], ['B']]);
  assert.deepEqual(ids([insc(voo('A', 'GRU', 'DXB', 1, 15)), insc(voo('B', 'DXB', 'NRT', 40, 50))]), [['A'], ['B']]);
  assert.deepEqual(ids([insc(voo('A', 'GRU', 'DXB', 1, 15)), insc(voo('B', 'DOH', 'NRT', 18, 28))]), [['A'], ['B']]);
});

test('três pernas viram uma viagem', () => {
  const g = agruparViagens([insc(voo('C', 'FRA', 'NRT', 20, 30)), insc(voo('A', 'GRU', 'LIS', 0, 10)), insc(voo('B', 'LIS', 'FRA', 12, 15))]);
  assert.deepEqual(g[0].pernas.map((p) => p.id), ['A', 'B', 'C']);
});

test('risco da conexão', () => {
  const a = voo('A', 'GRU', 'DXB', 1, 15), b = voo('B', 'DXB', 'NRT', 18, 28);
  assert.deepEqual([conexao(a, b).minutos, conexao(a, b).risco], [180, 'ok']);
  const atrasado = voo('A', 'GRU', 'DXB', 1, 15, 'em_voo', { chegada_estimada: t(17.5) });
  assert.equal(conexao(atrasado, b).risco, 'apertada');
  const muito = voo('A', 'GRU', 'DXB', 1, 15, 'em_voo', { chegada_estimada: t(18.5) });
  assert.equal(conexao(muito, b).risco, 'perdida');
  assert.equal(conexao(a, voo('B', 'DXB', 'NRT', 18, 28, 'cancelado')).risco, 'perdida');
});

test('momento da viagem', () => {
  const a = voo('A', 'GRU', 'DXB', 1, 15), b = voo('B', 'DXB', 'NRT', 18, 28);
  assert.equal(momentoDaViagem([a, b]).fase, 'antes');
  assert.deepEqual(momentoDaViagem([{ ...a, estado: 'em_voo' }, b]).fase, 'voando');
  const m = momentoDaViagem([{ ...a, estado: 'no_portao_destino' }, b]);
  assert.deepEqual([m.fase, m.indice], ['conexao', 1]);
  assert.equal(momentoDaViagem([{ ...a, estado: 'pousou' }, { ...b, estado: 'pousou' }]).fase, 'chegou');
});
