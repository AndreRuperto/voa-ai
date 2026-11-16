import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandeira, normalizar, filtrarPaises } from '../public/paises.js';

const PAISES = [
  { codigo: 'ZA', nome: 'África do Sul' }, { codigo: 'DE', nome: 'Alemanha' }, { codigo: 'BR', nome: 'Brasil' },
  { codigo: 'JP', nome: 'Japão' }, { codigo: 'KR', nome: 'Coreia do Sul' }, { codigo: 'AE', nome: 'Emirados Árabes Unidos' },
];
const nomes = l => l.map(p => p.nome);

test('bandeira: código ISO vira emoji de bandeira; lixo vira vazio', () => {
  assert.equal(bandeira('BR'), '\u{1F1E7}\u{1F1F7}');
  assert.equal(bandeira('JP'), '\u{1F1EF}\u{1F1F5}');
  for (const ruim of ['', 'br', 'BRA', '1A', null, undefined, '<s']) assert.equal(bandeira(ruim), '');
});

test('normalizar: sem acento, minúsculo, sem espaço nas pontas', () => {
  assert.equal(normalizar('  Japão '), 'japao');
  assert.equal(normalizar('ÁFRICA'), 'africa');
});

test('filtrarPaises: sem termo devolve tudo, na mesma ordem', () => {
  assert.deepEqual(filtrarPaises(PAISES, '  '), PAISES);
});

test('filtrarPaises: acha sem acento e pelo código', () => {
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'japao')), ['Japão']);
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'jp')), ['Japão']);
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'arabes')), ['Emirados Árabes Unidos']);
});

test('filtrarPaises: começo de palavra vem antes de "contém"', () => {
  // "sul": começo de palavra em África do Sul e Coreia do Sul; "brasil" não contém
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'sul')), ['África do Sul', 'Coreia do Sul']);
  // "ul": não começa nenhuma palavra; só "contém" → ainda aparece
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'ul')), ['África do Sul', 'Coreia do Sul']);
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'al')), ['Alemanha']);
  assert.deepEqual(nomes(filtrarPaises(PAISES, 'as')), ['Brasil']);
  assert.deepEqual(filtrarPaises(PAISES, 'xyz'), []);
});
