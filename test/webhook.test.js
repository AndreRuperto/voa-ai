import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, SEGREDO, SUB } from './ajuda.js';

prepararAmbiente();
const FA = 'TAP103-1763000000-schedule-0001';
const api = aeroapiFalsa({
  [`GET /flights/${FA}`]: () => ({ status: 200, json: { flights: [vooAeroapi()], num_pages: 1 } }),
});
let s, cli;

before(async () => {
  s = await subir({ fetch: api.buscar });
  cli = s.cliente();
  const r = await cli.pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: FA, apelido: 'Mãe', push: SUB(1) } });
  assert.equal(r.status, 201);
});
after(() => s.fechar());

const entregar = async (corpo, segredo = SEGREDO) => {
  const r = await fetch(`${s.base}/webhook/aeroapi/${segredo}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  await s.ctx.aguardarTarefas();
  return r;
};
const alertId = () => s.db.prepare('SELECT alert_id FROM VOO WHERE fa_flight_id = ?').get(FA).alert_id;
const flightWebhook = (sobre) => ({ ...vooAeroapi(sobre), origin: 'LPPT', origin_icao: 'LPPT', destination: 'SBGR', destination_icao: 'SBGR' });

test('segredo errado → 404 e nada é gravado', async () => {
  const r = await entregar({ event_code: 'off', alert_id: 1, flight: flightWebhook() }, 'errado');
  assert.equal(r.status, 404);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM EVENTO').get().n, 0);
});

test('decolagem: 200, grava evento, atualiza o voo, avisa e registra US$ 0,020', async () => {
  const r = await entregar({ event_code: 'off', alert_id: alertId(), flight: flightWebhook({ actual_out: '2026-11-14T15:02:00Z', actual_off: '2026-11-14T15:12:00Z' }) });
  assert.equal(r.status, 200);
  assert.equal(s.pushes.length, 1);
  assert.match(s.pushes[0].corpo, /^🛫 O voo da Mãe decolou de /);
  assert.equal(s.pushes[0].url, `/v/${FA}`);
  const v = await cli.pedir(`/api/voos/${FA}`);
  assert.equal(v.json.estado, 'em_voo');
  assert.equal(v.json.horarios.decolagem_real, '2026-11-14T15:12:00Z');
  const custo = s.db.prepare("SELECT COUNT(*) n, SUM(custo) usd FROM CHAMADA_API WHERE tipo = 'alerta_entregue'").get();
  assert.equal(custo.n, 1);
  assert.equal(custo.usd, 0.02);
});

test('R7: o mesmo evento repetido não gera outro aviso (mas é registrado e cobrado)', async () => {
  await entregar({ event_code: 'off', alert_id: alertId(), flight: flightWebhook({ actual_off: '2026-11-14T15:12:00Z' }) });
  await entregar({ event_code: 'departure', alert_id: alertId(), flight: flightWebhook({ actual_off: '2026-11-14T15:12:00Z' }) });
  assert.equal(s.pushes.length, 1);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM EVENTO').get().n, 3);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM CHAMADA_API WHERE tipo = 'alerta_entregue'").get().n, 3);
});

test('atraso: chegada escorregou ≥ 15 min → aviso; mesmo atraso não repete', async () => {
  s.pushes.length = 0;
  const atrasado = flightWebhook({ actual_off: '2026-11-14T15:12:00Z', estimated_in: '2026-11-15T00:15:00Z' });
  await entregar({ event_code: 'change', alert_id: alertId(), flight: atrasado });
  assert.equal(s.pushes.length, 1);
  assert.match(s.pushes[0].corpo, /^🕒 O voo da Mãe está atrasado 35 min\. Nova chegada: 21:15$/);
  await entregar({ event_code: 'change', alert_id: alertId(), flight: atrasado });
  assert.equal(s.pushes.length, 1, 'atraso igual não avisa de novo');
});

test('evento desconhecido é salvo e ignorado', async () => {
  s.pushes.length = 0;
  const r = await entregar({ event_code: 'novidade_da_api', alert_id: alertId(), flight: flightWebhook({ estimated_in: '2026-11-15T00:15:00Z' }) });
  assert.equal(r.status, 200);
  assert.equal(s.pushes.length, 0);
});

test('chegada ao portão: avisa e apaga o alerta na AeroAPI', async () => {
  s.pushes.length = 0;
  const id = alertId();
  assert.ok(id);
  await entregar({ event_code: 'in', alert_id: id, flight: flightWebhook({ actual_on: '2026-11-15T00:05:00Z', actual_in: '2026-11-15T00:12:00Z' }) });
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0].corpo, '✅ A Mãe chegou ao portão. Desembarque em breve');
  assert.ok(api.chamadas.some((c) => c.metodo === 'DELETE' && c.caminho === `/alerts/${id}`));
  assert.equal(alertId(), null);
});

test('inscrição de push morta (410) é removida', async () => {
  const erro = Object.assign(new Error('gone'), { statusCode: 410 });
  const { notificarVoo } = await import('../server/push.js');
  const ctx = { ...s.ctx, enviarPush: async () => { throw erro; } };
  await notificarVoo(ctx, 'cancelled', { fa_flight_id: FA, ident: 'TAP103', origem: {}, destino: {}, horarios: {} });
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM INSCRICAO WHERE push_endpoint IS NOT NULL').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM APARELHO WHERE push_endpoint IS NOT NULL').get().n, 0);
});

test('alerta que não é nosso (segredo vazou): ignorado, sem aviso, sem evento e sem custo', async () => {
  s.pushes.length = 0;
  const eventos = s.db.prepare('SELECT COUNT(*) n FROM EVENTO').get().n;
  const custos = s.db.prepare("SELECT COUNT(*) n FROM CHAMADA_API WHERE tipo = 'alerta_entregue'").get().n;
  for (const alert_id of [987654321, undefined]) {
    const r = await entregar({ event_code: 'arrival', alert_id, flight: flightWebhook({ fa_flight_id: FA, actual_on: '2026-11-15T00:00:00Z' }) });
    assert.equal(r.status, 200);
  }
  assert.equal(s.pushes.length, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM EVENTO').get().n, eventos);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM CHAMADA_API WHERE tipo = 'alerta_entregue'").get().n, custos);
});
