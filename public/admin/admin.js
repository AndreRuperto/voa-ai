/* Voa Aí · painel de admin, ligado a /api/admin/* (docs/12 e docs/13).
   Quem não está em ADMIN_EMAILS recebe 404 do servidor; aqui isso vira a porta de entrada. */
import { get, post, put, del, mensagemDe } from '/api.js';
import { hora, diaISO, esc, usd as brl, plural } from '/formato.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PRECO_ALERTA = .020;   // docs/04: cada alerta entregue
const NOMES_TIPO = {
  alerta_entregue: 'Alertas entregues', alertas_entregues: 'Alertas entregues', webhook: 'Alertas entregues',
  rota: 'Busca por rota', 'airports/flights/to': 'Busca por rota', 'airports/…/flights/to': 'Busca por rota', airports: 'Busca por rota',
  flights: 'Busca de voo por número', voo: 'Busca de voo por número',
  canonical: 'Código canônico', canonico: 'Código canônico',
  alerts: 'Criar e apagar alertas', alertas: 'Criar e apagar alertas',
  track: 'Trilha do voo (globo)',
};
const SECOES = ['visao', 'voos', 'contas', 'rotas', 'limites'];

let eu = null, config = null, auditoria = [];

/* ============================================================ APOIO */
const toast = $('#toast');
function avisar(msg) { toast.textContent = msg; toast.hidden = false; clearTimeout(avisar.t); avisar.t = setTimeout(() => toast.hidden = true, 3600); }
const dlg = $('#confirmar');
function confirmar(titulo, texto, sim, nao) {
  $('#conf-titulo').textContent = titulo; $('#conf-texto').textContent = texto;
  $('#conf-sim').textContent = sim; $('#conf-nao').textContent = nao;
  dlg.returnValue = ''; dlg.showModal();
  return new Promise(r => dlg.addEventListener('close', () => r(dlg.returnValue === 'sim'), { once: true }));
}
const ocupado = (b, sim) => { b.disabled = sim; b.setAttribute('aria-busy', sim ? 'true' : 'false'); };
const soma = a => a.reduce((s, x) => s + x, 0);
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
const sim = v => v === true || v === 1 || v === '1' || v === 'true' || v === 'sim';
const linhaVazia = (cols, txt) => `<tr><td colspan="${cols}" class="vazio-tabela">${txt}</td></tr>`;
const linhaErro = (cols, e) => `<tr><td colspan="${cols}"><div class="erro-secao" role="alert"><svg aria-hidden="true"><use href="#i-alerta"/></svg><span>${esc(mensagemDe(e))}</span></div></td></tr>`;
const linhaCarregando = cols => `<tr><td colspan="${cols}" class="carregando">Carregando…</td></tr>`;

function quando(iso) {
  if (!iso) return '–';
  const d = diaISO(iso), hoje = diaISO(new Date()), ontem = diaISO(new Date(Date.now() - 864e5));
  if (d === hoje) return `hoje, ${hora(iso)}`;
  if (d === ontem) return `ontem, ${hora(iso)}`;
  const [, m, dd] = d.split('-').map(Number);
  return `${dd} ${MES_CURTO[m - 1]}, ${hora(iso)}`;
}
function quandoCurto(iso) {
  const d = diaISO(iso), hoje = diaISO(new Date()), ontem = diaISO(new Date(Date.now() - 864e5));
  if (d === hoje) return hora(iso);
  if (d === ontem) return 'ontem';
  const [, m, dd] = d.split('-').map(Number);
  return `${dd} ${MES_CURTO[m - 1]}`;
}
function avatar(c) {
  const ini = esc((c?.nome || c?.email || '?').trim().charAt(0).toUpperCase());
  return c?.foto ? `<img src="${esc(c.foto)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${ini}'))">` : ini;
}
/** 404 de /api/admin/* = sessão de admin acabou: volta para a porta. */
function tratarErro(e) { if (e?.status === 404) { eu = null; portao('Sua sessão de admin acabou. Entre de novo com uma conta de administrador.'); return true; } return false; }

/* ============================================================ ENTRADA */
let gsi = null;
function carregarScript(src) {
  return new Promise((ok, falha) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = falha; document.head.append(s); });
}
async function botaoGoogle() {
  const caixa = $('#google-botao'), erro = $('#porta-erro');
  erro.hidden = true;
  let cfg = null;
  try { cfg = await get('/api/config'); } catch (e) { erro.textContent = mensagemDe(e); erro.hidden = false; return; }
  if (!cfg?.google_client_id) { erro.textContent = 'O login com Google ainda não está configurado neste servidor.'; erro.hidden = false; return; }
  try {
    gsi ??= carregarScript('https://accounts.google.com/gsi/client').then(() =>
      window.google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: aoEntrar, ux_mode: 'popup', auto_select: false, context: 'signin' }));
    await gsi;
  } catch { gsi = null; erro.textContent = 'Não deu para abrir o login do Google. Confira a internet ou o bloqueador.'; erro.hidden = false; return; }
  caixa.innerHTML = '';
  window.google.accounts.id.renderButton(caixa, { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'rectangular', locale: 'pt-BR', width: Math.min(356, caixa.clientWidth || 320) });
}
async function aoEntrar({ credential }) {
  try { eu = await post('/api/sessao', { credential }); portao(); }
  catch (e) { $('#porta-erro').textContent = mensagemDe(e); $('#porta-erro').hidden = false; }
}
function portao(mensagem) {
  const admin = !!eu?.conta?.admin;
  $('#porta').hidden = admin;
  $('#painel').hidden = !admin;
  if (admin) {
    $('#quem-avatar').innerHTML = avatar(eu.conta);
    $('#quem-nome').textContent = eu.conta.nome || eu.conta.email;
    $('#quem-email').textContent = eu.conta.email; $('#quem-email').title = eu.conta.email;
    if (!location.hash) history.replaceState(null, '', '#visao');
    mostrar();
    return;
  }
  const logado = !!eu?.conta;
  $('#porta-texto').textContent = mensagem || (logado
    ? `A conta ${eu.conta.email} não está na lista de administradores do Voa Aí. Entre com outra conta.`
    : 'Entre com a conta Google que está na lista de administradores do Voa Aí.');
  $('#porta-sair').hidden = !logado;
  $('#google-botao').hidden = logado;
  if (!logado) botaoGoogle();
}
async function sair() {
  try { await del('/api/sessao'); } catch {}
  try { window.google?.accounts.id.disableAutoSelect(); } catch {}
  eu = null; portao();
}
$('#sair').addEventListener('click', async () => { await sair(); location.href = '/'; });
$('#porta-sair').addEventListener('click', sair);

/* ============================================================ NAVEGAÇÃO */
function mostrar(foco) {
  const nome = SECOES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'visao';
  $$('.secao').forEach(s => s.classList.toggle('ativa', s.dataset.secao === nome));
  $$('.nav a').forEach(a => a.getAttribute('href') === '#' + nome ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  ({ visao: pintarVisao, voos: pintarVoos, contas: pintarContas, rotas: pintarRotas, limites: pintarLimites })[nome]();
  if (foco) $(`[data-secao="${nome}"] h1`).focus({ preventScroll: true });
}
addEventListener('hashchange', () => { if (eu?.conta?.admin) mostrar(true); });

/* ============================================================ VISÃO GERAL */
let periodo = 'mes';
$$('[data-periodo]').forEach(b => b.addEventListener('click', () => {
  periodo = b.dataset.periodo;
  $$('[data-periodo]').forEach(x => x.setAttribute('aria-pressed', x === b));
  pintarVisao();
}));
const mesDe = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const diasNoMes = m => { const [a, mm] = m.split('-').map(Number); return new Date(a, mm, 0).getDate(); };
/** por_dia → um valor por dia do mês (dias sem chamadas = 0), até hoje no mês atual. */
function serie(resumo, ate) {
  const m = resumo.mes, n = ate || diasNoMes(m), mapa = new Map();
  for (const p of resumo.por_dia || []) {
    const d = typeof p.dia === 'number' ? p.dia : Number(String(p.dia).slice(8, 10)) || Number(p.dia);
    if (d) mapa.set(d, (mapa.get(d) || 0) + (Number(p.usd) || 0));
  }
  const [, mm] = m.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => ({ dia: i + 1, mes: mm, usd: mapa.get(i + 1) || 0 }));
}
const cacheResumo = new Map();
function resumo(mes) {
  if (!cacheResumo.has(mes)) cacheResumo.set(mes, get(`/api/admin/resumo?mes=${mes}`).catch(e => { cacheResumo.delete(mes); throw e; }));
  return cacheResumo.get(mes);
}
async function pintarVisao() {
  const erroEl = $('#visao-erro'), conteudo = $('#visao-conteudo');
  const hoje = new Date(), mesAtual = mesDe(hoje), mesPassado = mesDe(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 15));
  cacheResumo.delete(mesAtual);   // o mês corrente muda a cada chamada
  let r, rAnt = null, cfg = null;
  try {
    [r, cfg] = await Promise.all([resumo(periodo === 'passado' ? mesPassado : mesAtual), carregarConfig().catch(() => null)]);
    if (periodo === '7' && hoje.getDate() < 7) rAnt = await resumo(mesPassado);
  } catch (e) {
    if (tratarErro(e)) return;
    conteudo.hidden = true; erroEl.hidden = false;
    erroEl.innerHTML = `<div class="erro-secao" role="alert"><svg aria-hidden="true"><use href="#i-alerta"/></svg><span>${esc(mensagemDe(e))}</span></div>`;
    return;
  }
  erroEl.hidden = true; conteudo.hidden = false;
  const fechado = periodo === 'passado', [ano, mm] = r.mes.split('-').map(Number), nomeMes = MESES[mm - 1];
  const diaHoje = hoje.getDate();
  let dias = serie(r, fechado ? null : diaHoje);
  if (periodo === '7') dias = [...(rAnt ? serie(rAnt) : []), ...dias].slice(-7);
  const credito = Number(r.credito_usd) || 0, gastoMes = Number(r.gasto_usd) || 0;
  const proj = fechado ? gastoMes : Number(r.projecao_usd ?? (gastoMes / Math.max(1, diaHoje) * diasNoMes(r.mes))) || 0;
  const gasto = periodo === '7' ? soma(dias.map(d => d.usd)) : gastoMes;
  const p0 = dias[0], p1 = dias[dias.length - 1];
  $('#periodo-texto').textContent = periodo === '7'
    ? `Últimos 7 dias (${p0.dia}${p0.mes !== p1.mes ? ` de ${MESES[p0.mes - 1]}` : ''} a ${p1.dia} de ${MESES[p1.mes - 1]}).`
    : fechado ? `${nomeMes[0].toUpperCase() + nomeMes.slice(1)} de ${ano}, mês fechado.` : `${nomeMes[0].toUpperCase() + nomeMes.slice(1)} de ${ano}, até hoje (dia ${diaHoje}).`;
  $('#gasto-valor').textContent = `US$ ${brl(gasto)}`;
  $('#gasto-de').textContent = periodo === '7' ? `nos últimos 7 dias (US$ ${brl(gastoMes)} no mês)` : credito ? `de US$ ${brl(credito)} de crédito` : '';
  const pct = v => (credito ? Math.min(100, v / credito * 100) : 0);
  const usado = pct(gastoMes), projPct = pct(proj);
  const med = $('#medidor');
  med.setAttribute('aria-valuenow', usado.toFixed(0));
  med.setAttribute('aria-valuetext', `${usado.toFixed(0)}% do crédito usado${fechado ? '' : `; projeção de ${projPct.toFixed(0)}%`}`);
  $('#med-usado').style.width = usado + '%';
  const projEl = $('#med-proj');
  projEl.hidden = fechado;
  projEl.style.left = `calc(${usado}% + 2px)`; projEl.style.width = `max(0px, calc(${projPct - usado}% - 2px))`;
  $('#leg-proj-wrap').hidden = fechado;
  const teto = num(cfg?.teto_mensal_usd);
  $('#med-teto').hidden = $('#leg-teto-wrap').hidden = !(credito && Number.isFinite(teto));
  if (credito && Number.isFinite(teto)) $('#med-teto').style.left = `calc(${pct(teto)}% - 1px)`;
  $('#leg-usado').textContent = credito ? `${usado.toFixed(0)}% do crédito do mês usado` : 'Crédito do mês não informado';

  const alerta = $('#alerta-gasto');
  const acima = credito && proj > credito;
  alerta.className = 'alerta ' + (acima ? 'alerta--atencao' : 'alerta--ok');
  const ritmo = gastoMes / Math.max(1, diaHoje), diaFim = ritmo > 0 ? Math.floor(credito / ritmo) : null;
  alerta.innerHTML = fechado
    ? (gastoMes <= credito || !credito
      ? `<span class="alerta__titulo"><svg aria-hidden="true"><use href="#i-ok"/></svg>Dentro do crédito</span>
         <b class="grande num">US$ ${brl(gastoMes)} no mês</b><span style="color:var(--c-tinta-meia)">${nomeMes[0].toUpperCase() + nomeMes.slice(1)} fechou sem cobrança no cartão.</span>`
      : `<span class="alerta__titulo"><svg aria-hidden="true"><use href="#i-alerta"/></svg>Passou do crédito</span>
         <b class="grande num">US$ ${brl(gastoMes)} no mês</b><span style="color:var(--c-tinta-meia)">US$ ${brl(gastoMes - credito)} além do crédito foram cobrados no cartão.</span>`)
    : acima
    ? `<span class="alerta__titulo"><svg aria-hidden="true"><use href="#i-alerta"/></svg>Projeção acima do crédito</span>
       <b class="grande num">US$ ${brl(proj)} no fim do mês</b>
       <span style="color:var(--c-tinta-meia)">${diaFim && diaFim <= diasNoMes(r.mes) ? `No ritmo atual, o crédito acaba por volta do dia ${diaFim}. ` : ''}Depois disso, cada chamada é cobrada no cartão.</span>
       <a class="botao" href="#limites" style="align-self:flex-start;margin-top:auto">Ajustar limites</a>`
    : `<span class="alerta__titulo"><svg aria-hidden="true"><use href="#i-ok"/></svg>Dentro do crédito</span><b class="grande num">US$ ${brl(proj)} no fim do mês</b>`;

  const noMes = periodo === '7' ? 'no mês' : 'no período';
  $('#numeros').innerHTML = [
    ['Voos acompanhados agora', fechado ? '–' : (r.voos_ativos ?? 0), fechado ? 'só vale para hoje' : 'com alerta ativo na AeroAPI'],
    ['Alertas entregues', r.alertas_entregues ?? 0, `US$ ${brl(PRECO_ALERTA, 3)} cada, ${noMes}`],
    ['Contas Google', r.contas ?? 0, 'com login'],
    ['Buscas por rota', r.buscas_rota ?? 0, noMes],
  ].map(([t, v, n]) => `<div class="numero"><span class="apoio" style="font-size:.875rem">${t}</span><b class="num">${esc(v)}</b><span class="pequeno">${n}</span></div>`).join('');

  barras(dias);
  $('#tipo-periodo').textContent = periodo === '7' ? 'US$ no mês' : 'US$ no período';
  const tipos = (r.por_tipo || []).map(t => {
    const ch = Number(t.chamadas) || 0, v = Number(t.usd) || 0;
    return [NOMES_TIPO[t.tipo] || t.tipo, ch ? `${ch} × US$ ${brl(v / ch, 3)}` : '0 chamadas', v];
  }).sort((a, b) => b[2] - a[2]);
  const max = Math.max(...tipos.map(t => t[2]), 1e-9);
  $('#tipos').innerHTML = tipos.length ? tipos.map(([n, d, v]) =>
    `<li><span class="tipos__nome"><b style="font-weight:600">${esc(n)}</b><span class="apoio">${esc(d)}</span></span><b class="tipos__valor num">${brl(v)}</b>
     <span class="tipos__barra" style="width:${(v / max * 100).toFixed(1)}%"></span></li>`).join('')
    : '<li class="pequeno">Nenhuma chamada à AeroAPI registrada no período.</li>';
}

function passoBonito(v) {
  const base = [1, 2, 5]; let p = 0.01;
  for (let e = -2; e < 6; e++) for (const b of base) { p = b * 10 ** e; if (p >= v) return p; }
  return p;
}
function barras(dias) {
  const el = $('#barras'), W = 760, H = 240, esq = 44, base = H - 28, topo = 14;
  const valores = dias.map(d => d.usd), maior = Math.max(...valores, 0);
  const passo = passoBonito(Math.max(maior, .1) / 4), vmax = Math.max(passo, Math.ceil(maior / passo - 1e-9) * passo);
  const n = dias.length, larg = (W - esq - 8) / n, bw = Math.max(4, larg * .62), r = Math.min(4, bw / 2);
  const y = v => base - (base - topo) * v / vmax;
  const casas = passo < .1 ? 2 : passo < 1 ? 1 : 0;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto por dia: entre US$ ${brl(Math.min(...valores))} e US$ ${brl(maior)}. A tabela abaixo tem os valores.">`;
  for (let v = 0; v <= vmax + 1e-9; v += passo) s += `<line x1="${esq}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#2A3F66"/><text x="${esq - 8}" y="${y(v) + 4}" text-anchor="end" fill="#A9B6CC" font-size="12">${brl(v, casas)}</text>`;
  dias.forEach((d, i) => {
    const x = esq + i * larg + (larg - bw) / 2, yy = y(d.usd);
    if (d.usd > 0) s += `<path class="barra" data-i="${i}" d="M${x} ${base} V${yy + r} Q${x} ${yy} ${x + r} ${yy} H${x + bw - r} Q${x + bw} ${yy} ${x + bw} ${yy + r} V${base} Z"/>`;
    s += `<rect class="alvo" data-i="${i}" x="${esq + i * larg}" y="${topo}" width="${larg}" height="${base - topo}"/>`;
    if (i === 0 || i === n - 1 || (n > 10 && i === Math.floor(n / 2))) s += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" fill="#A9B6CC" font-size="12">${d.dia} ${MES_CURTO[d.mes - 1]}</text>`;
  });
  el.innerHTML = s + '</svg><div class="dica-grafico" hidden></div>';
  const dica = el.querySelector('.dica-grafico'), svg = el.querySelector('svg');
  const mostrarDica = i => {
    el.classList.add('em-foco');
    el.querySelectorAll('.barra').forEach(b => b.classList.toggle('foco', +b.dataset.i === i));
    const b = el.querySelector(`.alvo[data-i="${i}"]`).getBBox(), k = svg.clientWidth / W;
    dica.innerHTML = `${dias[i].dia} de ${MESES[dias[i].mes - 1]}<b class="num">US$ ${brl(dias[i].usd)}</b>`;
    dica.style.left = (b.x + b.width / 2) * k + 'px'; dica.style.top = y(dias[i].usd) * k + 'px'; dica.hidden = false;
  };
  el.querySelectorAll('.alvo').forEach(a => a.addEventListener('mouseenter', () => mostrarDica(+a.dataset.i)));
  svg.addEventListener('mouseleave', () => { el.classList.remove('em-foco'); dica.hidden = true; });
  $('#tabela-dias').innerHTML = `<caption class="sr">Gasto por dia</caption><thead><tr><th>Dia</th><th class="n">US$</th></tr></thead><tbody>`
    + dias.map(d => `<tr><td>${d.dia} ${MES_CURTO[d.mes - 1]}</td><td class="n">${brl(d.usd)}</td></tr>`).join('') + '</tbody>';
}

/* ============================================================ VOOS */
function placaEstado(v) {
  const cod = esc(v.ident_iata || v.ident || '?');
  const atr = Math.max(Number(v.atraso_min) || 0, 0);
  const [cls, txt, extra] = {
    previsto: ['dir', 'Previsto'], no_portao: ['dir', 'No portão'], em_voo: ['dir', 'Em voo', atr >= 15 ? ['ate', `+${atr}`] : null],
    atrasado: ['dir', 'Atrasado', atr ? ['ate', `+${atr}`] : null], pousou: ['ok', 'Pousou'], no_portao_destino: ['ok', 'Chegou'],
    cancelado: ['crit', 'Cancelado'], desviado: ['ate', 'Desviado'],
  }[v.estado] || ['dir', esc(v.estado || '–')];
  return `<span class="placa"><span class="loc">${cod}</span><span class="${cls}">${txt}</span>${extra ? `<span class="${extra[0]}">${extra[1]}</span>` : ''}</span>`;
}
let voos = [];
async function pintarVoos() {
  const corpo = $('#tabela-voos');
  if (!voos.length) corpo.innerHTML = linhaCarregando(6);
  try { voos = (await get('/api/admin/voos'))?.voos || []; }
  catch (e) { if (!tratarErro(e)) corpo.innerHTML = linhaErro(6, e); return; }
  corpo.innerHTML = voos.length ? voos.map((x, i) => {
    const v = x.voo || {}, cod = esc(v.ident_iata || v.ident || '');
    return `<tr><td>${placaEstado(v)}</td><td>${esc(v.origem?.iata || '?')} a ${esc(v.destino?.iata || '?')}</td>
      <td class="n">${x.inscritos ?? 0}</td><td class="n">${x.alertas_entregues ?? 0}</td><td class="n">${brl(x.custo_usd)}</td>
      <td style="text-align:right">${x.inscritos || x.alert_id
        ? `<button class="botao botao--sec botao--mini" type="button" data-parar="${i}" aria-label="Parar os avisos do voo ${cod} para todos os inscritos">Parar avisos</button>`
        : '<span class="pequeno">Avisos parados</span>'}</td></tr>`;
  }).join('') : linhaVazia(6, 'Nenhum voo acompanhado agora.');
}
$('#tabela-voos').addEventListener('click', async e => {
  const b = e.target.closest('[data-parar]'); if (!b) return;
  const x = voos[b.dataset.parar], v = x.voo, cod = v.ident_iata || v.ident, n = x.inscritos || 0;
  if (!await confirmar(`Parar os avisos do ${cod}?`, `${n === 1 ? '1 pessoa deixa' : `${n} pessoas deixam`} de receber avisos deste voo. O alerta é apagado na AeroAPI e não volta.`, 'Parar avisos', 'Manter')) return;
  ocupado(b, true);
  try { await post(`/api/admin/voos/${encodeURIComponent(v.fa_flight_id)}/parar`); avisar(`Avisos do ${cod} parados`); pintarVoos(); }
  catch (err) { if (!tratarErro(err)) { avisar(mensagemDe(err)); ocupado(b, false); } }
});

/* ============================================================ CONTAS */
let contas = [];
async function pintarContas() {
  const corpo = $('#tabela-contas');
  if (!contas.length) corpo.innerHTML = linhaCarregando(6);
  try { [contas] = await Promise.all([get('/api/admin/contas').then(r => r?.contas || []), carregarConfig().catch(() => null)]); }
  catch (e) { if (!tratarErro(e)) corpo.innerHTML = linhaErro(6, e); return; }
  const lim = num(config?.limite_voos_conta);
  corpo.innerHTML = contas.length ? contas.map((c, i) => {
    const nome = esc(c.nome || c.email), b = sim(c.bloqueado), eu_ = c.email === eu?.conta?.email;
    return `<tr>
      <td><span class="pessoa"><span class="avatar" aria-hidden="true">${avatar(c)}</span><span><b>${nome}</b><br><span class="pequeno">${esc(c.email)}</span></span></span></td>
      <td>${b ? '<span class="estado-conta" style="color:var(--c-cancelado)"><svg aria-hidden="true"><use href="#i-bloq"/></svg>Bloqueada</span>'
        : '<span class="estado-conta" style="color:var(--c-ok)"><svg aria-hidden="true"><use href="#i-ok"/></svg>Ativa</span>'}</td>
      <td class="n">${c.voos_ativos ?? 0}${Number.isFinite(lim) && c.voos_ativos >= lim ? ' <span class="pequeno" style="font:inherit;font-size:.75rem">no limite</span>' : ''}</td>
      <td class="n">${c.buscas_mes ?? 0}</td><td>${esc(quando(c.ultimo_acesso))}</td>
      <td style="text-align:right;white-space:nowrap">${eu_ ? '<span class="pequeno">Você</span>' : `
        <button class="botao botao--sec botao--mini" type="button" data-bloq="${i}">${b ? 'Desbloquear' : 'Bloquear'}<span class="sr"> ${nome}</span></button>
        <button class="botao botao--perigo botao--mini" type="button" data-apagar="${i}">Apagar<span class="sr"> a conta de ${nome}</span></button>`}</td></tr>`;
  }).join('') : linhaVazia(6, 'Nenhuma conta Google ainda.');
}
$('#tabela-contas').addEventListener('click', async e => {
  const bloq = e.target.closest('[data-bloq]'), ap = e.target.closest('[data-apagar]');
  const botao = bloq || ap; if (!botao) return;
  const c = contas[botao.dataset.bloq ?? botao.dataset.apagar], nome = c.nome || c.email;
  try {
    if (bloq) {
      const novo = !sim(c.bloqueado);
      ocupado(botao, true);
      await post(`/api/admin/contas/${encodeURIComponent(c.id)}/bloquear`, { bloqueado: novo });
      avisar(novo ? `${nome} não consegue mais acompanhar voos nem buscar rotas` : `${nome} desbloqueada`);
    } else {
      if (!await confirmar(`Apagar a conta de ${nome}?`, `Apaga o login, as sessões e o vínculo dos aparelhos. ${c.voos_ativos ? `Os ${plural(c.voos_ativos, 'voo', 'voos')} param de receber avisos. ` : ''}Não dá para desfazer.`, 'Apagar conta', 'Manter conta')) return;
      ocupado(botao, true);
      await del(`/api/admin/contas/${encodeURIComponent(c.id)}`);
      avisar('Conta apagada');
    }
    pintarContas();
  } catch (err) { if (!tratarErro(err)) { avisar(mensagemDe(err)); ocupado(botao, false); } }
});

/* ============================================================ ROTAS */
async function pintarRotas() {
  const corpo = $('#tabela-rotas');
  corpo.innerHTML = linhaCarregando(5);
  let rotas;
  try { rotas = (await get('/api/admin/rotas'))?.rotas || []; }
  catch (e) { if (!tratarErro(e)) corpo.innerHTML = linhaErro(5, e); return; }
  rotas.sort((a, b) => (b.buscas || 0) - (a.buscas || 0));
  corpo.innerHTML = rotas.length ? rotas.map(r => {
    const n = Number(r.buscas) || 0, cache = Number(r.acertos_cache) || 0;
    return `<tr><td><span class="placa"><span class="loc">${esc(r.de)}</span><span class="dir">para ${esc(r.para)}</span></span></td>
      <td class="n">${n}</td><td class="n">${cache}</td><td class="n">${Math.max(0, n - cache)}</td><td class="n">${brl(r.custo_usd)}</td></tr>`;
  }).join('') : linhaVazia(5, 'Nenhuma busca por rota este mês.');
}

/* ============================================================ LIMITES */
async function carregarConfig() {
  const r = await get('/api/admin/config');
  config = r?.config || {}; auditoria = r?.auditoria || [];
  return config;
}
function valorCampo(chave) { return chave === 'rota_ligada' ? !sim(config.rota_pausada) : chave === 'modo_economico' ? sim(config.modo_economico) : num(config[chave]); }
async function pintarLimites() {
  const erro = $('#erro-limites');
  try { await carregarConfig(); }
  catch (e) { if (!tratarErro(e)) { erro.textContent = mensagemDe(e); erro.hidden = false; } return; }
  $$('#form-limites input').forEach(i => {
    const v = valorCampo(i.dataset.chave);
    i.value = Number.isFinite(v) ? (i.hasAttribute('data-decimal') ? brl(v) : String(v)) : '';
    i.removeAttribute('aria-invalid');
  });
  $$('.interruptor').forEach(b => b.setAttribute('aria-checked', valorCampo(b.dataset.chave)));
  erro.hidden = true;
  pintarAuditoria();
}
function pintarAuditoria() {
  $('#auditoria').innerHTML = auditoria.length ? auditoria.map(a =>
    `<li><time datetime="${esc(a.em)}">${esc(quandoCurto(a.em))}</time><span>${esc(a.acao)}${a.detalhe ? `: ${esc(a.detalhe)}` : ''}<br><span class="pequeno">${esc(a.admin_email || '')}</span></span></li>`).join('')
    : '<li><span></span><span class="pequeno">Nenhuma mudança registrada ainda.</span></li>';
}
$$('.interruptor').forEach(b => b.addEventListener('click', () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true')));
$('#form-limites').addEventListener('submit', async e => {
  e.preventDefault();
  const erro = $('#erro-limites'), novo = {}, erros = [];
  $$('#form-limites input').forEach(i => {
    const v = Number(i.value.trim().replace(/\./g, i.hasAttribute('data-decimal') && i.value.includes(',') ? '' : '.').replace(',', '.'));
    const ok = i.value.trim() !== '' && Number.isFinite(v) && v >= 0 && (i.hasAttribute('data-decimal') || Number.isInteger(v)) && v <= 1000;
    i.setAttribute('aria-invalid', !ok);
    if (ok) novo[i.dataset.chave] = v; else erros.push(i.dataset.nome);
  });
  if (erros.length) { erro.textContent = `Confira: ${erros.join(', ')}. Use números inteiros de 0 a 1000 (o teto aceita centavos).`; erro.hidden = false; return; }
  if (novo.limite_voos_conta < novo.limite_voos_anonimo) { erro.textContent = 'Quem entra com Google deve poder acompanhar pelo menos tantos voos quanto quem não entra.'; erro.hidden = false; return; }
  const rotaLigada = $('[data-chave="rota_ligada"]').getAttribute('aria-checked') === 'true';
  const eco = $('[data-chave="modo_economico"]').getAttribute('aria-checked') === 'true';
  const mudou = {};
  for (const k in novo) if (novo[k] !== num(config[k])) mudou[k] = novo[k];
  if (rotaLigada === sim(config.rota_pausada)) mudou.rota_pausada = !rotaLigada;
  if (eco !== sim(config.modo_economico)) mudou.modo_economico = eco;
  erro.hidden = true;
  if (!Object.keys(mudou).length) { avisar('Nada mudou.'); return; }
  const b = $('#salvar-limites'); ocupado(b, true);
  try {
    await put('/api/admin/config', mudou);
    avisar('Limites salvos. Já valem para todo mundo.');
    await pintarLimites();
  } catch (err) { if (!tratarErro(err)) { erro.textContent = mensagemDe(err); erro.hidden = false; } }
  finally { ocupado(b, false); }
});

/* ============================================================ INÍCIO */
(async () => {
  try { eu = await get('/api/eu'); } catch (e) { eu = null; portao(mensagemDe(e)); return; }
  portao();
})();
