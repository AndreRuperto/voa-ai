import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../server/db.js';
import { salvarVoo } from '../server/voos.js';
import { verificarConexoes, mensagemConexao } from '../server/conexoes.js';
import { vooAeroapi } from './ajuda.js';

const T0 = Date.parse('2026-11-15T10:00:00Z');
const iso = (h) => new Date(T0 + h * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const GRU = { code: 'SBGR', code_icao: 'SBGR', code_iata: 'GRU', name: 'Guarulhos', city: 'Sao Paulo', timezone: 'America/Sao_Paulo' };
const DXB = { code: 'OMDB', code_icao: 'OMDB', code_iata: 'DXB', name: 'Dubai', city: 'Dubai', timezone: 'Asia/Dubai' };
const NRT = { code: 'RJAA', code_icao: 'RJAA', code_iata: 'NRT', name: 'Narita', city: 'Tokyo', timezone: 'Asia/Tokyo' };

/** Perna 1 GRU→DXB (sai 0 h, chega ao portão 14 h); perna 2 DXB→NRT sai às 16 h: 2 h de escala planejada. */
function leg1(chegaH = 14, sobre = {}) {
  return vooAeroapi({ fa_flight_id: 'EK262-1', ident: 'UAE262', ident_icao: 'UAE262', ident_iata: 'EK262', origin: GRU, destination: DXB,
    scheduled_out: iso(0), estimated_out: iso(0), scheduled_off: iso(.2), estimated_off: iso(.2),
    scheduled_on: iso(13.8), estimated_on: iso(chegaH - .2), scheduled_in: iso(14), estimated_in: iso(chegaH), ...sobre });
}
function leg2(sobre = {}) {
  return vooAeroapi({ fa_flight_id: 'EK318-1', ident: 'UAE318', ident_icao: 'UAE318', ident_iata: 'EK318', origin: DXB, destination: NRT,
    scheduled_out: iso(16), estimated_out: iso(16), scheduled_off: iso(16.2), estimated_off: iso(16.2),
    scheduled_on: iso(25.5), estimated_on: iso(25.5), scheduled_in: iso(25.7), estimated_in: iso(25.7), ...sobre });
}

function cenario() {
  const db = abrirBanco(':memory:'), pushes = [];
  let agora = new Date(T0 + 3 * 3600_000);
  const ctx = { db, agora: () => agora, enviarPush: async (sub, p) => pushes.push({ endpoint: sub.endpoint, ...JSON.parse(p) }) };
  salvarVoo(db, leg1(), agora); salvarVoo(db, leg2(), agora);
  const ins = db.prepare('INSERT INTO INSCRICAO (id, fa_flight_id, aparelho_id, apelido, push_endpoint, push_p256dh, push_auth, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('i1', 'EK262-1', 'ap1', 'Ana', 'https://push.exemplo/1', 'p', 'a', agora.toISOString());
  ins.run('i2', 'EK318-1', 'ap1', 'Ana', 'https://push.exemplo/1', 'p', 'a', agora.toISOString());
  return { db, ctx, pushes, mudar: (f, h) => { if (h != null) agora = new Date(T0 + h * 3600_000); salvarVoo(db, f, agora); } };
}

test('conexão no horário: nenhum aviso', async () => {
  const c = cenario();
  assert.equal(await verificarConexoes(c.ctx), 0);
  assert.equal(c.pushes.length, 0);
});

test('atrasou: avisa apertada, depois perdida, uma vez cada; e avisa quando volta ao normal', async () => {
  const c = cenario();
  c.mudar(leg1(15.5, { actual_off: iso(.2) }), 5);             // chega 15:30, sai 16:00 → 30 min
  assert.equal(await verificarConexoes(c.ctx), 1);
  assert.equal(c.pushes[0].titulo, 'Conexão apertada em Dubai');
  assert.match(c.pushes[0].corpo, /A Ana vai ter 30 min para trocar de avião/);
  assert.equal(c.pushes[0].url, '/v/EK318-1');
  assert.equal(await verificarConexoes(c.ctx), 0);              // não repete

  c.mudar(leg1(16.5, { actual_off: iso(.2) }));                  // chega depois da saída
  assert.equal(await verificarConexoes(c.ctx), 1);
  assert.equal(c.pushes[1].titulo, 'Ana pode perder a conexão em Dubai');
  assert.match(c.pushes[1].corpo, /depois da saída do EK318/);

  c.mudar(leg1(14, { actual_off: iso(.2) }));                    // recuperou o atraso
  assert.equal(await verificarConexoes(c.ctx), 1);
  assert.equal(c.pushes[2].titulo, 'Conexão em Dubai em dia');
  assert.equal(await verificarConexoes(c.ctx), 0);
});

test('conexão já planejada apertada não vira aviso; cancelado fica com o aviso do próprio voo', async () => {
  const c = cenario();
  c.mudar(leg2({ scheduled_out: iso(14.5), estimated_out: iso(14.5) }));   // a companhia vendeu 30 min
  assert.equal(await verificarConexoes(c.ctx), 0);
  c.mudar(leg1(17, { cancelled: true }));
  assert.equal(await verificarConexoes(c.ctx), 0);
});

test('pessoas diferentes não formam viagem', async () => {
  const c = cenario();
  c.db.prepare("UPDATE INSCRICAO SET apelido = 'Bia', aparelho_id = 'ap2' WHERE id = 'i2'").run();
  c.mudar(leg1(16.5, { actual_off: iso(.2) }), 5);
  assert.equal(await verificarConexoes(c.ctx), 0);
});

test('texto sem apelido', () => {
  const a = { ident_iata: 'EK262', destino: { cidade: 'Dubai', fuso: 'Asia/Dubai' }, horarios: { chegada_estimada: '2026-11-15T12:00:00Z' } };
  const b = { ident_iata: 'EK318', horarios: { saida_estimada: '2026-11-15T12:40:00Z' } };
  assert.match(mensagemConexao('apertada', a, b, { minutos: 40 }).corpo, /Quem viaja vai ter 40 min/);
  assert.match(mensagemConexao('ok', a, b, { minutos: 70 }).corpo, /sobram 1 h 10/);
});
