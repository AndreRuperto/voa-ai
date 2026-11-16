import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarAeroportos, textoResultados, rotuloAeroporto } from '../public/aeroportos.js';

const AEROS = [
  { iata: 'GRU', nome: 'Guarulhos', cidade: 'São Paulo' },
  { iata: 'BSB', nome: 'Brasília', cidade: 'Brasília' },
  { iata: 'GIG', nome: 'Galeão', cidade: 'Rio de Janeiro' },
  { iata: 'SSA', nome: 'Salvador', cidade: 'Salvador' },
  { iata: 'CGH', nome: 'Congonhas', cidade: 'São Paulo' },
  { iata: 'POA', nome: 'Salgado Filho', cidade: 'Porto Alegre' },
  { iata: 'SDU', nome: 'Santos Dumont', cidade: 'Rio de Janeiro' },
];
const codigos = l => l.map(a => a.iata);

test('filtrarAeroportos: sem termo devolve a lista inteira, na mesma ordem', () => {
  assert.deepEqual(filtrarAeroportos(AEROS, ''), AEROS);
  assert.deepEqual(filtrarAeroportos(AEROS, '   '), AEROS);
});

test('filtrarAeroportos: acha pela cidade, sem acento e sem maiúscula', () => {
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'sao paulo')), ['GRU', 'CGH']);
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'RIO')), ['GIG', 'SDU']);
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'brasilia')), ['BSB']);
});

test('filtrarAeroportos: acha pelo nome do aeroporto', () => {
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'galeao')), ['GIG']);
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'dumont')), ['SDU']);
});

test('filtrarAeroportos: o código IATA exato vem primeiro', () => {
  // "sal" começa Salvador e Salgado Filho; "ssa" só o código
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'ssa')), ['SSA']);
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'sal')), ['SSA', 'POA']);
  // "gru" é código de um e está dentro de nenhum nome: só ele
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'gru')), ['GRU']);
  // "san" é começo de palavra (Santos) e não é código: SDU
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'san')), ['SDU']);
});

test('filtrarAeroportos: começo de palavra vem antes de "contém"', () => {
  // "lo": nenhum começa com "lo"; Paulo contém → GRU e CGH
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'lo')), ['GRU', 'CGH']);
  // "alegre" começa palavra em Porto Alegre; nada mais
  assert.deepEqual(codigos(filtrarAeroportos(AEROS, 'alegre')), ['POA']);
  assert.deepEqual(filtrarAeroportos(AEROS, 'xyz'), []);
});

test('filtrarAeroportos: aguenta campos faltando', () => {
  assert.deepEqual(codigos(filtrarAeroportos([{ iata: 'XXX' }, { iata: 'ABC', nome: 'Abc' }], 'ab')), ['ABC']);
});

test('rotuloAeroporto: nome e, se for diferente, a cidade', () => {
  assert.equal(rotuloAeroporto(AEROS[0]), 'Guarulhos, São Paulo');
  assert.equal(rotuloAeroporto(AEROS[3]), 'Salvador');
  assert.equal(rotuloAeroporto({ iata: 'XXX', cidade: 'Lugar' }), 'Lugar');
  assert.equal(rotuloAeroporto({ iata: 'XXX' }), '');
});

test('textoResultados: frase para leitor de tela', () => {
  assert.equal(textoResultados(0, 'xyz'), 'Nenhum aeroporto com “xyz”.');
  assert.equal(textoResultados(1, 'ssa'), '1 aeroporto. Use as setas e Enter para marcar.');
  assert.equal(textoResultados(3, 'rio'), '3 aeroportos. Use as setas e Enter para marcar.');
  assert.equal(textoResultados(40, ''), '40 aeroportos. Use as setas e Enter para marcar.');
});
