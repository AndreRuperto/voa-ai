#!/usr/bin/env node
// Marco 1: busca os voos candidatos de um número numa data, direto na AeroAPI.
//
//   node scripts/buscar-voo.js TP103 [AAAA-MM-DD]
//
// Usa o mesmo cliente do servidor (server/aeroapi.js) e grava o custo num banco em memória.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(RAIZ, '.env'))) process.loadEnvFile(join(RAIZ, '.env'));

const { abrirBanco } = await import('../server/db.js');
const { criarAeroapi, ErroAeroapi } = await import('../server/aeroapi.js');
const { criarContexto } = await import('../server/app.js');
const { buscarPorIdent } = await import('../server/consultas.js');
const { hora } = await import('../server/mensagens.js');

const [identArg, dataArg] = process.argv.slice(2);
if (!identArg) {
  console.log('Uso: node scripts/buscar-voo.js TP103 [AAAA-MM-DD]');
  process.exit(1);
}
if (!process.env.AEROAPI_KEY) {
  console.log('AEROAPI_KEY está vazia no .env. Crie a chave em https://www.flightaware.com/aeroapi/portal e preencha AEROAPI_KEY.');
  process.exit(2);
}

const data = dataArg || new Date().toISOString().slice(0, 10);
const db = abrirBanco(':memory:');
const ctx = criarContexto({ db, aeroapi: criarAeroapi({ db }), verificarGoogle: async () => null, enviarPush: async () => {} });

try {
  const voos = await buscarPorIdent(ctx, { ident: identArg, data }, 'script');
  if (!voos.length) console.log(`Nenhum voo ${identArg.toUpperCase()} em ${data}. Confira o número e a data.`);
  for (const v of voos) {
    const fo = v.origem.fuso, fd = v.destino.fuso;
    console.log([
      `${v.ident}${v.ident_iata ? ` (${v.ident_iata})` : ''} · ${v.companhia || '?'} · ${v.aeronave || '?'}`,
      `  ${v.origem.iata || v.origem.icao} ${v.origem.cidade || ''} ${hora(v.horarios.saida_prevista, fo) || '--:--'} → ` +
        `${v.destino.iata || v.destino.icao} ${v.destino.cidade || ''} ${hora(v.horarios.chegada_prevista, fd) || '--:--'} (horas locais)`,
      `  estado: ${v.estado} · atraso: ${v.atraso_min} min · fa_flight_id: ${v.fa_flight_id}`,
    ].join('\n'));
  }
  const custo = db.prepare('SELECT COALESCE(SUM(custo), 0) s, COUNT(*) n FROM CHAMADA_API').get();
  console.log(`\n${custo.n} chamada(s) à AeroAPI, custo estimado US$ ${custo.s.toFixed(3)}.`);
} catch (e) {
  if (e instanceof ErroAeroapi) console.error(`AeroAPI: ${e.message}${e.corpo ? `\n${e.corpo}` : ''}`);
  else console.error(e.message);
  process.exit(1);
}
