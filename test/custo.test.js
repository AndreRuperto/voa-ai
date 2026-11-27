// Proteção de custo: limite por IP, teto duro e avisos de gasto aos admins.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAmbiente, aeroapiFalsa, subir, vooAeroapi, tokenGoogle, SUB } from './ajuda.js';
import { grupoDoPedido, ipDoPedido, criarLimitePorIp, chaveDeIp } from '../server/limiteip.js';
import { registrarChamada } from '../server/aeroapi.js';
import { verificarGasto } from '../server/avisosgasto.js';

prepararAmbiente();
const api = aeroapiFalsa({
  'GET /flights/*': (u) => ({ status: 200, json: { flights: [vooAeroapi({ fa_flight_id: decodeURIComponent(u.pathname.split('/').pop()) })] } }),
});
let s, admin;
before(async () => {
  s = await subir({ fetch: api.buscar });
  admin = s.cliente();
  await admin.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: tokenGoogle({ sub: 'a', email: 'admin@exemplo.com', name: 'Dona' }) } });
});
after(() => s.fechar());
beforeEach(() => {
  s.ctx.limiteIp.zerar();
  s.db.exec('DELETE FROM CHAMADA_API; DELETE FROM AVISO_GASTO; DELETE FROM CONFIG; DELETE FROM CACHE;');
  s.pushes.length = 0;
});

const gastar = (usd) => registrarChamada(s.db, { tipo: 'rota', endpoint: 'GET /teste', preco: usd }, s.relogio.atual);

test('grupos do limite por IP', () => {
  assert.equal(grupoDoPedido('GET', '/api/voos/buscar'), 'consulta');
  assert.equal(grupoDoPedido('GET', '/api/voos/TAP103-1-schedule-0'), 'consulta');
  assert.equal(grupoDoPedido('GET', '/api/rotas/buscar'), 'consulta');
  assert.equal(grupoDoPedido('POST', '/api/inscricoes'), 'consulta');
  assert.equal(grupoDoPedido('POST', '/api/sessao'), 'login');
  assert.equal(grupoDoPedido('GET', '/api/eu'), 'api');
  assert.equal(grupoDoPedido('GET', '/api/admin/resumo'), null);
  assert.equal(grupoDoPedido('POST', '/webhook/aeroapi/x'), null);
  assert.equal(grupoDoPedido('GET', '/estilo.css'), null);
});

test('IP: no Railway vale o último item do X-Forwarded-For; X-Real-IP é ignorado', () => {
  const req = { headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(ipDoPedido(req, {}), '127.0.0.1');
  assert.equal(ipDoPedido(req, { RAILWAY_ENVIRONMENT_NAME: 'production' }), '1.1.1.1');
  assert.equal(ipDoPedido(req, { CABECALHO_IP: 'X-Forwarded-For' }), '1.1.1.1');
  // O cliente pode pôr o que quiser no começo do X-Forwarded-For; o proxy acrescenta o IP real no fim.
  const forjado = { headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 2.2.2.2' }, socket: {} };
  assert.equal(ipDoPedido(forjado, { RAILWAY_ENVIRONMENT_NAME: 'production' }), '2.2.2.2');
});

test('IP: IPv6 do mesmo /64 conta como um só; IPv4 mapeado vira IPv4', () => {
  assert.equal(chaveDeIp('2001:db8:abcd:12:1::5'), '2001:db8:abcd:12::/64');
  assert.equal(chaveDeIp('2001:0db8:abcd:0012:ffff:1:2:3'), '2001:db8:abcd:12::/64');
  assert.equal(chaveDeIp('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(chaveDeIp('::ffff:10.0.0.7'), '10.0.0.7');
  assert.equal(chaveDeIp('8.8.8.8'), '8.8.8.8');
});

test('janela do limite por IP reabre depois do tempo', () => {
  let t = 0;
  const l = criarLimitePorIp({ agora: () => t });
  assert.ok(l.contar('consulta', 'a', 2).ok);
  assert.ok(l.contar('consulta', 'a', 2).ok);
  const r = l.contar('consulta', 'a', 2);
  assert.equal(r.ok, false);
  assert.equal(r.esperarS, 600);
  assert.ok(l.contar('consulta', 'b', 2).ok, 'outro IP tem a própria conta');
  t = 10 * 60_000;
  assert.ok(l.contar('consulta', 'a', 2).ok);
});

test('passar do limite de consultas por IP dá 429 com Retry-After, e o admin muda o limite', async () => {
  await admin.pedir('/api/admin/config', { metodo: 'PUT', corpo: { limite_ip_consultas: 3 } });
  const c = s.cliente();
  for (let i = 0; i < 3; i++) assert.equal((await c.pedir('/api/voos/buscar?ident=TP103&data=2026-11-14')).status, 200);
  const r = await c.pedir('/api/voos/buscar?ident=TP103&data=2026-11-14');
  assert.equal(r.status, 429);
  assert.equal(r.json.erro, 'muitos_pedidos');
  assert.match(r.json.mensagem, /Muitos pedidos/);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  // Outro aparelho na mesma rede também para: o limite é do IP.
  assert.equal((await s.cliente().pedir('/api/rotas/buscar?de=LIS&para=GRU&data=2026-11-14')).status, 429);
  // Rotas baratas seguem em outro grupo.
  assert.equal((await c.pedir('/api/eu')).status, 200);
});

test('teto duro: nenhuma chamada paga à AeroAPI, mas apagar alerta continua', async () => {
  const antes = api.chamadas.length;
  gastar(10); // teto duro padrão = 2 × crédito (5) = 10
  const r = await s.cliente().pedir('/api/voos/buscar?ident=TP104&data=2026-11-14');
  assert.equal(r.status, 503);
  assert.equal(r.json.erro, 'teto_duro');
  assert.equal(api.chamadas.length, antes, 'nada foi pedido à AeroAPI');
  await s.ctx.aeroapi.apagarAlerta(123, {});
  assert.equal(api.chamadas.at(-1).metodo, 'DELETE');
});

test('avisos de gasto: 50%, 80%, uma vez por marco, só o mais alto manda push', async () => {
  const c = admin;
  await c.pedir('/api/aparelho/push', { metodo: 'PUT', corpo: { push: SUB(77) } });
  assert.equal((await c.pedir('/api/admin/avisos')).json.aparelhos_com_push, 1);

  gastar(2.4);
  assert.deepEqual(await verificarGasto(s.ctx), []);
  gastar(0.2); // 2,60 → 52%
  assert.deepEqual(await verificarGasto(s.ctx), ['50']);
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0].endpoint, SUB(77).endpoint);
  assert.match(s.pushes[0].titulo, /Metade/);
  assert.match(s.pushes[0].corpo, /US\$ 2,60 de US\$ 5,00 em novembro/);
  assert.equal(s.pushes[0].url, '/admin/');
  assert.deepEqual(await verificarGasto(s.ctx), [], 'não repete');

  gastar(2.6); // 5,20 → passou de 80% e do teto mensal de uma vez
  assert.deepEqual(await verificarGasto(s.ctx), ['80', 'teto']);
  assert.equal(s.pushes.length, 2, 'um push só, do marco mais alto');
  assert.match(s.pushes[1].titulo, /rota pausada/);

  const resumo = (await c.pedir('/api/admin/resumo')).json;
  assert.deepEqual(resumo.avisos_gasto.map((a) => a.marco), ['50', '80', 'teto']);
  assert.equal(resumo.teto_duro_usd, 10);
});

test('avisos só vão para aparelhos de admin, e o teste manda um push', async () => {
  const comum = s.cliente();
  await comum.pedir('/api/sessao', { metodo: 'POST', corpo: { credential: tokenGoogle({ sub: 'c', email: 'comum@exemplo.com' }) } });
  await comum.pedir('/api/aparelho/push', { metodo: 'PUT', corpo: { push: SUB(88) } });
  await admin.pedir('/api/aparelho/push', { metodo: 'PUT', corpo: { push: SUB(77) } });
  const r = await admin.pedir('/api/admin/avisos/teste', { metodo: 'POST' });
  assert.equal(r.json.enviados, 1);
  assert.deepEqual(s.pushes.map((p) => p.endpoint), [SUB(77).endpoint]);
  assert.equal((await comum.pedir('/api/admin/avisos/teste', { metodo: 'POST' })).status, 404);
  assert.equal((await comum.pedir('/api/aparelho/push', { metodo: 'PUT', corpo: { push: { endpoint: 'http://x' } } })).status, 400);
});
