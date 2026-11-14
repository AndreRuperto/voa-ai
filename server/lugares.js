// Lista estática de países, aeroportos e companhias (server/dados/*.json, gerados por scripts/gerar-aeroportos.js).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA = join(dirname(fileURLToPath(import.meta.url)), 'dados');

function ler(nome, vazio) {
  const caminho = join(PASTA, nome);
  if (!existsSync(caminho)) {
    console.warn(`[lugares] ${nome} não existe. Rode: node scripts/gerar-aeroportos.js`);
    return vazio;
  }
  return JSON.parse(readFileSync(caminho, 'utf8'));
}

const dadosAero = ler('aeroportos.json', { paises: [], aeroportos: [] });
const dadosCia = ler('companhias.json', { companhias: {} });

const porIata = new Map();
const porIcao = new Map();
for (const a of dadosAero.aeroportos) {
  porIata.set(a.iata, a);
  if (a.icao) porIcao.set(a.icao, a);
}

/** Aeroporto pelo código IATA ou ICAO (ou null). */
export function aeroporto(codigo) {
  if (!codigo) return null;
  const c = String(codigo).toUpperCase();
  return (c.length === 3 ? porIata.get(c) : porIcao.get(c)) || porIata.get(c) || porIcao.get(c) || null;
}

/** Países com quantidade de aeroportos, em PT-BR, em ordem alfabética. */
export function listarPaises() {
  const conta = new Map();
  for (const a of dadosAero.aeroportos) conta.set(a.pais, (conta.get(a.pais) || 0) + 1);
  return dadosAero.paises.map((p) => ({ codigo: p.codigo, nome: p.nome, aeroportos: conta.get(p.codigo) || 0 }));
}

/** Aeroportos de um país: grandes primeiro, depois por cidade. */
export function aeroportosDoPais(pais) {
  const c = String(pais || '').toUpperCase();
  return dadosAero.aeroportos
    .filter((a) => a.pais === c)
    .sort((x, y) => (y.grande - x.grande) || String(x.cidade || x.nome).localeCompare(String(y.cidade || y.nome), 'pt-BR'))
    .map(({ iata, icao, nome, cidade, lat, lon, grande }) => ({ iata, icao, nome, cidade, lat, lon, grande }));
}

/** Nome da companhia pelo ICAO do operador. */
export function companhia(icao) {
  return (icao && dadosCia.companhias[String(icao).toUpperCase()]) || null;
}
