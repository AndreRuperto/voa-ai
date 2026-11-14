import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, SUB } from './ajuda.js';
import { rodarCiclo } from '../server/agendador.js';

prepararAmbiente();
const FA = 'TAP103-1763000000-schedule-0001';
let estado = vooAeroapi();
const api = aeroapiFalsa({ [`GET /flights/${FA}`]: () => ({ status: 200, json: { flights: [estado] } }) });
let s;
before(async () => {
  s = await subir({ fetch: api.buscar, agora: new Date('2026-11-14T11:00:00Z') });
  const r = await s.cliente().pedir('/api/inscricoes', { metodo: 'POST', corpo: { fa_flight_id: FA, apelido: 'Mãe', push: SUB(1) } });
  assert.equal(r.status, 201);
});
after(() => s.fechar());
const consultas = () => api.chamadas.filter((c) => c.metodo === 'GET').length;

test('checagem antes da partida: só o marco vencido mais recente, e avisa atraso', async () => {
  const antes = consultas();
  s.relogio.atual = new Date('2026-11-14T13:00:00Z'); // 2 h antes: marco de 3 h venceu
  estado = vooAeroapi({ estimated_out: '2026-11-14T15:40:00Z', estimated_in: '2026-11-15T00:20:00Z' });
  await rodarCiclo(s.ctx);
  assert.equal(consultas(), antes + 1);
  assert.equal(s.pushes.length, 1);
  assert.match(s.pushes[0].corpo, /atrasado 40 min/);
  await rodarCiclo(s.ctx);
  assert.equal(consultas(), antes + 1, 'o mesmo marco não roda duas vezes');
  s.relogio.atual = new Date('2026-11-14T14:50:00Z'); // 1 h e 15 min venceram juntos → uma consulta
  await rodarCiclo(s.ctx);
  assert.equal(consultas(), antes + 2);
  assert.equal(s.pushes.length, 1, 'atraso igual não repete');
});

test('rede de segurança: 30 min depois da chegada estimada, avisa o pouso que não veio pelo webhook', async () => {
  s.relogio.atual = new Date('2026-11-15T00:55:00Z');
  estado = vooAeroapi({ actual_off: '2026-11-14T15:50:00Z', actual_on: '2026-11-15T00:10:00Z', estimated_in: '2026-11-15T00:20:00Z' });
  await rodarCiclo(s.ctx);
  assert.match(s.pushes.at(-1).corpo, /^🛬 O voo da Mãe pousou em .+ às 21:10$/);
});

test('R2 e limpeza: apaga o alerta 24 h depois e os dados 7 dias depois', async () => {
  s.relogio.atual = new Date('2026-11-16T01:00:00Z');
  await rodarCiclo(s.ctx);
  assert.ok(api.chamadas.some((c) => c.metodo === 'DELETE'));
  assert.equal(s.db.prepare('SELECT alert_id FROM VOO WHERE fa_flight_id = ?').get(FA).alert_id, null);
  s.relogio.atual = new Date('2026-11-23T01:00:00Z');
  await rodarCiclo(s.ctx);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM VOO').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM INSCRICAO').get().n, 0);
});
