// Admin · Voos: a lista dos voos que o app conhece (sem AeroAPI) e as partidas de um aeroporto (sob demanda).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, tokenGoogle, SUB } from './ajuda.js';

prepararAmbiente();
const NO_AR = 'TAP103-1763000000-schedule-0001';
const partida = (n, sobre = {}) => vooAeroapi({
  fa_flight_id: `GLO${n}-1763000000-schedule-000${n}`, ident: `GLO${n}`, ident_icao: `GLO${n}`, ident_iata: `G3${n}`,
  origin: { code: 'SBGR', code_icao: 'SBGR', code_iata: 'GRU', name: 'Guarulhos', city: 'Sao Paulo', timezone: 'America/Sao_Paulo' },
  destination: { code: 'SBRJ', code_icao: 'SBRJ', code_iata: 'SDU', name: 'Santos Dumont', city: 'Rio de Janeiro', timezone: 'America/Sao_Paulo' },
  scheduled_out: `2026-11-14T1${n}:00:00Z`, estimated_out: `2026-11-14T1${n}:00:00Z`, scheduled_off: `2026-11-14T1${n}:10:00Z`, estimated_off: `2026-11-14T1${n}:10:00Z`,
  ...sobre,
});
const api = aeroapiFalsa({
  [`GET /flights/${NO_AR}`]: () => ({ status: 200, json: { flights: [vooAeroapi({ actual_out: '2026-11-14T11:00:00Z', actual_off: '2026-11-14T11:10:00Z',
    scheduled_out: '2026-11-14T11:00:00Z', estimated_out: '2026-11-14T11:00:00Z', scheduled_off: '2026-11-14T11:10:00Z', estimated_off: '2026-11-14T11:10:00Z' })] } }),
  'GET /airports/SBGR/flights/scheduled_departures': () => ({ status: 200, json: { scheduled_departures: [partida(3), partida(4, { cancelled: true })], num_pages: 1 } }),
});
let s, admin, comum;
before(async () => {
  s = await subir({ fetch: api.buscar, agora: new Date('2026-11-14T12:00:00Z') });
  admin = s.cliente(); comum = s.cliente();
  await admin.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: tokenGoogle({ sub: 'a', email: 'admin@exemplo.com' }) } });
  await comum.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: tokenGoogle({ sub: 'c', email: 'comum@exemplo.com' }) } });
  // um voo no ar, acompanhado por uma conta e por um aparelho sem conta
  assert.equal((await comum.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: NO_AR, apelido: 'Mãe', push: SUB(1) } })).status, 201);
  assert.equal((await s.cliente().pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: NO_AR, apelido: 'Vó', push: SUB(2) } })).status, 201);
});
after(() => s.fechar());

const chamadasPartidas = () => api.chamadas.filter((c) => c.caminho === '/airports/SBGR/flights/scheduled_departures');

test('partidas: só admin, e o código precisa ser de um aeroporto conhecido', async () => {
  assert.equal((await comum.pedir('/api/admin/partidas', { metodo: 'POST', corpo: { aeroporto: 'GRU' } })).status, 404);
  assert.equal((await admin.pedir('/api/admin/partidas', { metodo: 'POST', corpo: { aeroporto: 'G' } })).status, 400);
  assert.equal((await admin.pedir('/api/admin/partidas', { metodo: 'POST', corpo: { aeroporto: 'ZZZ' } })).status, 400);
  assert.equal(chamadasPartidas().length, 0, 'nada pago antes de validar');
});

test('partidas: uma página paga de companhias aéreas, guardada no banco; repetir em 10 min sai do cache', async () => {
  const r = await admin.pedir('/api/admin/partidas', { metodo: 'POST', corpo: { aeroporto: 'gru' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.aeroporto, 'GRU');
  assert.equal(r.json.voos, 2);
  assert.equal(r.json.em_cache, false);
  assert.equal(r.json.custo_usd, 0.02);
  const q = chamadasPartidas()[0].query;
  assert.equal(q.type, 'Airline');
  assert.equal(q.max_pages, '1');
  assert.equal(q.start, '2026-11-14T11:30:00Z');
  assert.equal(q.end, '2026-11-14T18:00:00Z');
  const de_novo = await admin.pedir('/api/admin/partidas', { metodo: 'POST', corpo: { aeroporto: 'GRU' } });
  assert.equal(de_novo.json.em_cache, true);
  assert.equal(de_novo.json.custo_usd, 0);
  assert.equal(chamadasPartidas().length, 1);
  const audit = s.db.prepare("SELECT detalhe FROM AUDITORIA WHERE acao = 'partidas'").all();
  assert.equal(audit.length, 1);
});

test('voos: lista o que o app conhece, por fase, com quem acompanha e o custo, sem chamar a AeroAPI', async () => {
  const antes = api.chamadas.length;
  const r = await admin.pedir('/api/admin/voos');
  assert.equal(r.status, 200);
  assert.equal(api.chamadas.length, antes, 'ver a lista não custa nada');
  assert.deepEqual(r.json.contagem, { no_ar: 1, para_decolar: 1, pousou: 0, cancelado: 1 });
  assert.deepEqual(r.json.voos.map((x) => x.fase), ['no_ar', 'para_decolar', 'cancelado']);
  const noAr = r.json.voos[0];
  assert.equal(noAr.voo.fa_flight_id, NO_AR);
  assert.equal(noAr.quem.contas, 1);
  assert.equal(noAr.quem.aparelhos, 1);
  assert.deepEqual(noAr.quem.apelidos.sort(), ['Mãe', 'Vó']);
  assert.ok(noAr.consultas >= 1);
  assert.ok(noAr.custo_usd > 0);
  const daPartida = r.json.voos[1];
  assert.equal(daPartida.inscritos, 0);
  assert.equal(daPartida.quem.contas, 0);
});

test('voos: fora da janela de 24 h só aparece com ?todos=1 ou se alguém acompanha', async () => {
  s.relogio.atual = new Date('2026-11-17T12:00:00Z');
  const agora = await admin.pedir('/api/admin/voos');
  assert.deepEqual(agora.json.voos.map((x) => x.voo.fa_flight_id), [NO_AR], 'o acompanhado continua');
  const todos = await admin.pedir('/api/admin/voos?todos=1');
  assert.equal(todos.json.voos.length, 3);
});
