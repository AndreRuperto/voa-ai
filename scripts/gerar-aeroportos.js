#!/usr/bin/env node
// Gera server/dados/aeroportos.json e server/dados/companhias.json a partir de bases públicas.
//
//   node scripts/gerar-aeroportos.js [pasta-temporaria]
//
// Fontes (baixadas para uma pasta temporária e lidas só como dados):
// - OurAirports (domínio público): airports.csv e countries.csv
// - mwgg/Airports (MIT): airports.json, de onde vem o fuso (`tz`), juntado pelo ICAO
// - OpenFlights (ODbL): airlines.dat, de onde vem o nome da companhia pelo ICAO, e routes.dat,
//   de onde vem `rotas` (quantas rotas regulares saem ou chegam): a medida de movimento que põe
//   Guarulhos antes de Belém e Narita antes de Aomori na escolha de aeroportos
//
// Ficam só os aeroportos large_airport/medium_airport com código IATA e serviço regular.
// Quando a base de fusos não tem o aeroporto, usa o fuso do aeroporto mais próximo do mesmo país.
// Nomes: server/dados/nomes-pt.json (curado à mão) troca cidade e nome por versões curtas em português;
// os demais ganham um nome curto tirando "International Airport" e afins do nome oficial.
//
// Depois de regerar: suba VERSAO_LUGARES em public/app.js (o navegador guarda países e aeroportos por 1 dia).

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONTES = {
  aeroportos: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
  paises: 'https://davidmegginson.github.io/ourairports-data/countries.csv',
  fusos: 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json',
  companhias: 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat',
  rotas: 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat',
};

async function baixar(url, destino) {
  if (existsSync(destino)) return readFileSync(destino, 'utf8');
  const r = await fetch(url, { headers: { 'user-agent': 'voa-ai-gerador' } });
  if (!r.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${r.status}`);
  const texto = await r.text();
  writeFileSync(destino, texto);
  return texto;
}

/** CSV simples com aspas (RFC 4180). */
export function lerCsv(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return resto.filter((l) => l.length === cab.length).map((l) => Object.fromEntries(cab.map((k, i) => [k, l[i]])));
}

/** Nome oficial → nome curto ("Viracopos International Airport" → "Viracopos"). */
export function nomeCurto(nome, cidade) {
  const n = String(nome || '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/(International|Int'l|Intl\.?|Regional|Municipal|National|Domestic|Interstate|State)?\s*(Airport|Airfield|Aerodrome)/gi, '')
    .replace(/^(Aeropuerto|Aeroporto|Aéroport|Flughafen)\s+(Internacional\s+|International\s+)?(de\s+|d')?/i, '')
    .replace(/\s+/g, ' ').replace(/[\s,–-]+$/, '').trim();
  return n || cidade || nome;
}

/**
 * routes.dat (OpenFlights): companhia,id,origem,id,destino,id,codeshare,paradas,equipamento.
 * Conta, por IATA, quantas rotas diretas e próprias (sem codeshare) saem ou chegam no aeroporto.
 */
export function contarRotas(dat) {
  const conta = new Map();
  for (const linha of String(dat || '').split('\n')) {
    const c = linha.split(',');
    if (c.length < 8 || c[6] === 'Y' || c[7] !== '0') continue;
    for (const iata of [c[2], c[4]]) if (/^[A-Z]{3}$/.test(iata)) conta.set(iata, (conta.get(iata) || 0) + 1);
  }
  return conta;
}

function distancia(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(h));
}

async function main() {
  const pasta = process.argv[2] || mkdtempSync(join(tmpdir(), 'voa-ai-aeroportos-'));
  mkdirSync(pasta, { recursive: true });
  console.log(`Baixando fontes em ${pasta}`);
  const [csvAero, csvPaises, jsonFusos, datCompanhias, datRotas] = await Promise.all([
    baixar(FONTES.aeroportos, join(pasta, 'airports.csv')),
    baixar(FONTES.paises, join(pasta, 'countries.csv')),
    baixar(FONTES.fusos, join(pasta, 'fusos.json')),
    baixar(FONTES.companhias, join(pasta, 'airlines.dat')),
    baixar(FONTES.rotas, join(pasta, 'routes.dat')),
  ]);
  const rotasPorIata = contarRotas(datRotas);

  const fusos = JSON.parse(jsonFusos);
  const fusoPorIcao = new Map();
  const fusoPorIata = new Map();
  for (const [icao, a] of Object.entries(fusos)) {
    if (!a || typeof a.tz !== 'string' || !a.tz) continue;
    fusoPorIcao.set(icao.toUpperCase(), a.tz);
    if (a.iata) fusoPorIata.set(String(a.iata).toUpperCase(), a.tz);
  }

  const nomesPaisPt = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
  const paisesCsv = lerCsv(csvPaises);
  const nomePais = new Map(paisesCsv.map((p) => {
    let nome = p.name;
    try { const n = nomesPaisPt.of(p.code); if (n && n !== p.code) nome = n; } catch { /* código fora do padrão */ }
    return [p.code, nome];
  }));

  const aeroportos = [];
  for (const a of lerCsv(csvAero)) {
    if (a.type !== 'large_airport' && a.type !== 'medium_airport') continue;
    if (a.scheduled_service !== 'yes') continue;
    const iata = (a.iata_code || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    const icao = ((a.icao_code || a.gps_code || '').trim().toUpperCase()) || null;
    const lat = Number(a.latitude_deg), lon = Number(a.longitude_deg);
    aeroportos.push({
      iata,
      icao: icao && /^[A-Z0-9]{4}$/.test(icao) ? icao : null,
      nome: a.name,
      cidade: a.municipality || null,
      pais: a.iso_country,
      lat: Number.isFinite(lat) ? Math.round(lat * 1e4) / 1e4 : null,
      lon: Number.isFinite(lon) ? Math.round(lon * 1e4) / 1e4 : null,
      fuso: (icao && fusoPorIcao.get(icao)) || fusoPorIata.get(iata) || null,
      grande: a.type === 'large_airport',
      rotas: rotasPorIata.get(iata) || 0,
    });
  }

  // Fuso que faltou: o do aeroporto mais próximo do mesmo país.
  let estimados = 0;
  for (const a of aeroportos) {
    if (a.fuso || a.lat == null) continue;
    let melhor = null, dMin = Infinity;
    for (const b of aeroportos) {
      if (!b.fuso || b.pais !== a.pais || b.lat == null) continue;
      const d = distancia(a, b);
      if (d < dMin) { dMin = d; melhor = b; }
    }
    if (melhor) { a.fuso = melhor.fuso; estimados++; }
  }

  const arqNomes = join(RAIZ, 'server', 'dados', 'nomes-pt.json');
  const nomesPt = existsSync(arqNomes) ? JSON.parse(readFileSync(arqNomes, 'utf8')).nomes : {};
  for (const a of aeroportos) {
    const pt = nomesPt[a.iata];
    if (pt) { a.cidade = pt.cidade || a.cidade; a.nome = pt.nome || a.nome; }
    else a.nome = nomeCurto(a.nome, a.cidade);
  }

  aeroportos.sort((x, y) => x.iata.localeCompare(y.iata));
  const contagem = new Map();
  for (const a of aeroportos) contagem.set(a.pais, (contagem.get(a.pais) || 0) + 1);
  const paises = [...contagem.keys()]
    .map((codigo) => ({ codigo, nome: nomePais.get(codigo) || codigo }))
    .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));

  // Companhias: ICAO → nome (só as ativas).
  const companhias = {};
  for (const linha of datCompanhias.split('\n')) {
    const c = lerCsv('a,b,c,d,e,f,g,h\n' + linha.replace(/\\N/g, ''))[0];
    if (!c) continue;
    const icao = (c.e || '').trim().toUpperCase();
    if (c.h !== 'Y' || !/^[A-Z]{3}$/.test(icao) || !c.b) continue;
    if (!companhias[icao]) companhias[icao] = c.b.trim();
  }

  const saida = join(RAIZ, 'server', 'dados');
  mkdirSync(saida, { recursive: true });
  const gerado_em = new Date().toISOString().slice(0, 10);
  writeFileSync(join(saida, 'aeroportos.json'), JSON.stringify({
    gerado_em,
    fontes: ['OurAirports (domínio público)', 'mwgg/Airports (fusos, MIT)', 'OpenFlights routes.dat (rotas, ODbL)'],
    paises,
    aeroportos,
  }));
  writeFileSync(join(saida, 'companhias.json'), JSON.stringify({
    gerado_em,
    fonte: 'OpenFlights airlines.dat (ODbL)',
    companhias,
  }));
  const semFuso = aeroportos.filter((a) => !a.fuso).length;
  console.log(`${aeroportos.length} aeroportos em ${paises.length} países (${estimados} fusos pelo vizinho, ${semFuso} sem fuso).`);
  console.log(`${Object.keys(companhias).length} companhias.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
