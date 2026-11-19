// Plano Personal da AeroAPI: sem alertas e sem /canonical (ADR-009). O agendador consulta o voo e avisa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, SUB } from './ajuda.js';
import { rodarCiclo, intervaloDeConsulta } from '../server/agendador.js';

prepararAmbiente();
const FA = 'TAP103-1763000000-schedule-0001';
const RECUSA = {
  status: 401,
  json: { title: 'Invalid API key', reason: 'INVALID_API_KEY', detail: 'Alerts and Historical data are only available on Standard and Premium tiers.', status: 401 },
};
let estado = vooAeroapi();
const api = aeroapiFalsa({
  'GET /flights/TP103/canonical': () => RECUSA,
  'POST /alerts': () => RECUSA,
  'GET /flights/TP103': () => ({ status: 200, json: { flights: [estado] } }),
  [`GET /flights/${FA}`]: () => ({ status: 200, json: { flights: [estado] } }),
});
let s;
before(async () => { s = await subir({ fetch: api.buscar, agora: new Date('2026-11-14T11:00:00Z') }); });
after(() => s.fechar());

const chamadas = (metodo, caminho) => api.chamadas.filter((c) => c.metodo === metodo && c.caminho === caminho).length;
const consultasDoVoo = () => chamadas('GET', `/flights/${FA}`);
const ultimoPush = () => s.pushes.at(-1)?.corpo;
async function ciclo(iso, novo) {
  s.relogio.atual = new Date(iso);
  if (novo) estado = vooAeroapi(novo);
  await rodarCiclo(s.ctx);
}

test('busca pelo número: o /canonical recusado não quebra, e não é tentado de novo', async () => {
  const c = s.cliente();
  const r = await c.pedir('/api/voos/buscar?ident=TP103&data=2026-11-14');
  assert.equal(r.status, 200);
  assert.equal(r.json.voos[0].fa_flight_id, FA);
  assert.equal(chamadas('GET', '/flights/TP103/canonical'), 1);
  const custo = s.db.prepare("SELECT custo FROM CHAMADA_API WHERE status = 401").all();
  assert.ok(custo.every((x) => x.custo === 0), 'recusa do plano fica no painel com custo zero');
  s.db.prepare('DELETE FROM CACHE').run();
  assert.equal((await c.pedir('/api/voos/buscar?ident=TP103&data=2026-11-14')).status, 200);
  assert.equal(chamadas('GET', '/flights/TP103/canonical'), 1, 'depois da recusa, o plano já é conhecido');
});

test('acompanhar: sem alerta no plano, a inscrição funciona e o voo fica sem alert_id', async () => {
  const r = await s.cliente().pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: FA, apelido: 'Mãe', push: SUB(1) } });
  assert.equal(r.status, 201);
  assert.equal(s.db.prepare('SELECT alert_id FROM VOO WHERE fa_flight_id = ?').get(FA).alert_id, null);
  assert.equal(chamadas('POST', '/alerts'), 0, 'o plano já foi descoberto na busca: nem tenta criar o alerta');
});

test('antes de 20 min da saída, só os marcos de 3 h, 1 h e 15 min consultam', async () => {
  const antes = consultasDoVoo();
  await ciclo('2026-11-14T12:20:00Z');           // 2 h 55 antes da decolagem: marco de 3 h
  await ciclo('2026-11-14T12:40:00Z');
  await ciclo('2026-11-14T14:00:00Z');           // 1 h 15 antes: marco de 1 h
  assert.equal(consultasDoVoo(), antes + 2);
});

test('perto da decolagem consulta a cada 10 min e avisa que decolou', async () => {
  await ciclo('2026-11-14T15:00:00Z');           // marco de 15 min
  const antes = consultasDoVoo();
  await ciclo('2026-11-14T15:05:00Z');
  assert.equal(consultasDoVoo(), antes, 'consultou há 5 min: espera');
  await ciclo('2026-11-14T15:10:00Z');
  assert.equal(consultasDoVoo(), antes + 1);
  await ciclo('2026-11-14T15:20:00Z', { actual_out: '2026-11-14T15:02:00Z', actual_off: '2026-11-14T15:17:00Z' });
  assert.match(ultimoPush(), /^🛫 O voo da Mãe decolou de Lisboa/);
  const n = s.pushes.length;
  await ciclo('2026-11-14T15:30:00Z');
  assert.equal(s.pushes.length, n, 'não repete');
});

test('no cruzeiro consulta de 45 em 45 min', async () => {
  const antes = consultasDoVoo();
  for (let m = 31; m <= 180; m += 1) {           // 15:31 até 18:00, um ciclo por minuto
    await ciclo(new Date(Date.parse('2026-11-14T15:00:00Z') + m * 60_000).toISOString());
  }
  assert.equal(consultasDoVoo(), antes + 3);
});

test('a página do voo traz o pouso antes do agendador: o aviso sai mesmo assim', async () => {
  s.relogio.atual = new Date('2026-11-14T23:25:00Z');
  estado = vooAeroapi({ actual_off: '2026-11-14T15:17:00Z', actual_on: '2026-11-14T23:21:00Z' });
  const r = await s.cliente().pedir(`/api/voos/${encodeURIComponent(FA)}`);
  assert.equal(r.status, 200);
  const antes = consultasDoVoo();
  await rodarCiclo(s.ctx);
  assert.equal(consultasDoVoo(), antes, 'a página acabou de atualizar: o agendador não paga outra consulta');
  assert.match(ultimoPush(), /^🛬 O voo da Mãe pousou em São Paulo às 20:21$/);
});

test('chegada ao portão e depois para de consultar', async () => {
  await ciclo('2026-11-14T23:40:00Z', { actual_off: '2026-11-14T15:17:00Z', actual_on: '2026-11-14T23:21:00Z', actual_in: '2026-11-14T23:33:00Z' });
  assert.match(ultimoPush(), /^✅ A Mãe chegou ao portão/);
  const antes = consultasDoVoo();
  await ciclo('2026-11-15T01:00:00Z');
  await ciclo('2026-11-15T03:00:00Z');
  assert.equal(consultasDoVoo(), antes);
});

test('intervaloDeConsulta: fases do voo', () => {
  const t = (iso) => Date.parse(iso);
  const v = (sobre) => vooAeroapi(sobre);
  assert.equal(intervaloDeConsulta(v(), t('2026-11-14T14:00:00Z')), null, 'longe da saída: só os marcos');
  assert.equal(intervaloDeConsulta(v(), t('2026-11-14T15:00:00Z')), 10);
  assert.equal(intervaloDeConsulta(v(), t('2026-11-14T18:00:00Z')), 30, 'atraso longo sem decolar');
  assert.equal(intervaloDeConsulta(v(), t('2026-11-15T05:00:00Z')), null, 'mais de 12 h sem decolar: desiste');
  const voando = { actual_off: '2026-11-14T15:17:00Z' };
  assert.equal(intervaloDeConsulta(v(voando), t('2026-11-14T18:00:00Z')), 45);
  assert.equal(intervaloDeConsulta(v(voando), t('2026-11-14T23:00:00Z')), 10, '30 min antes do pouso');
  const pousou = { ...voando, actual_on: '2026-11-14T23:21:00Z' };
  assert.equal(intervaloDeConsulta(v(pousou), t('2026-11-14T23:40:00Z')), 10);
  assert.equal(intervaloDeConsulta(v(pousou), t('2026-11-14T23:40:00Z'), { modoEconomico: true }), null);
  assert.equal(intervaloDeConsulta(v(pousou), t('2026-11-15T01:00:00Z')), null, 'sem portão em 90 min: para');
  assert.equal(intervaloDeConsulta(v({ cancelled: true }), t('2026-11-14T15:00:00Z')), null);
});

test('quem começa a acompanhar com o avião no ar não recebe "decolou"', async () => {
  const FA2 = 'TAP104-1763000000-schedule-0002';
  let v2 = vooAeroapi({ fa_flight_id: FA2, ident: 'TAP104', ident_iata: 'TP104', actual_off: '2026-11-15T10:00:00Z',
    scheduled_out: '2026-11-15T09:45:00Z', estimated_out: '2026-11-15T09:45:00Z', scheduled_off: '2026-11-15T10:00:00Z', estimated_off: '2026-11-15T10:00:00Z',
    scheduled_on: '2026-11-15T18:00:00Z', estimated_on: '2026-11-15T18:00:00Z', scheduled_in: '2026-11-15T18:10:00Z', estimated_in: '2026-11-15T18:10:00Z' });
  const rotas = { [`GET /flights/${FA2}`]: () => ({ status: 200, json: { flights: [v2] } }) };
  const api2 = aeroapiFalsa({ 'POST /alerts': () => RECUSA, ...rotas });
  const s2 = await subir({ fetch: api2.buscar, agora: new Date('2026-11-15T12:00:00Z') });
  try {
    const r = await s2.cliente().pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: FA2, apelido: 'Pai', push: SUB(2) } });
    assert.equal(r.status, 201, 'a primeira recusa do POST /alerts vira "sem alerta"');
    s2.relogio.atual = new Date('2026-11-15T12:50:00Z');
    await rodarCiclo(s2.ctx);
    assert.equal(s2.pushes.length, 0);
    v2 = { ...v2, actual_on: '2026-11-15T17:55:00Z' };
    s2.relogio.atual = new Date('2026-11-15T18:00:00Z');
    await rodarCiclo(s2.ctx);
    assert.match(s2.pushes.at(-1).corpo, /^🛬 O voo da Pai pousou/);
  } finally {
    await s2.fechar();
  }
});
