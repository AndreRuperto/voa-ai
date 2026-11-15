/* Voa Aí · app (PWA). Telas por hash, como no protótipo v2, mas com dados da API (docs/13-api.md).
   #inicio · #confirmacao/<ident>/<data> · #status/<fa_flight_id> · #meus-voos · #rota · #entrar
   /v/<fa_flight_id> abre o status desse voo e oferece "Me avisar". */
import { get, post, put, del, mensagemDe } from '/api.js';
import { agruparViagens, conexao, momentoDaViagem } from '/viagens.js';
import { hora, diaISO, diasDeBusca, diaRelativo, nomeDoDia, duracao, minutosEntre, esc, plural } from '/formato.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
const desktop = matchMedia('(min-width: 960px)');
const MAX_PARES = 3;                      // docs/12: no máximo 3 pares de aeroportos por busca
const ATUALIZAR_MS = 60000;
const ANDAR_MS = 2000;                    // o avião avança no globo entre as consultas               // status atualiza a cada 60 s com a tela visível

const estado = {
  config: null,          // /api/config
  eu: null,              // /api/eu
  inscricoes: null,      // /api/inscricoes
  voos: new Map(),       // fa_flight_id → Voo (último visto)
  busca: null,           // { chave, voos, escolhido }
  paises: null, aeroportos: new Map(),
};

/* ============================================================ APOIO */
const toast = $('#toast');
function avisar(msg, ms = 3600) { toast.textContent = msg; toast.hidden = false; clearTimeout(avisar.t); avisar.t = setTimeout(() => toast.hidden = true, ms); }

const folha = $('#folha');
function confirmar({ titulo, texto, sim, nao, perigo = true }) {
  $('#folha-titulo').textContent = titulo; $('#folha-texto').textContent = texto;
  $('#folha-sim').textContent = sim; $('#folha-nao').textContent = nao;
  $('#folha-sim').style.background = perigo ? 'var(--c-cancelado)' : '';
  folha.returnValue = ''; folha.showModal();
  return new Promise(r => folha.addEventListener('close', () => r(folha.returnValue === 'sim'), { once: true }));
}

function ocupado(botao, sim) { if (!botao) return; botao.toggleAttribute('disabled', sim); botao.setAttribute('aria-busy', sim ? 'true' : 'false'); }
function mostrarErro(el, html) { if (!el) return; el.querySelector('span').innerHTML = html; el.hidden = false; }
function esconderErro(el) { if (el) el.hidden = true; }
const pintados = new WeakMap();
function pintar(el, html) { if (pintados.get(el) !== html) { el.innerHTML = html; pintados.set(el, html); } }   // não repete anúncios do leitor de tela

const icone = (id, extra = '') => `<svg aria-hidden="true"${extra}><use href="#${id}"/></svg>`;
function vazio({ titulo, texto = '', acao = '', erro = false, marca = !erro }) {
  return `<div class="vazio${erro ? ' vazio--erro' : ''}">
    <span class="vazio__icone" aria-hidden="true">${marca ? '<svg><use href="#i-marca"/></svg>' : `<svg class="i"><use href="#${erro ? 'i-alerta' : 'i-aviao'}"/></svg>`}</span>
    <h2>${titulo}</h2>${texto ? `<p class="apoio">${texto}</p>` : ''}${acao}</div>`;
}
const esqueleto = (n = 3) => `<div class="esqueleto" aria-hidden="true"><i class="placa-e"></i>${'<i></i><i class="curto"></i>'.repeat(n)}</div>`;

/* ============================================================ DADOS DO VOO */
const codigo = v => v?.ident_iata || v?.ident || '';
const fusoDe = v => v?.destino?.fuso || undefined;
const h = v => v?.horarios || {};
const nomeCurto = a => (a?.nome && a.nome.length <= 22 ? a.nome : a?.cidade || a?.nome || a?.iata || '');
const cidade = a => a?.cidade || a?.nome || a?.iata || '';
const saidaDe = v => h(v).saida_real || h(v).saida_estimada || h(v).saida_prevista;
const pousoDe = v => h(v).pouso_real || h(v).pouso_estimado || h(v).pouso_previsto || h(v).chegada_estimada || h(v).chegada_prevista;
const chegadaDe = v => h(v).chegada_real || h(v).chegada_estimada || h(v).chegada_prevista || pousoDe(v);
const terminou = v => ['pousou', 'no_portao_destino', 'cancelado', 'desviado'].includes(v?.estado);
const noSolo = v => ['previsto', 'no_portao', 'atrasado'].includes(v?.estado);
const temCoordenadas = v => [v?.origem?.lat, v?.origem?.lon, v?.destino?.lat, v?.destino?.lon].every(Number.isFinite);

function atrasoSaida(v) {
  const d = minutosEntre(h(v).saida_prevista, h(v).saida_estimada);
  return d && d > 0 ? Math.round(d) : 0;
}
/** Fração do voo, estimada pelo tempo entre a decolagem real e o pouso estimado (docs/13). */
function progresso(v) {
  if (!v) return 0;
  if (v.estado === 'pousou' || v.estado === 'no_portao_destino') return 1;
  if (v.estado !== 'em_voo') return 0;
  const ini = h(v).decolagem_real || h(v).saida_real, fim = h(v).pouso_estimado || h(v).pouso_previsto;
  const total = minutosEntre(ini, fim), feito = minutosEntre(ini, new Date());
  if (total > 0 && feito !== null) return Math.min(.99, Math.max(.01, feito / total));
  return Math.min(.99, Math.max(.01, Number(v.progresso) || .5));
}
const faltaMin = v => Math.max(0, minutosEntre(new Date(), h(v).pouso_estimado || h(v).pouso_previsto) || 0);

/** O que a placa diz em cada estado (cor + palavra, nunca só cor). */
function infoEstado(v) {
  const f = fusoDe(v), dest = v.destino?.iata || '', hr = iso => hora(iso, f);
  const atr = Number(v.atraso_min) || 0;
  switch (v.estado) {
    case 'no_portao':
      return { tipo: 'direcao', estado: 'No portão', detalhe: h(v).saida_real ? 'saiu do portão' : `sai ${hr(saidaDe(v))}`, curto: 'no portão',
        aria: `no portão, sai às ${hr(saidaDe(v))}` };
    case 'atrasado': {
      const n = atrasoSaida(v) || atr;
      return { tipo: 'direcao', estado: 'Atrasado', detalhe: `sai ${hr(h(v).saida_estimada || saidaDe(v))}`, curto: `+${n} min`, curtoTipo: 'atencao',
        extra: n ? { estado: `+${n}`, detalhe: 'min' } : null,
        aria: `atrasado ${duracao(n)}, nova saída às ${hr(h(v).saida_estimada || saidaDe(v))}, chega às ${hr(pousoDe(v))} em ${nomeCurto(v.destino)}` };
    }
    case 'em_voo':
      return { tipo: 'direcao', estado: 'Em voo', detalhe: `chega ${hr(pousoDe(v))} em ${dest}`, curto: 'em voo',
        extra: atr >= 15 ? { estado: `+${atr}`, detalhe: 'min' } : null,
        aria: `em voo, chega às ${hr(pousoDe(v))} em ${nomeCurto(v.destino)}${atr >= 15 ? `, ${duracao(atr)} de atraso` : ''}` };
    case 'pousou':
      return { tipo: 'pousou', estado: 'Pousou', detalhe: `às ${hr(h(v).pouso_real || pousoDe(v))} em ${dest}`, curto: 'pousou', curtoTipo: 'pousou',
        aria: `pousou às ${hr(h(v).pouso_real || pousoDe(v))} em ${nomeCurto(v.destino)}` };
    case 'no_portao_destino':
      return { tipo: 'pousou', estado: 'Chegou', detalhe: `ao portão às ${hr(h(v).chegada_real || chegadaDe(v))}`, curto: 'chegou', curtoTipo: 'pousou',
        aria: `chegou ao portão às ${hr(h(v).chegada_real || chegadaDe(v))} em ${nomeCurto(v.destino)}` };
    case 'cancelado':
      return { tipo: 'critico', estado: 'Cancelado', detalhe: 'pela companhia', curto: 'cancelado', curtoTipo: 'critico', aria: 'cancelado pela companhia' };
    case 'desviado':
      return { tipo: 'desvio', estado: 'Desviado', detalhe: `não pousa em ${dest}`, curto: 'desviado', curtoTipo: 'desvio',
        aria: `desviado, não vai pousar em ${nomeCurto(v.destino)}` };
    default:
      return { tipo: 'direcao', estado: 'Previsto', detalhe: `sai ${hr(saidaDe(v))}`, curto: 'previsto',
        aria: `previsto, sai às ${hr(saidaDe(v))}, chega às ${hr(pousoDe(v))} em ${nomeCurto(v.destino)}` };
  }
}
function placa(v) {
  const i = infoEstado(v);
  return `<div class="placa" role="status" aria-label="${esc(`${codigo(v)}: ${i.aria}`)}">
    <span class="placa__local num">${esc(codigo(v))}</span>
    <span class="placa__${i.tipo}"><span class="placa__estado">${i.estado}</span><span class="placa__detalhe num">${esc(i.detalhe)}</span></span>
    ${i.extra ? `<span class="placa__atencao"><span class="placa__estado num">${i.extra.estado}</span><span class="placa__detalhe">${i.extra.detalhe}</span></span>` : ''}
  </div>`;
}
function placaMini(cod, texto, tipo = 'direcao', extra = '') {
  return `<span class="placa placa--mini"><span class="placa__local num">${esc(cod)}</span>${texto ? `<span class="placa__${tipo} num">${esc(texto)}</span>` : ''}${extra}</span>`;
}
function placaMiniVoo(v) {
  const i = infoEstado(v), f = fusoDe(v);
  if (v.estado === 'atrasado') return placaMini(codigo(v), `Atrasado, sai ${hora(h(v).saida_estimada || saidaDe(v), f)}`, 'direcao', i.extra ? `<span class="placa__atencao num">+${esc(i.extra.estado.slice(1))} min</span>` : '');
  if (v.estado === 'em_voo') return placaMini(codigo(v), `Em voo, chega ${hora(pousoDe(v), f)}`, 'direcao', i.extra ? `<span class="placa__atencao num">${esc(i.extra.estado)} min</span>` : '');
  if (v.estado === 'previsto' || v.estado === 'no_portao') return placaMini(codigo(v), `${i.estado}, sai ${hora(saidaDe(v), f)}`);
  return placaMini(codigo(v), `${i.estado}${i.tipo === 'pousou' ? ' ' + i.detalhe : ''}`, i.tipo);
}

/* ============================================================ CARREGAR DO SERVIDOR */
async function carregarEu() {
  try { estado.eu = await get('/api/eu'); } catch { /* sem servidor: a tela segue com os textos genéricos */ }
  pintarConta();
  return estado.eu;
}
async function carregarInscricoes() {
  try {
    const r = await get('/api/inscricoes');
    estado.inscricoes = r?.inscricoes || [];
    for (const i of estado.inscricoes) if (i.voo?.fa_flight_id) estado.voos.set(i.voo.fa_flight_id, i.voo);
  } catch (e) { estado.inscricoes ??= null; estado.erroInscricoes = e; return null; }
  estado.erroInscricoes = null;
  pintarContador();
  return estado.inscricoes;
}
const inscricaoDe = id => estado.inscricoes?.find(i => i.voo?.fa_flight_id === id) || null;

/* ============================================================ VIAGENS COM CONEXÃO (public/viagens.js) */
/** Inscrições com o dado mais novo de cada voo (o status atualiza estado.voos antes da lista). */
const inscricoesAtuais = () => (estado.inscricoes || []).map(i => ({ ...i, voo: estado.voos.get(i.voo?.fa_flight_id) || i.voo }));
/** A viagem (2+ trechos) de que o voo faz parte, ou null. */
function viagemDe(id) {
  const g = agruparViagens(inscricoesAtuais()).find(x => x.pernas.some(p => p.voo.fa_flight_id === id));
  return g && g.pernas.length > 1 ? g : null;
}
const rotaDaViagem = pernas => [pernas[0].voo.origem, ...pernas.map(p => p.voo.destino)];
/** Entradas do globo para uma viagem, vista a partir do trecho `i`: antes dele, o que já voou fica como rastro;
 *  depois dele, tracejado sem avião. Só o destino final tem halo. */
function globoDaViagem(pernas, i) {
  return pernas.map((p, j) => {
    const v = p.voo, ultimo = j === pernas.length - 1;
    const base = j < i && terminou(v) && v.estado !== 'cancelado' && v.estado !== 'desviado' ? { ...paraGlobo(v), tipo: 'feito' }
      : j > i ? { ...paraGlobo(v), tipo: v.estado === 'cancelado' ? 'cancelado' : 'opcao' } : paraGlobo(v);
    return { ...base, semHalo: !ultimo };
  }).filter((_, j) => temCoordenadas(pernas[j].voo));
}
/** Linha entre dois trechos: escala, conexão apertada ou perdida (cor + ícone + palavra). */
function conexaoHtml(a, b) {
  const c = conexao(a, b), onde = cidade(c.aeroporto), dur = Math.abs(c.minutos);
  const trocou = !!h(b).saida_real || ['em_voo', 'pousou', 'no_portao_destino'].includes(b.estado);
  let cls = 'ok', ic = 'i-conexao', txt;
  if (a.estado === 'cancelado' || b.estado === 'cancelado') { cls = 'critico'; ic = 'i-alerta'; txt = 'Conexão afetada: trecho cancelado'; }
  else if (a.estado === 'desviado') { cls = 'critico'; ic = 'i-alerta'; txt = `Conexão afetada: o voo foi desviado e não vai pousar em ${onde}`; }
  else if (trocou) txt = `Trocou de avião em ${onde}`;
  else if (c.risco === 'perdida') { cls = 'critico'; ic = 'i-alerta'; txt = `Pode perder a conexão em ${onde}: chega ${duracao(dur)} depois da saída do próximo voo`; }
  else if (c.risco === 'apertada') { cls = 'atencao'; ic = 'i-alerta'; txt = `Conexão apertada em ${onde}: ${duracao(dur)} para trocar de avião`; }
  else txt = `Conexão em ${onde}: ${duracao(dur)} de escala`;
  return `<li class="conexao conexao--${cls}">${icone(ic)}<span>${esc(txt)}</span></li>`;
}
/** Uma frase sobre onde a viagem está agora. */
function fraseDaViagem(pernas) {
  const voos = pernas.map(p => p.voo), m = momentoDaViagem(voos), n = voos.length, v = m.perna;
  if (m.fase === 'antes') return `${n} trechos, sai ${diaRelativo(saidaDe(voos[0]), fusoDe(voos[0]))} às ${hora(saidaDe(voos[0]), fusoDe(voos[0]))}`;   // mesmo fuso da placa do trecho
  if (m.fase === 'voando') return `Trecho ${m.indice + 1} de ${n} em voo, chega a ${cidade(v.destino)} às ${hora(pousoDe(v), fusoDe(v))}`;
  if (m.fase === 'conexao') return `Em ${cidade(v.origem)}, trocando de avião. Próximo voo sai às ${hora(saidaDe(v), fusoDe(v))}`;
  if (m.fase === 'chegou') return `Chegou a ${cidade(v.destino)}`;
  return `Trecho ${m.indice + 1} ${v.estado === 'cancelado' ? 'cancelado' : 'desviado'}`;
}
/** Servidor com AeroAPI simulada (só em desenvolvimento): avisa na tela, para ninguém confundir com voo de verdade. */
function mostrarSeloSimulado(c) {
  if (!c?.simulada || $('.selo-simulado')) return;
  const p = document.createElement('p');
  p.className = 'selo-simulado'; p.setAttribute('role', 'note');
  p.innerHTML = 'Dados simulados<span> · voos de teste: TP1018, TP103, G31402, AD4510, LA8084, EK262 + EK318 (conexão)</span>';
  document.body.append(p);
}
const aeroapiDesligada = () => estado.config && estado.config.aeroapi === false;
const MSG_SEM_AEROAPI = 'O serviço de voos ainda não está configurado. Tente de novo mais tarde.';
/** Limites com conta (para convidar a entrar). A forma de config.limites não está no contrato; tenta os nomes da tabela CONFIG. */
function limiteComConta(tipo) {
  const l = estado.config?.limites || {};
  const v = tipo === 'voos' ? (l.limite_voos_conta ?? l.voos_conta ?? l.conta?.voos) : (l.limite_rota_conta ?? l.buscas_rota_conta ?? l.conta?.buscas_rota);
  return Number.isFinite(Number(v)) && v !== null ? Number(v) : null;
}

/* ============================================================ TOPO E CONTA */
function avatarHtml(conta) {
  const inicial = esc((conta?.nome || conta?.email || '?').trim().charAt(0).toUpperCase());
  return conta?.foto ? `<img src="${esc(conta.foto)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${inicial}'))">` : inicial;
}
function pintarContador() {
  const el = $('#contador');
  const n = estado.eu?.uso?.voos ?? estado.inscricoes?.length;
  el.hidden = !Number.isFinite(n) || n === 0;
  if (!el.hidden) { el.textContent = n; el.setAttribute('aria-label', plural(n, 'voo', 'voos')); }
}
function pintarConta() {
  const conta = estado.eu?.conta || null, lim = estado.eu?.limites || {}, uso = estado.eu?.uso || {};
  const link = $('#link-conta');
  link.innerHTML = conta ? `<span class="avatar">${avatarHtml(conta)}</span><span class="link-conta__texto">Minha conta</span>` : 'Entrar';
  $('#conta-fora').hidden = !!conta;
  $('#conta-dentro').hidden = !conta;
  pintarContador();
  // fora
  $('#entrar-apoio').textContent = Number.isFinite(lim.voos)
    ? `Entrar é opcional. Sem conta você continua acompanhando até ${plural(lim.voos, 'voo', 'voos')} neste aparelho.`
    : 'Entrar é opcional. Sem conta você continua acompanhando seus voos neste aparelho.';
  const lConta = limiteComConta('voos');
  $('#vantagens').innerHTML = [
    '"Meus voos" no celular e no computador',
    lConta ? `Até ${lConta} voos ao mesmo tempo` : null,
    uso.voos ? (uso.voos === 1 ? 'O voo deste aparelho vai junto' : `Os ${uso.voos} voos deste aparelho vão junto`) : null,
  ].filter(Boolean).map(t => `<li>${icone('i-check')}${esc(t)}</li>`).join('');
  // dentro
  if (conta) {
    $('#conta-avatar').innerHTML = avatarHtml(conta);
    $('#conta-nome').textContent = conta.nome || conta.email;
    $('#conta-email').textContent = `${conta.email}, entrou com Google`;
    const partes = [uso.voos ? `${uso.voos === 1 ? 'Seu voo está' : `Seus ${uso.voos} voos estão`} na conta.` : 'Ainda não há voos na conta.'];
    if (Number.isFinite(lim.voos)) partes.push(`Você pode acompanhar até ${lim.voos} ao mesmo tempo${Number.isFinite(lim.buscas_rota) ? ` e fazer ${plural(lim.buscas_rota, 'busca', 'buscas')} por rota por dia` : ''}.`);
    $('#conta-resumo').textContent = partes.join(' ');
    $('#link-admin').hidden = !conta.admin;
  }
}

/* ---- Google Identity Services (botão oficial) */
let gsi = null;
function carregarScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.defer = true;
    s.onload = ok; s.onerror = () => falha(new Error('script')); document.head.append(s);
  });
}
async function prepararGoogle() {
  const caixa = $('#google-botao'), erro = $('#entrar-erro');
  esconderErro(erro);
  await Promise.all([estado.configPronta, estado.euPronta]);
  if (rotaAtual().nome !== 'entrar' || estado.eu?.conta) return;
  if (!estado.config) { caixa.innerHTML = ''; return mostrarErro(erro, 'Não deu para falar com o servidor agora. Tente de novo em alguns minutos.'); }
  const id = estado.config.google_client_id;
  if (!id) { caixa.innerHTML = ''; return mostrarErro(erro, 'O login com Google ainda não está configurado neste servidor.'); }
  try {
    gsi ??= carregarScript('https://accounts.google.com/gsi/client').then(() => {
      window.google.accounts.id.initialize({ client_id: id, callback: aoEntrar, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, context: 'signin', itp_support: true });
    });
    await gsi;
  } catch {
    gsi = null;
    return mostrarErro(erro, 'Não deu para abrir o login do Google. Confira a internet ou se algum bloqueador está ligado.');
  }
  caixa.innerHTML = '';
  window.google.accounts.id.renderButton(caixa, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'rectangular',
    logo_alignment: 'left', locale: 'pt-BR', width: Math.max(220, Math.min(400, caixa.clientWidth || 320)) });
}
async function aoEntrar(resposta) {
  const erro = $('#entrar-erro'); esconderErro(erro);
  try {
    const eu = await post('/api/sessao', { credential: resposta.credential });
    estado.eu = eu; pintarConta();
    await carregarInscricoes();
    const n = eu?.uso?.voos || 0;
    avisar(n ? `Você entrou. ${n === 1 ? 'Seu voo agora está' : `Seus ${n} voos agora estão`} na conta.` : 'Você entrou com Google.');
    location.hash = 'meus-voos';
  } catch (e) { mostrarErro(erro, esc(mensagemDe(e))); }
}
$('#sair').addEventListener('click', async e => {
  const b = e.currentTarget; ocupado(b, true);
  try {
    await del('/api/sessao');
    try { window.google?.accounts.id.disableAutoSelect(); } catch {}
    await Promise.all([carregarEu(), carregarInscricoes()]);
    avisar('Você saiu deste aparelho. Os voos continuam aqui.');
    if (rotaAtual().nome === 'entrar') prepararGoogle();
  } catch (err) { avisar(mensagemDe(err)); }
  finally { ocupado(b, false); }
});
$('#apagar-conta').addEventListener('click', async e => {
  const ok = await confirmar({ titulo: 'Apagar sua conta?', texto: 'Apaga o login, as sessões e o vínculo com os seus aparelhos. Os voos deste aparelho continuam aqui, sem conta. Não dá para desfazer.',
    sim: 'Apagar conta', nao: 'Manter conta' });
  if (!ok) return;
  const b = e.target; ocupado(b, true);
  try {
    await del('/api/eu');
    try { window.google?.accounts.id.disableAutoSelect(); } catch {}
    await Promise.all([carregarEu(), carregarInscricoes()]);
    avisar('Conta apagada. Os voos deste aparelho continuam.');
    prepararGoogle();
  } catch (err) { avisar(mensagemDe(err)); }
  finally { ocupado(b, false); }
});

/* ============================================================ AVISOS (push) */
const ehIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const iosSemInstalar = ehIOS && ehSafari && !instalado;
const suportaPush = () => isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function mostrarCaixasIOS() { $$('[data-so-ios]').forEach(el => el.hidden = !iosSemInstalar); }

let registroSW = null;
function registrarSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  registroSW ??= navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => (registroSW = null));
  return registroSW;
}
function chaveVapid(b64) {
  const p = '='.repeat((4 - b64.length % 4) % 4), s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
/** Pede a permissão, assina o push e manda a assinatura para a inscrição. */
async function ligarAvisos(idInscricao) {
  if (!suportaPush()) return iosSemInstalar ? 'ios' : 'sem_suporte';
  if (!estado.config?.vapid_publica) return 'sem_chave';
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = Notification.permission; } }
  if (perm === 'denied') return 'negado';
  if (perm !== 'granted') return 'pendente';
  const reg = await registrarSW(); if (!reg) return 'sem_suporte';
  const pronto = await navigator.serviceWorker.ready;
  const opcoes = { userVisibleOnly: true, applicationServerKey: chaveVapid(estado.config.vapid_publica) };
  let sub = await pronto.pushManager.getSubscription();
  if (!sub) {
    try { sub = await pronto.pushManager.subscribe(opcoes); }
    catch { const velha = await pronto.pushManager.getSubscription(); await velha?.unsubscribe(); sub = await pronto.pushManager.subscribe(opcoes); }
  }
  await put(`/api/inscricoes/${encodeURIComponent(idInscricao)}/push`, { push: sub.toJSON() });
  return 'ok';
}
async function situacaoAvisos() {
  if (!suportaPush()) return iosSemInstalar ? 'ios' : 'sem_suporte';
  if (estado.config && !estado.config.vapid_publica) return 'sem_chave';
  if (Notification.permission === 'denied') return 'negado';
  if (Notification.permission === 'default') return 'pendente';
  try { const reg = await navigator.serviceWorker.getRegistration('/'); return (await reg?.pushManager.getSubscription()) ? 'ok' : 'pendente'; }
  catch { return 'pendente'; }
}
const TOAST_AVISO = {
  ok: 'Pronto! Vamos te avisar.',
  negado: 'Voo salvo, mas as notificações estão bloqueadas neste navegador.',
  pendente: 'Voo salvo. Ligue as notificações para receber os avisos.',
  ios: 'Voo salvo. No iPhone, adicione o Voa Aí à Tela de Início para receber os avisos.',
  sem_suporte: 'Voo salvo. Este navegador não recebe notificações; abra o voo por aqui para conferir.',
  sem_chave: 'Voo salvo. Os avisos no celular ainda não estão ligados neste servidor.',
  falhou: 'Voo salvo, mas não deu para ligar os avisos. Tente de novo na tela do voo.',
};

/** "Me avisar": inscreve, pede a permissão e liga o push. */
async function meAvisar(voo, apelido, botao, erroEl) {
  esconderErro(erroEl);
  const id = voo.fa_flight_id;
  if (inscricaoDe(id)) { avisar('Você já acompanha este voo.'); location.hash = `status/${encodeURIComponent(id)}`; return; }
  ocupado(botao, true);
  // Pede a permissão ainda no toque: o navegador só mostra o pedido logo depois de um gesto do usuário.
  if (suportaPush() && estado.config?.vapid_publica && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  try {
    const r = await post('/api/inscricoes', { fa_flight_id: id, apelido: apelido || null, push: null });
    if (r?.voo) estado.voos.set(id, r.voo);
    const resultado = await ligarAvisos(r.id).catch(() => 'falhou');
    await Promise.all([carregarEu(), carregarInscricoes()]);
    avisar(TOAST_AVISO[resultado] || TOAST_AVISO.ok, 5000);
    const destino = `#status/${encodeURIComponent(id)}`;
    if (location.hash === destino) telaStatus([id], { silencioso: true }); else location.hash = destino;
  } catch (e) {
    let html = esc(mensagemDe(e));
    if (e.erro === 'limite') html += ` <a href="#meus-voos">Ver meus voos</a>${!estado.eu?.conta ? ' ou <a href="#entrar">entre com Google</a> para acompanhar mais' : ''}.`;
    mostrarErro(erroEl, html);
  } finally { ocupado(botao, false); }
}

/* ============================================================ GLOBO (carregado sob demanda) */
let globo = null, carregandoGlobo = null, ultimaCena = null, cenaAplicada = null, modoCamera = 'livre';
function obterGlobo() {
  carregandoGlobo ??= import('/globo.js').then(m => (globo = m.criarGlobo({
    canvas: $('#globo'), camadaRotulos: $('#rotulos'), desktop, reduzir,
    aoArrastar: () => { if (ultimaCena?.foco) { modoCamera = 'livre'; marcarModo(); } },
  }))).catch(e => { console.warn('O globo não carregou; o painel funciona sem ele.', e); return null; });
  return carregandoGlobo;
}
const paraGlobo = (v, id = v.fa_flight_id) => ({ id, a: v.origem, b: v.destino, t: progresso(v), aeronave: v.aeronave,
  tipo: v.estado === 'cancelado' ? 'cancelado' : v.estado === 'desviado' ? 'opcao' : 'voo' });

/** cfg: { voos:[entrada], foco, destaque, enquadrar, girar, hud:[[dt,dd,un,chegada]], globoCelular, rotulos, manterCamera } */
async function cenaGlobo(cfg) {
  ultimaCena = cfg;
  const foco = !!cfg.foco;
  document.body.toggleAttribute('data-hud', !!cfg.hud);
  if (cfg.hud) preencherHud($('#hud'), cfg.hud);
  $$('.recolher').forEach(b => b.hidden = !foco);
  const precisa = desktop.matches || cfg.globoCelular;
  document.body.toggleAttribute('data-globo-celular', !!cfg.globoCelular && !!globo);
  if (!precisa) { document.body.removeAttribute('data-camera'); return; }
  const g = await obterGlobo();
  if (ultimaCena !== cfg) return;
  document.body.toggleAttribute('data-globo-celular', !!cfg.globoCelular && !!g);
  document.body.toggleAttribute('data-camera', foco && !!g);
  if (!g) return;
  g.definirVoos(cfg.voos || []);
  // atualização do mesmo voo: mantém a câmera onde a pessoa deixou
  const manter = !!cfg.manterCamera && !!cenaAplicada && cenaAplicada.foco === cfg.foco;
  modoCamera = g.mostrar({ ids: (cfg.voos || []).map(v => v.id), foco: cfg.foco, destaque: cfg.destaque, enquadrar: cfg.enquadrar,
    girar: cfg.girar, rotulos: cfg.rotulos, modo: manter ? modoCamera : 'aviao' }, { manterCamera: manter });
  cenaAplicada = cfg;
  marcarModo();
}
function preencherHud(el, itens) {
  el.innerHTML = itens.map(([dt, dd, un, chegada]) =>
    `<div class="${chegada ? 'hud__chegada' : ''}"><dt>${esc(dt)}</dt><dd class="num">${esc(dd)}${un ? ` <small>${esc(un)}</small>` : ''}</dd></div>`).join('');
}
function marcarModo() { $$('[data-cam]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cam === modoCamera)); }
$$('[data-cam]').forEach(b => b.addEventListener('click', () => { modoCamera = b.dataset.cam; marcarModo(); globo?.modo(modoCamera); }));
$$('[data-recolher]').forEach(b => b.addEventListener('click', () => {
  const recolher = b.dataset.recolher === 'sim';
  document.body.toggleAttribute('data-recolhido', recolher);
  globo?.ajustar();
  $(recolher ? '.mostrar-painel' : '.tela.ativa [data-recolher]')?.focus();
}));
desktop.addEventListener('change', () => { globo?.ajustar(); if (ultimaCena) cenaGlobo({ ...ultimaCena }); pintarDicaGlobo(); });

/** Globo das telas com vários voos (início, entrar, meus voos): todos os acompanhados. */
function voosAcompanhados() {
  return (estado.inscricoes || []).filter(i => temCoordenadas(i.voo));
}
function rotuloVooLista(i) {
  const v = i.voo, info = infoEstado(v), quem = i.apelido ? `${i.apelido}, ` : '';
  return { id: v.fa_flight_id, onde: 'aviao', html: placaMini(codigo(v), quem + info.curto, info.curtoTipo || 'direcao') };
}
function cenaLista(extra = {}) {
  const voos = [], rotulos = [];
  for (const { pernas } of agruparViagens(voosAcompanhados().map(i => ({ ...i, voo: estado.voos.get(i.voo.fa_flight_id) || i.voo })))) {
    if (pernas.length === 1) { voos.push(paraGlobo(pernas[0].voo)); rotulos.push(rotuloVooLista(pernas[0])); continue; }
    // viagem: todos os trechos no globo, um rótulo só, no trecho de agora
    const m = momentoDaViagem(pernas.map(p => p.voo)), atual = pernas[m.indice], info = infoEstado(atual.voo);
    voos.push(...globoDaViagem(pernas, m.indice));
    const quem = pernas.find(p => p.apelido)?.apelido;
    const txt = `${quem ? quem + ', ' : ''}${m.fase === 'conexao' ? 'em conexão' : info.curto} · ${m.indice + 1} de ${pernas.length}`;
    rotulos.push({ ...rotuloVooLista(atual), html: placaMini(codigo(atual.voo), txt, info.curtoTipo || 'direcao') });
  }
  return cenaGlobo({ voos, rotulos, ...extra });
}

/* ============================================================ DATAS */
let diaPintado = '';
function pintarDias() {
  const dias = diasDeBusca();
  if (dias[0].valor === diaPintado) return;
  diaPintado = dias[0].valor;
  $$('[data-dias]').forEach(el => {
    const nome = el.dataset.dias, marcado = $(`input[name="${nome}"]:checked`, el);
    const idx = marcado ? dias.findIndex(d => d.valor === marcado.value) : 0;
    el.innerHTML = dias.map((d, i) => `<label><input type="radio" name="${nome}" value="${d.valor}"${i === Math.max(0, idx) ? ' checked' : ''}><span><b>${d.nome}</b><small class="num">${d.curto}</small></span></label>`).join('');
  });
}
const dataEscolhida = nome => $(`input[name="${nome}"]:checked`)?.value || diasDeBusca()[0].valor;

/* ============================================================ INÍCIO */
const ident = $('#ident'), erroIdent = $('#ident-erro');
const limparIdent = s => s.toUpperCase().replace(/[\s-]/g, '');
$('#form-inicio').addEventListener('submit', async e => {
  e.preventDefault();
  const cod = limparIdent(ident.value), data = dataEscolhida('data');
  const falha = html => { mostrarErro(erroIdent, html); ident.setAttribute('aria-invalid', 'true'); ident.focus(); };
  if (!cod) return falha('Faltou o número do voo. Ele está no cartão de embarque, com as letras da companhia na frente.');
  if (!/^[A-Z0-9]{3,8}$/.test(cod) || !/\d/.test(cod)) return falha('Confira o número: são as letras da companhia e depois os números, como TP103 ou LA3054.');
  if (aeroapiDesligada()) return falha(MSG_SEM_AEROAPI);
  const botao = $('#acompanhar'); ocupado(botao, true);
  try {
    const r = await get(`/api/voos/buscar?ident=${encodeURIComponent(cod)}&data=${data}`);
    const voos = r?.voos || [];
    if (!voos.length) return falha(`Não achamos o voo ${esc(cod)} ${nomeDoDia(data)}. Confira o número e a data no cartão de embarque.`);
    voos.forEach(v => estado.voos.set(v.fa_flight_id, v));
    estado.busca = { chave: `${cod}|${data}`, voos, escolhido: voos[0].fa_flight_id };
    location.hash = `confirmacao/${encodeURIComponent(cod)}/${data}`;
  } catch (err) { falha(esc(mensagemDe(err))); }
  finally { ocupado(botao, false); }
});
ident.addEventListener('input', () => { esconderErro(erroIdent); ident.removeAttribute('aria-invalid'); });

function telaInicio() { cenaLista({ girar: true }); }

/* ============================================================ CONFIRMAÇÃO */
const apelido = $('#apelido'), previa = $('#previa-texto');
let confVoos = [];
const vooEscolhido = () => confVoos.find(v => v.fa_flight_id === $('input[name="voo"]:checked')?.value) || confVoos[0];
function pintarPrevia() {
  const v = vooEscolhido(); if (!v) return;
  const n = apelido.value.trim();
  previa.textContent = `🛫 O voo ${n ? 'de ' + n : codigo(v)} decolou de ${cidade(v.origem)}. Chegada prevista às ${hora(chegadaDe(v), fusoDe(v))}`;
}
apelido.addEventListener('input', pintarPrevia);

function cartaoVoo(v, marcado) {
  const f = fusoDe(v), sai = saidaDe(v), chega = chegadaDe(v);
  const maisDia = diaISO(chega, f) && diaISO(sai, f) && diaISO(chega, f) !== diaISO(sai, f) ? ' <small>+1 dia</small>' : '';
  const cia = [v.companhia, v.aeronave].filter(Boolean).join(', ');
  return `<label class="cartao-voo">
    <input type="radio" name="voo" value="${esc(v.fa_flight_id)}"${marcado ? ' checked' : ''}>
    <span class="cartao-voo__corpo">
      <span class="cartao-voo__cia"><span>${esc(cia || codigo(v))}</span><span class="cartao-voo__marca" aria-hidden="true"></span></span>
      <span class="ponta"><span class="ponta__codigo">${esc(v.origem?.iata || '')}</span><span class="ponta__cidade">${esc(cidade(v.origem))}</span><span class="ponta__hora num">sai ${hora(sai, f)}</span></span>
      ${icone('i-aviao', ' class="cartao-voo__aviao"')}
      <span class="ponta ponta--fim"><span class="ponta__codigo">${esc(v.destino?.iata || '')}</span><span class="ponta__cidade">${esc(cidade(v.destino))}</span><span class="ponta__hora num">chega ${hora(chega, f)}${maisDia}</span></span>
    </span>
  </label>`;
}
function cenaConfirmacao() {
  const sel = vooEscolhido()?.fa_flight_id, comMapa = confVoos.filter(temCoordenadas);
  cenaGlobo({
    voos: comMapa.map(v => paraGlobo(v)), destaque: comMapa.length > 1 ? sel : null, enquadrar: sel ? [sel] : null,
    rotulos: comMapa.map(v => ({ id: v.fa_flight_id, onde: 'aviao', html: placaMini(codigo(v), `${nomeCurto(v.origem)} a ${nomeCurto(v.destino)}`) })),
  });
}
/** Viagem com escala escolhida na busca por rota: mostra as duas pernas e acompanha as duas. */
let confViagem = null;
function cartaoTrecho(v, n) {
  const f = fusoDe(v), sai = saidaDe(v), chega = chegadaDe(v);
  const maisDia = diaISO(chega, f) && diaISO(sai, f) && diaISO(chega, f) !== diaISO(sai, f) ? ' <small>+1 dia</small>' : '';
  const cia = [`Trecho ${n}`, codigo(v), v.companhia, v.aeronave].filter(Boolean).join(' · ');
  return `<li class="cartao-voo cartao-voo--trecho"><span class="cartao-voo__corpo">
      <span class="cartao-voo__cia"><span>${esc(cia)}</span></span>
      <span class="ponta"><span class="ponta__codigo">${esc(v.origem?.iata || '')}</span><span class="ponta__cidade">${esc(cidade(v.origem))}</span><span class="ponta__hora num">sai ${hora(sai, f)}</span></span>
      ${icone('i-aviao', ' class="cartao-voo__aviao"')}
      <span class="ponta ponta--fim"><span class="ponta__codigo">${esc(v.destino?.iata || '')}</span><span class="ponta__cidade">${esc(cidade(v.destino))}</span><span class="ponta__hora num">chega ${hora(chega, f)}${maisDia}</span></span>
    </span></li>`;
}
function modoConfirmacao(viagem) {
  const t = $('#t-conf'); t.textContent = viagem ? t.dataset.viagem : t.dataset.um;
  $('#me-avisar span').textContent = viagem ? `Me avisar dos ${viagem.length} voos` : 'Me avisar';
}
function telaConfirmacaoViagem(cods, data) {
  const est = $('#conf-estado'), escolha = $('#conf-escolha'), b = estado.buscaViagem;
  const ok = b && b.data === data && b.pernas.map(v => limparIdent(codigo(v))).join('+') === cods.join('+');
  if (!ok) {
    escolha.hidden = true; $('#conf-apoio').textContent = ''; confViagem = null; modoConfirmacao(null);
    est.innerHTML = vazio({ titulo: 'Busque a viagem de novo', texto: 'As viagens com escala vêm da busca por rota. Faça a busca de novo e toque na viagem.',
      acao: '<a class="botao" href="#rota">Buscar pela rota</a>' });
    cenaGlobo({ voos: [] });
    return;
  }
  const pernas = b.pernas; confViagem = pernas; confVoos = pernas; modoConfirmacao(pernas);
  est.innerHTML = ''; escolha.hidden = false;
  $('#conf-apoio').textContent = `Achamos a viagem ${pernas.map(codigo).join(' + ')} ${nomeDoDia(data)}, com escala em ${cidade(pernas[0].destino)}. Confira se é a de quem você espera.`;
  $('#conf-opcoes').innerHTML = `<ol class="viagem__pernas">${pernas.map((v, j) => (j ? conexaoHtml(pernas[j - 1], v) : '') + cartaoTrecho(v, j + 1)).join('')}</ol>`;
  $('#conf-fuso').textContent = 'Os horários de cada voo são da cidade onde ele chega.'
    + (desktop.matches && pernas.every(temCoordenadas) ? ' A viagem aparece no globo.' : '');
  pintarPrevia();
  const comMapa = pernas.filter(temCoordenadas);
  if (comMapa.length === pernas.length) {
    const ps = pernas.map(v => ({ voo: v })), voos = globoDaViagem(ps, 0), ult = pernas[pernas.length - 1];
    cenaGlobo({ voos, enquadrar: voos.map(x => x.id), rotulos: [
      { id: pernas[0].fa_flight_id, onde: 'a', classe: 'rotulo--aero', html: placaMini(pernas[0].origem.iata, '') },
      ...pernas.slice(0, -1).map(v => ({ id: v.fa_flight_id, onde: 'b', classe: 'rotulo--aero', html: placaMini(v.destino.iata, 'conexão') })),
      { id: ult.fa_flight_id, onde: 'b', html: placaMini(ult.destino.iata, nomeCurto(ult.destino)) },
    ] });
  }
}
/** Acompanha todas as pernas com o mesmo apelido e liga os avisos de cada uma; abre o 1º voo. */
async function seguirViagem(pernas, apelidoTxt, botao, erroEl) {
  esconderErro(erroEl);
  ocupado(botao, true);
  if (suportaPush() && estado.config?.vapid_publica && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  const criadas = [];
  try {
    for (const v of pernas) {
      if (inscricaoDe(v.fa_flight_id)) continue;
      const r = await post('/api/inscricoes', { fa_flight_id: v.fa_flight_id, apelido: apelidoTxt || null, push: null });
      if (r?.voo) estado.voos.set(v.fa_flight_id, r.voo);
      criadas.push(r.id);
    }
    let resultado = 'ok';
    for (const id of criadas) resultado = await ligarAvisos(id).catch(() => 'falhou');
    await Promise.all([carregarEu(), carregarInscricoes()]);
    avisar((TOAST_AVISO[resultado] || TOAST_AVISO.ok).replace('Voo salvo', 'Viagem salva'), 5000);
    location.hash = `#status/${encodeURIComponent(pernas[0].fa_flight_id)}`;
  } catch (e) {
    let html = esc(mensagemDe(e));
    if (criadas.length) html = `Só deu para salvar ${plural(criadas.length, 'voo', 'voos')} da viagem. ${html}`;
    if (e.erro === 'limite') html += ` <a href="#meus-voos">Ver meus voos</a>${!estado.eu?.conta ? ' ou <a href="#entrar">entre com Google</a> para acompanhar mais' : ''}.`;
    if (criadas.length) carregarInscricoes();
    mostrarErro(erroEl, html);
  } finally { ocupado(botao, false); }
}
async function telaConfirmacao([cod, data]) {
  cod = limparIdent(cod || ''); data = data || diasDeBusca()[0].valor;
  if (!cod) { location.replace('#inicio'); return; }
  const est = $('#conf-estado'), escolha = $('#conf-escolha');
  esconderErro($('#conf-erro'));
  if (cod.includes('+')) return telaConfirmacaoViagem(cod.split('+').filter(Boolean), data);
  confViagem = null; modoConfirmacao(null);
  let voos = estado.busca?.chave === `${cod}|${data}` ? estado.busca.voos : null;
  if (!voos) {
    escolha.hidden = true; $('#conf-apoio').textContent = `Procurando o voo ${cod} ${nomeDoDia(data)}…`;
    est.innerHTML = esqueleto(2); cenaGlobo({ voos: [] });
    if (aeroapiDesligada()) { est.innerHTML = vazio({ titulo: 'Busca de voos indisponível', texto: MSG_SEM_AEROAPI, erro: true, acao: '<a class="botao botao--secundario" href="#inicio">Voltar</a>' }); $('#conf-apoio').textContent = ''; return; }
    try {
      voos = (await get(`/api/voos/buscar?ident=${encodeURIComponent(cod)}&data=${data}`))?.voos || [];
      voos.forEach(v => estado.voos.set(v.fa_flight_id, v));
      estado.busca = { chave: `${cod}|${data}`, voos, escolhido: voos[0]?.fa_flight_id };
    } catch (e) {
      if (rotaAtual().nome !== 'confirmacao') return;
      $('#conf-apoio').textContent = '';
      est.innerHTML = vazio({ titulo: 'Não deu para buscar o voo', texto: esc(mensagemDe(e)), erro: true,
        acao: `<button class="botao botao--secundario" type="button" data-tentar>Tentar de novo</button>` });
      $('[data-tentar]', est)?.addEventListener('click', () => telaConfirmacao([cod, data]));
      return;
    }
    if (rotaAtual().nome !== 'confirmacao') return;
  }
  confVoos = voos;
  if (!voos.length) {
    escolha.hidden = true; $('#conf-apoio').textContent = '';
    est.innerHTML = vazio({ titulo: `Não achamos o voo ${esc(cod)} ${nomeDoDia(data)}`, texto: 'Confira o número e a data no cartão de embarque ou na mensagem da companhia. Se não souber o número, dá para buscar pela rota.',
      acao: '<a class="botao" href="#inicio">Digitar de novo</a><a class="botao botao--secundario" href="#rota">Buscar pela rota</a>' });
    return;
  }
  est.innerHTML = ''; escolha.hidden = false;
  $('#conf-apoio').textContent = voos.length === 1
    ? `Achamos o voo ${cod} ${nomeDoDia(data)}. Confira se é o de quem você espera.`
    : `Achamos ${voos.length} voos ${cod} ${nomeDoDia(data)}. Escolha o de quem você espera.`;
  const escolhido = voos.some(v => v.fa_flight_id === estado.busca?.escolhido) ? estado.busca.escolhido : voos[0].fa_flight_id;
  $('#conf-opcoes').innerHTML = voos.map(v => cartaoVoo(v, v.fa_flight_id === escolhido)).join('');
  const cidades = [...new Set(voos.map(v => cidade(v.destino)))];
  $('#conf-fuso').textContent = (cidades.length === 1 ? `Horários de ${cidades[0]}, onde o voo chega.` : 'Horários da cidade onde cada voo chega.')
    + (desktop.matches && voos.some(temCoordenadas) ? ' A rota escolhida aparece acesa no globo.' : '');
  $$('input[name="voo"]').forEach(r => r.addEventListener('change', () => { estado.busca.escolhido = r.value; pintarPrevia(); cenaConfirmacao(); }));
  pintarPrevia(); cenaConfirmacao();
}
$('#me-avisar').addEventListener('click', e => {
  if (confViagem) return seguirViagem(confViagem, apelido.value.trim(), e.currentTarget, $('#conf-erro'));
  const v = vooEscolhido(); if (v) meAvisar(v, apelido.value.trim(), e.currentTarget, $('#conf-erro'));
});

/* ============================================================ STATUS */
let timerStatus = null, timerAviao = null, statusId = null;
function pararAtualizacao() { clearInterval(timerStatus); timerStatus = null; }
function marcoHora(real, est, prev, f) {
  const hr = iso => hora(iso, f);
  if (real) { const d = minutosEntre(prev, real); return `${hr(real)}${prev && Math.abs(d) >= 1 ? `<small>previsto ${hr(prev)}</small>` : ''}`; }
  const d = minutosEntre(prev, est);
  if (prev && est && d >= 15) return `<span class="atrasou">${hr(est)}</span><small class="riscado"><span class="sr">antes </span>${hr(prev)}</small>`;
  if (prev && est && Math.abs(d) >= 1) return `${hr(est)}<small>previsto ${hr(prev)}</small>`;
  return hr(est || prev);
}
function linhaDoTempo(v) {
  const f = fusoDe(v), x = h(v);
  const passos = [
    { feito: !!x.saida_real, nome: x.saida_real ? 'Saiu do portão' : 'Sai do portão', hora: marcoHora(x.saida_real, x.saida_estimada, x.saida_prevista, f) },
    { feito: !!x.decolagem_real, nome: x.decolagem_real ? 'Decolou' : 'Decola', hora: x.decolagem_real ? hora(x.decolagem_real, f) : '' },
    { feito: !!x.pouso_real, nome: x.pouso_real ? 'Pousou' : 'Pousa', hora: marcoHora(x.pouso_real, x.pouso_estimado, x.pouso_previsto, f), chegada: true },
    { feito: !!x.chegada_real, nome: x.chegada_real ? 'Chegou ao portão' : 'Chega ao portão', hora: marcoHora(x.chegada_real, x.chegada_estimada, x.chegada_prevista, f) },
  ];
  if (v.estado === 'em_voo') { passos[0].feito = true; passos[1].feito = true; if (!passos[1].hora) passos[1].nome = 'Decolou'; }
  if (v.estado === 'pousou' || v.estado === 'no_portao_destino') passos.slice(0, 3).forEach(p => p.feito = true);
  const agora = {
    previsto: { nome: 'Ainda no solo', nota: '' },
    no_portao: { nome: x.saida_real ? 'Indo para a pista' : 'No portão', nota: '' },
    atrasado: { nome: x.saida_real ? 'Indo para a pista' : 'No portão', nota: atrasoSaida(v) ? `A companhia adiou a saída em ${duracao(atrasoSaida(v))}` : 'A companhia mudou o horário de saída', classe: 'atrasou' },
    em_voo: { nome: 'Em voo', nota: 'Posição estimada pelos horários da companhia' },
    pousou: { nome: 'Indo para o portão', nota: '' },
  }[v.estado];
  const itens = passos.map(p => ({ ...p, tipo: p.feito ? 'feito' : 'previsto' }));
  if (agora) {
    const idx = itens.findIndex(p => !p.feito);
    itens.splice(idx < 0 ? itens.length : idx, 0, { ...agora, tipo: 'agora', hora: 'agora' });
  }
  return `<section aria-labelledby="t-linha"><h2 id="t-linha" class="sr">Etapas do voo</h2><ol class="linha-tempo">${itens.map(p => {
    const cls = [p.tipo, p.chegada && p.tipo === 'previsto' ? 'chegada' : ''].filter(Boolean).join(' ');
    const marco = p.tipo === 'feito' ? icone('i-check') : p.tipo === 'agora' ? icone('i-aviao') : '';
    return `<li class="${cls}"${p.tipo === 'agora' ? ' aria-current="step"' : ''}><span class="marco">${marco}</span>
      <span class="marco__nome">${p.nome}</span><span class="marco__hora num">${p.hora || ''}</span>${p.nota ? `<span class="marco__nota${p.classe ? ' ' + p.classe : ''}">${esc(p.nota)}</span>` : ''}</li>`;
  }).join('')}</ol></section>`;
}
function trajeto(v) {
  const t = progresso(v), f = fusoDe(v), o = nomeCurto(v.origem), d = nomeCurto(v.destino);
  let aria, resto = '';
  if (v.estado === 'cancelado') aria = `De ${o} a ${d}. Voo cancelado, o avião não saiu.`;
  else if (v.estado === 'desviado') { aria = `De ${o} a ${d}. O voo foi desviado e não vai pousar em ${d}.`; resto = `Desviado: não vai pousar em ${d}`; }
  else if (v.estado === 'em_voo') {
    const falta = faltaMin(v);
    aria = `De ${o} a ${d}. Pelo horário, o avião já fez cerca de ${Math.round(t * 100)}% do caminho; faltam ${duracao(falta)}.`;
    resto = `Faltam ${duracao(falta)} de voo`;
  } else if (noSolo(v)) {
    const nova = v.estado === 'atrasado';
    aria = `De ${o} a ${d}. O avião ainda está no solo em ${o}.`;
    resto = `Ainda no solo. ${nova ? 'Nova saída' : 'Saída'} às ${hora(h(v).saida_estimada || saidaDe(v), f)}`;
  } else { aria = `De ${o} a ${d}. O avião já pousou em ${d}.`; resto = `Pousou às ${hora(h(v).pouso_real || pousoDe(v), f)}`; }
  return `<div class="trajeto" role="img" aria-label="${esc(aria)}">
    <span class="ponta"><span class="ponta__codigo">${esc(v.origem?.iata || '')}</span><span class="ponta__cidade">${esc(o)}</span></span>
    <span class="trajeto__barra" style="--t:${t.toFixed(3)}"${v.estado === 'cancelado' ? ' data-cancelado' : ''}><i></i></span>
    <span class="ponta ponta--fim"><span class="ponta__codigo">${esc(v.destino?.iata || '')}</span><span class="ponta__cidade">${esc(d)}</span></span>
  </div>${resto ? `<p class="trajeto__resto num">${esc(resto)}</p>` : ''}`;
}
function hudDe(v) {
  const f = fusoDe(v), dest = v.destino?.iata || '';
  if (v.estado === 'em_voo') return [['Falta', duracao(faltaMin(v), true)], [`Chega em ${dest}`, hora(pousoDe(v), f), '', true], ['Posição', 'estimada']];
  if (noSolo(v)) return [['Onde está', v.estado === 'no_portao' || v.estado === 'atrasado' ? 'No solo' : 'Ainda no solo'],
    [v.estado === 'atrasado' ? 'Nova saída' : 'Saída', hora(h(v).saida_estimada || saidaDe(v), f)], [`Chega em ${dest}`, hora(pousoDe(v), f), '', true]];
  return null;
}
function tituloStatus(v, insc) { return insc?.apelido ? insc.apelido : `Voo ${codigo(v)}`; }

function pintarCabecaStatus(v, insc) {
  pintar($('#st-cabeca'), `<div class="quem"><h1 id="t-status" tabindex="-1">${esc(tituloStatus(v, insc))}</h1><small>${esc(v.companhia || '')}</small></div>${placa(v)}`);
}
function pintarCorpoStatus(v, insc) {
  const f = fusoDe(v), hud = hudDe(v), globoCelular = ['em_voo', 'atrasado'].includes(v.estado) && temCoordenadas(v);
  const atualizado = v.atualizado_em ? ` Atualizado às ${hora(v.atualizado_em, f)}.` : '';
  let html = trajeto(v);
  const viagem = viagemDe(v.fa_flight_id);
  if (viagem) html += secaoViagem(viagem, v.fa_flight_id);
  if (hud && globoCelular) html += `<dl class="hud hud-celular" aria-label="Dados do voo">${hud.map(([dt, dd, un, c]) => `<div class="${c ? 'hud__chegada' : ''}"><dt>${esc(dt)}</dt><dd class="num">${esc(dd)}${un ? ` <small>${esc(un)}</small>` : ''}</dd></div>`).join('')}</dl>`;
  if (v.estado === 'cancelado') {
    const quem = insc?.apelido ? `para ${insc.apelido}` : 'para quem viaja';
    html += `<div class="nota-aviso" style="flex-direction:column;gap:var(--e-2)"><h2 style="font-size:var(--fs-p)">E agora?</h2>
      <p>${esc(v.companhia ? `A ${v.companhia}` : 'A companhia')} costuma remarcar quem estava no voo. Pergunte ${esc(quem)} qual é o novo voo e acompanhe por aqui.</p></div>`;
    html += `<p class="fuso">Saída prevista às ${hora(h(v).saida_prevista || saidaDe(v), f)}, horário de ${esc(cidade(v.destino))}.${atualizado}</p>`;
  } else {
    html += linhaDoTempo(v);
    if (v.estado === 'desviado') html += `<div class="nota-aviso" style="flex-direction:column;gap:var(--e-2)"><h2 style="font-size:var(--fs-p)">E agora?</h2>
      <p>O voo foi desviado para outro aeroporto e não vai pousar em ${esc(nomeCurto(v.destino))}. Confira com a companhia ou com quem viaja onde ele vai descer.</p></div>`;
    html += `<p class="fuso">Horários de ${esc(cidade(v.destino))}.${atualizado}</p>`;
  }
  pintar($('#st-corpo'), html);
  return { hud, globoCelular };
}
async function pintarAvisosStatus(v, insc) {
  const el = $('#st-avisos');
  if (!insc) {
    if (terminou(v)) return pintar(el, '');
    // voo aberto por link (/v/…) ou ainda não acompanhado: oferecer "Me avisar"
    pintar(el, `<section class="assinar" aria-labelledby="t-assinar">
      <h2 id="t-assinar">Quer receber os avisos deste voo?</h2>
      <div class="campo"><label for="apelido-st">Como chamar quem vem? <span class="apoio" style="font-weight:400">(opcional)</span></label>
        <input id="apelido-st" type="text" placeholder="Mãe, Ana, Vô Zé…" maxlength="24" autocomplete="off"></div>
      <div class="aviso-ios" data-so-ios hidden><h2>No iPhone, falta um passo</h2><p>Os avisos só chegam com o Voa Aí na Tela de Início:</p>
        <ol><li>Toque em <b>Compartilhar</b> no Safari.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Abra o Voa Aí por lá e toque em <b>Me avisar</b>.</li></ol></div>
      <p id="st-erro" class="erro" role="alert" hidden>${icone('i-alerta')}<span></span></p>
      <button class="botao" type="button" id="st-avisar">${icone('i-sino')}Me avisar</button>
      <p class="dica" style="text-align:center">O celular vai pedir permissão para mostrar notificações.</p>
    </section>`);
    mostrarCaixasIOS();
    $('#st-avisar').onclick = e => meAvisar(v, $('#apelido-st').value.trim(), e.currentTarget, $('#st-erro'));
    return;
  }
  if (terminou(v)) return pintar(el, '');
  const s = await situacaoAvisos();
  if (statusId !== v.fa_flight_id) return;
  const base = v.estado === 'atrasado'
    ? 'Se o horário mudar de novo, você recebe outro aviso. Não precisa ficar conferindo.'
    : v.estado === 'em_voo' ? 'Vamos te avisar quando estiver chegando, a hora de sair para o aeroporto, e quando pousar.'
    : 'Vamos te avisar quando decolar, se atrasar, quando estiver chegando e quando pousar.';
  let html;
  if (s === 'ok') html = `<p class="nota-aviso">${icone('i-sino')}<span>${base}</span></p>`;
  else if (s === 'negado') html = `<div class="nota-aviso nota-aviso--bloqueado" role="note">${icone('i-sino-off')}<span class="nota-aviso__texto">
      <span class="nota-aviso__titulo">Os avisos estão bloqueados</span>
      <span>O navegador não deixa o Voa Aí mostrar notificações. O voo continua salvo e você pode conferir por aqui.</span>
      <span class="dica">Para receber os avisos, libere as notificações nas configurações do site (no cadeado ao lado do endereço) e toque em Tentar de novo.</span>
      <button class="botao botao--secundario" type="button" data-ligar>Tentar de novo</button></span></div>`;
  else if (s === 'ios') html = `<div class="aviso-ios"><h2>No iPhone, falta um passo</h2><p>Os avisos só chegam com o Voa Aí na Tela de Início:</p>
      <ol><li>Toque em <b>Compartilhar</b> no Safari.</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Abra o Voa Aí por lá e toque em <b>Ligar avisos</b>.</li></ol></div>`;
  else if (s === 'sem_chave') html = `<p class="nota-aviso">${icone('i-sino')}<span>O voo está salvo em Meus voos. Os avisos no celular ainda não estão ligados neste servidor; por enquanto, confira por aqui.</span></p>`;
  else if (s === 'sem_suporte') html = `<div class="nota-aviso nota-aviso--bloqueado" role="note">${icone('i-sino-off')}<span class="nota-aviso__texto">
      <span class="nota-aviso__titulo">Este navegador não recebe avisos</span><span>O voo está salvo. Abra o Voa Aí no Chrome, no Edge ou no Safari do iPhone para receber as notificações.</span></span></div>`;
  else html = `<div class="nota-aviso nota-aviso--desligado" role="note">${icone('i-sino')}<span class="nota-aviso__texto">
      <span class="nota-aviso__titulo">Os avisos ainda estão desligados</span><span>Ligue as notificações para saber quando decolar, atrasar e pousar.</span>
      <button class="botao" type="button" data-ligar>${icone('i-sino')}Ligar avisos</button></span></div>`;
  pintar(el, html);
  const ligar = $('[data-ligar]', el);
  if (ligar) ligar.onclick = async () => {
    ocupado(ligar, true);
    const r = await ligarAvisos(insc.id).catch(() => 'falhou');
    ocupado(ligar, false);
    avisar(r === 'ok' ? 'Pronto! Vamos te avisar.' : r === 'negado' ? 'As notificações continuam bloqueadas neste navegador.' : TOAST_AVISO[r] || TOAST_AVISO.falhou, 5000);
    pintarAvisosStatus(v, insc);
  };
}
function secaoViagem({ pernas }, id) {
  const i = pernas.findIndex(p => p.voo.fa_flight_id === id), destino = pernas[pernas.length - 1].voo.destino;
  const linhas = pernas.map((p, j) => {
    const v = p.voo, aqui = j === i;
    const corpo = `<span class="viagem__n num" aria-hidden="true">${j + 1}</span><span class="viagem__txt"><b class="num">${esc(codigo(v))}</b> ${esc(nomeCurto(v.origem))} a ${esc(nomeCurto(v.destino))}</span>${placaMiniVoo(v)}`;
    return (j ? conexaoHtml(pernas[j - 1].voo, v) : '') + (aqui
      ? `<li class="viagem__linha" aria-current="true">${corpo}<span class="sr">, este voo</span></li>`
      : `<li class="viagem__linha"><a href="#status/${encodeURIComponent(v.fa_flight_id)}">${corpo}</a></li>`);
  }).join('');
  return `<section class="viagem-status" aria-labelledby="t-viagem"><h2 id="t-viagem">Viagem até ${esc(cidade(destino))} · trecho ${i + 1} de ${pernas.length}</h2>
    <ol class="viagem__pernas">${linhas}</ol></section>`;
}
/** "Tem conexão em Dubai?": num voo acompanhado que ainda não faz parte de uma viagem, dá para
 *  digitar o número do próximo voo; ele entra em Meus voos com o mesmo apelido e os dois viram uma viagem. */
function pintarConexaoStatus(v, insc) {
  const el = $('#st-conexao');
  const mostrar = insc && !['cancelado', 'desviado'].includes(v.estado) && temCoordenadas(v) && !viagemDe(v.fa_flight_id);
  const chave = mostrar ? `${v.fa_flight_id}|${v.destino.iata}` : '';
  if (el.dataset.chave === chave) return;      // não repinta (não apaga o que a pessoa está digitando)
  el.dataset.chave = chave;
  if (!mostrar) { el.innerHTML = ''; return; }
  const onde = cidade(v.destino);
  el.innerHTML = `<details class="conexao-add">
    <summary>${icone('i-conexao')}<span>Tem conexão em ${esc(onde)}?</span></summary>
    <form class="conexao-add__form" novalidate>
      <p class="dica">Digite o número do próximo voo. Os dois viram uma viagem em Meus voos, e a gente avisa se a troca de avião ficar apertada.</p>
      <div class="campo"><label for="conexao-num">Número do próximo voo</label>
        <input id="conexao-num" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="8" placeholder="Ex.: EK318"></div>
      <p id="conexao-erro" class="erro" role="alert" hidden>${icone('i-alerta')}<span></span></p>
      <button class="botao botao--secundario" type="submit">${icone('i-conexao')}Acompanhar a conexão</button>
    </form>
  </details>`;
  const form = $('form', el);
  form.onsubmit = e => { e.preventDefault(); adicionarConexao(v, insc, $('#conexao-num').value, $('button', form), $('#conexao-erro')); };
}
/** Acha o próximo voo pelo número: o primeiro que sai do aeroporto onde este chega, até 24 h depois da chegada
 *  (se nenhum sair depois, aceita um que sai até 3 h antes: este voo pode estar atrasado). */
async function adicionarConexao(v, insc, digitado, botao, erroEl) {
  esconderErro(erroEl);
  const cod = limparIdent(digitado || '');
  if (!/^[A-Z0-9]{3,8}$/.test(cod)) return mostrarErro(erroEl, 'Digite o número do voo, como EK318.');
  const chega = chegadaDe(v), fuso = v.destino?.fuso, onde = cidade(v.destino);
  const dias = [...new Set([diaISO(chega, fuso), diaISO(new Date(Date.parse(chega) + 864e5).toISOString(), fuso)])];
  ocupado(botao, true);
  try {
    let achado = null;
    for (const dia of dias) {
      let voos = [];
      try { voos = (await get(`/api/voos/buscar?ident=${encodeURIComponent(cod)}&data=${dia}`))?.voos || []; }
      catch (e) { if (dia === dias[0] || e.erro !== 'invalido') throw e; }      // o dia seguinte pode estar fora da janela de busca
      achado = voos.filter(c => c.origem?.iata === v.destino?.iata && c.fa_flight_id !== v.fa_flight_id)
        .map(c => ({ c, esc: minutosEntre(chega, saidaDe(c)) }))
        .filter(x => x.esc !== null && x.esc >= -180 && x.esc <= 24 * 60)
        // o primeiro que sai depois da chegada; só se não houver, o que sai pouco antes (voo atrasado)
        .sort((a, b) => (a.esc < 0) - (b.esc < 0) || (a.esc < 0 ? b.esc - a.esc : a.esc - b.esc))[0]?.c || null;
      if (achado) break;
    }
    if (!achado) return mostrarErro(erroEl, `Não achei o ${esc(cod)} saindo de ${esc(onde)} até 24 h depois deste voo. Confira o número.`);
    ocupado(botao, false);
    await meAvisar(achado, insc.apelido, botao, erroEl);
  } catch (e) {
    mostrarErro(erroEl, esc(mensagemDe(e)));
  } finally { ocupado(botao, false); }
}
function pintarAcoesStatus(v, insc) {
  const chave = `${v.fa_flight_id}|${insc?.id || ''}|${v.estado === 'cancelado'}`;
  const el = $('#st-acoes');
  if (el.dataset.chave === chave) return;
  el.dataset.chave = chave;
  const compartilhar = `<button class="botao botao--secundario" type="button" data-compartilhar>${icone('i-share')}Compartilhar voo</button>`;
  el.innerHTML = v.estado === 'cancelado'
    ? `<div class="acoes"><a class="botao" href="#inicio">${icone('i-mais')}Acompanhar o novo voo</a>${insc ? '<button class="botao botao--texto" type="button" data-parar>Tirar da lista</button>' : ''}</div>`
    : `<div class="acoes">${compartilhar}${insc ? '<button class="botao botao--texto botao--perigo" type="button" data-parar>Parar de acompanhar</button>' : ''}</div>`;
  $('[data-compartilhar]', el)?.addEventListener('click', () => compartilhar_(v));
  $('[data-parar]', el)?.addEventListener('click', () => pararDeAcompanhar(insc, v));
}
function cenaStatus(v, { hud, globoCelular }, manterCamera) {
  if (!temCoordenadas(v)) return cenaGlobo({ voos: [], hud: null });
  const f = fusoDe(v), entrada = paraGlobo(v);
  const destino = v.estado === 'cancelado' ? placaMini(v.destino.iata, 'Cancelado', 'critico')
    : v.estado === 'desviado' ? placaMini(v.destino.iata, 'Desviado', 'desvio')
    : terminou(v) ? placaMini(v.destino.iata, `pousou ${hora(h(v).pouso_real || pousoDe(v), f)}`, 'pousou')
    : placaMini(v.destino.iata, `chega ${hora(pousoDe(v), f)}`);
  const comFoco = !['cancelado', 'desviado'].includes(v.estado);
  const viagem = viagemDe(v.fa_flight_id);
  if (viagem) {
    // viagem com conexão: todos os trechos, este em destaque; rótulos na origem, nas escalas e no destino final
    const { pernas } = viagem, i = pernas.findIndex(p => p.voo.fa_flight_id === v.fa_flight_id), ult = pernas[pernas.length - 1].voo;
    const voos = globoDaViagem(pernas, i), ids = voos.map(x => x.id), tem = id => ids.includes(id);
    const rotulos = [];
    const p0 = pernas[0].voo;
    if (tem(p0.fa_flight_id)) rotulos.push({ id: p0.fa_flight_id, onde: 'a', classe: 'rotulo--aero', html: placaMini(p0.origem.iata, '') });
    pernas.slice(0, -1).forEach(p => { if (tem(p.voo.fa_flight_id)) rotulos.push({ id: p.voo.fa_flight_id, onde: 'b', classe: 'rotulo--aero', html: placaMini(p.voo.destino.iata, 'conexão') }); });
    if (tem(ult.fa_flight_id)) rotulos.push({ id: ult.fa_flight_id, onde: 'b', html: ult.fa_flight_id === v.fa_flight_id ? destino : placaMini(ult.destino.iata, `chega ${hora(pousoDe(ult), fusoDe(ult))}`) });
    return cenaGlobo({ voos, foco: comFoco ? v.fa_flight_id : null, destaque: v.fa_flight_id, enquadrar: ids, hud: comFoco ? hud : null, globoCelular, manterCamera, rotulos });
  }
  return cenaGlobo({
    voos: [entrada], foco: comFoco ? v.fa_flight_id : null, enquadrar: [v.fa_flight_id], hud: comFoco ? hud : null, globoCelular, manterCamera,
    rotulos: [{ id: v.fa_flight_id, onde: 'a', classe: 'rotulo--aero', html: placaMini(v.origem.iata, '') }, { id: v.fa_flight_id, onde: 'b', html: destino }],
  });
}
let focarAoPintar = false;
async function telaStatus([id], { silencioso = false } = {}) {
  if (!id) { location.replace('#meus-voos'); return; }
  const novo = statusId !== id; statusId = id;
  if (novo) { $('#st-acoes').dataset.chave = ''; $('#st-conexao').dataset.chave = ''; pintar($('#st-avisos'), ''); }
  const conhecido = estado.voos.get(id);
  const desenhar = (v, manterCamera) => {
    const insc = inscricaoDe(id);
    pintarCabecaStatus(v, insc);
    const info = pintarCorpoStatus(v, insc);
    pintarAvisosStatus(v, insc);
    pintarAcoesStatus(v, insc);
    pintarConexaoStatus(v, insc);
    cenaStatus(v, info, manterCamera);
    if (focarAoPintar) { focarAoPintar = false; $('#t-status')?.focus({ preventScroll: true }); }
  };
  if (conhecido) desenhar(conhecido, !novo);
  else if (!silencioso) {
    pintar($('#st-cabeca'), `<div class="quem"><h1 id="t-status" tabindex="-1">Carregando o voo…</h1></div>`);
    pintar($('#st-corpo'), esqueleto(3)); cenaGlobo({ voos: [] });
  }
  if (!estado.inscricoes) carregarInscricoes().then(() => { if (statusId === id && estado.voos.get(id)) desenhar(estado.voos.get(id), true); });
  try {
    const v = await get(`/api/voos/${encodeURIComponent(id)}`);
    if (statusId !== id || rotaAtual().nome !== 'status') return;
    estado.voos.set(id, v);
    desenhar(v, !!conhecido);
  } catch (e) {
    if (statusId !== id || rotaAtual().nome !== 'status') return;
    if (conhecido) { if (!silencioso) avisar(mensagemDe(e)); return; }   // mantém o último dado na tela
    const naoExiste = e.erro === 'nao_encontrado';
    pintar($('#st-cabeca'), `<div class="quem"><h1 id="t-status" tabindex="-1">${naoExiste ? 'Voo não encontrado' : 'Não deu para abrir o voo'}</h1></div>`);
    pintar($('#st-corpo'), vazio({ erro: !naoExiste,
      titulo: naoExiste ? 'Esse voo não está mais aqui' : e.erro === 'aeroapi_sem_chave' ? 'Busca de voos indisponível' : e.erro === 'teto_duro' ? 'Busca de voos pausada' : 'Algo deu errado',
      texto: naoExiste ? 'O link pode estar errado, ou o voo já foi apagado: os dados somem 7 dias depois do pouso.' : esc(mensagemDe(e)),
      acao: `<a class="botao" href="#inicio">${icone('i-mais')}Acompanhar um voo</a>` }));
    $('#st-acoes').innerHTML = ''; $('#st-acoes').dataset.chave = ''; $('#st-conexao').innerHTML = ''; $('#st-conexao').dataset.chave = '';
    cenaGlobo({ voos: [] });
    if (focarAoPintar) { focarAoPintar = false; $('#t-status')?.focus({ preventScroll: true }); }
    return;
  }
  if (!timerStatus) timerStatus = setInterval(() => {
    if (document.hidden || rotaAtual().nome !== 'status') return;
    telaStatus([statusId], { silencioso: true });
  }, ATUALIZAR_MS);
  // Entre uma consulta e outra, o avião segue andando no globo pela hora (o globo só refaz o desenho
  // quando a posição muda o bastante para aparecer).
  if (!timerAviao) timerAviao = setInterval(() => {
    if (document.hidden || rotaAtual().nome !== 'status' || !globo) return;
    const v = estado.voos.get(statusId);
    if (v?.estado !== 'em_voo' || !temCoordenadas(v)) return;
    const viagem = viagemDe(statusId);
    globo.definirVoos(viagem ? globoDaViagem(viagem.pernas, viagem.pernas.findIndex(p => p.voo.fa_flight_id === statusId)) : [paraGlobo(v)]);
  }, ANDAR_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && rotaAtual().nome === 'status' && statusId) telaStatus([statusId], { silencioso: true }); });

async function compartilhar_(v) {
  const url = `${location.origin}/v/${encodeURIComponent(v.fa_flight_id)}`, cod = codigo(v);
  const dados = { title: `Voo ${cod} · Voa Aí`, text: `Acompanhe o voo ${cod} comigo no Voa Aí`, url };
  if (navigator.share) { try { await navigator.share(dados); } catch {} return; }
  try { await navigator.clipboard.writeText(url); avisar('Link do voo copiado'); } catch { avisar(url, 8000); }
}
async function pararDeAcompanhar(insc, v) {
  if (!insc) return;
  const cod = codigo(v), cancelado = v.estado === 'cancelado';
  const ok = await confirmar(cancelado
    ? { titulo: `Tirar o ${insc.apelido ? `voo de ${insc.apelido}` : cod} da lista?`, texto: 'O voo some de Meus voos neste aparelho.', sim: 'Tirar da lista', nao: 'Manter na lista' }
    : { titulo: `Parar de acompanhar o ${insc.apelido ? `voo de ${insc.apelido}` : cod}?`, texto: `Você não vai mais receber avisos do ${cod}. Quem recebeu o link continua recebendo.`, sim: 'Parar avisos', nao: 'Continuar acompanhando' });
  if (!ok) return;
  try {
    await del(`/api/inscricoes/${encodeURIComponent(insc.id)}`);
    estado.inscricoes = (estado.inscricoes || []).filter(i => i.id !== insc.id);
    await Promise.all([carregarEu(), carregarInscricoes()]);
    avisar(cancelado ? 'Voo tirado da lista' : 'Você não recebe mais avisos deste voo');
    if (rotaAtual().nome === 'meus-voos') telaMeusVoos(); else location.hash = 'meus-voos';
  } catch (e) { avisar(mensagemDe(e), 5000); }
}

/* ============================================================ MEUS VOOS */
const lista = $('#lista-voos');
function pintarDicaGlobo() { $('#dica-globo').hidden = !desktop.matches || !(estado.inscricoes?.length); }
function pintarMeusVoos() {
  const insc = estado.inscricoes, eu = estado.eu, est = $('#meus-estado');
  const n = eu?.uso?.voos ?? insc?.length ?? 0, lim = eu?.limites?.voos;
  $('#limite-voos').textContent = Number.isFinite(lim) ? `${n} de ${lim} voos ${eu?.conta ? 'na sua conta' : 'neste aparelho'}.` : '';
  pintarDicaGlobo();
  const outro = $('#outro-voo');
  if (!insc) {
    lista.innerHTML = '';
    est.innerHTML = estado.erroInscricoes
      ? vazio({ titulo: 'Não deu para carregar seus voos', texto: esc(mensagemDe(estado.erroInscricoes)), erro: true, acao: '<button class="botao botao--secundario" type="button" data-tentar>Tentar de novo</button>' })
      : `${esqueleto(1)}<p class="carregando-texto">Carregando seus voos…</p>`;
    $('[data-tentar]', est)?.addEventListener('click', () => telaMeusVoos());
    outro.hidden = true; return;
  }
  if (!insc.length) {
    lista.innerHTML = '';
    est.innerHTML = vazio({ titulo: 'Nenhum voo por aqui ainda', texto: 'Digite o número do voo de quem você espera. A gente avisa quando decolar, atrasar, estiver chegando e pousar.',
      acao: `<a class="botao" href="#inicio">${icone('i-mais')}Acompanhar um voo</a>` });
    outro.hidden = true; return;
  }
  const noLimite = Number.isFinite(lim) && n >= lim;
  const lConta = limiteComConta('voos');
  est.innerHTML = noLimite ? `<p class="nota-aviso">${icone('i-alerta')}<span>Você chegou ao limite de ${lim} voos ao mesmo tempo. Tire um voo da lista para acompanhar outro${!eu?.conta && lConta > lim ? `, ou <a href="#entrar">entre com Google</a> para acompanhar até ${lConta}` : ''}.</span></p>` : '';
  outro.hidden = noLimite;
  lista.innerHTML = agruparViagens(inscricoesAtuais()).map(({ pernas }) => {
    if (pernas.length === 1) return itemVooHtml(pernas[0]);
    const quem = pernas.find(p => p.apelido)?.apelido || 'Viagem';
    const rota = rotaDaViagem(pernas).map(a => a?.iata || '').join(' → ');
    const nomes = rotaDaViagem(pernas).map(cidade).join(', ');
    return `<li class="viagem" aria-label="${esc(`Viagem de ${quem}: ${nomes}`)}">
      <div class="viagem__cabeca"><span class="item-voo__nome">${esc(quem)}</span>
        <span class="viagem__rota num" aria-hidden="true">${esc(rota)}</span>
        <span class="viagem__agora">${esc(fraseDaViagem(pernas))}</span></div>
      <ol class="viagem__pernas">${pernas.map((p, j) => (j ? conexaoHtml(pernas[j - 1].voo, p.voo) : '') + itemVooHtml(p, { trecho: j + 1 })).join('')}</ol>
    </li>`;
  }).join('');
}
function itemVooHtml(i, { trecho } = {}) {
  const v = i.voo, quem = trecho ? `Trecho ${trecho} · ${codigo(v)}` : i.apelido || codigo(v), id = v.fa_flight_id;
  const rotulo = v.estado === 'cancelado' ? `Tirar o voo ${codigo(v)}${i.apelido ? ` de ${i.apelido}` : ''} da lista` : `Parar de acompanhar o voo ${codigo(v)}${i.apelido ? ` de ${i.apelido}` : ''}`;
  return `<li class="item-voo${trecho ? ' item-voo--trecho' : ''}" data-voo="${esc(id)}">
      <a class="item-voo__link" href="#status/${encodeURIComponent(id)}">
        <span class="item-voo__nome">${esc(quem)}</span>
        ${placaMiniVoo(v)}
        <span class="item-voo__trecho">${esc(nomeCurto(v.origem))} a ${esc(nomeCurto(v.destino))}, ${esc(diaRelativo(saidaDe(v), fusoDe(v)))}</span>
      </a>
      <button class="item-voo__remover" type="button" aria-label="${esc(rotulo)}" data-remover="${esc(i.id)}">${icone('i-lixo')}</button>
    </li>`;
}
lista.addEventListener('click', e => {
  const b = e.target.closest('[data-remover]'); if (!b) return;
  const i = estado.inscricoes?.find(x => String(x.id) === b.dataset.remover); if (i) pararDeAcompanhar(i, i.voo);
});
function focarItem(id) {
  lista.querySelectorAll('.item-voo').forEach(li => li.toggleAttribute('data-destaque', li.dataset.voo === id));
  globo?.focar(id && globo.tem(id) ? id : null);
}
lista.addEventListener('mouseover', e => { const li = e.target.closest('.item-voo'); if (li && !li.hasAttribute('data-destaque')) focarItem(li.dataset.voo); });
lista.addEventListener('focusin', e => { const li = e.target.closest('.item-voo'); if (li) focarItem(li.dataset.voo); });
lista.addEventListener('mouseleave', () => focarItem(null));
async function telaMeusVoos() {
  pintarMeusVoos(); cenaLista();
  await Promise.all([carregarInscricoes(), carregarEu()]);
  if (rotaAtual().nome !== 'meus-voos') return;
  pintarMeusVoos(); cenaLista();
}

/* ============================================================ BUSCA POR ROTA */
const selDe = $('#pais-de'), selPara = $('#pais-para'), chipsDe = $('#aero-de'), chipsPara = $('#aero-para'), erroRota = $('#rota-erro');
let paisesPromessa = null;
function carregarPaises() { paisesPromessa ??= carregarPaises_().then(r => { if (!r) paisesPromessa = null; return r; }); return paisesPromessa; }
async function carregarPaises_() {
  try {
    estado.paises = (await get('/api/lugares/paises'))?.paises || [];
  } catch (e) {
    for (const s of [selDe, selPara]) s.innerHTML = '<option value="">Países indisponíveis</option>';
    mostrarErro(erroRota, `${esc(mensagemDe(e))} <a href="#inicio">Busque pelo número do voo</a>.`);
    return null;
  }
  const ops = estado.paises.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(p => `<option value="${esc(p.codigo)}">${esc(p.nome)}</option>`).join('');
  selDe.innerHTML = `<option value="">Escolha o país</option>${ops}`;
  selPara.innerHTML = `<option value="">Escolha o país</option>${ops}`;
  // destino padrão: o país do aparelho (quem espera costuma estar no país de chegada)
  const regiao = (navigator.language || '').split('-')[1]?.toUpperCase();
  if (regiao && estado.paises.some(p => p.codigo === regiao)) { selPara.value = regiao; await trocarPais(selPara, chipsPara, false); }
  return estado.paises;
}
async function aeroportosDe(pais) {
  if (!estado.aeroportos.has(pais)) estado.aeroportos.set(pais, get(`/api/lugares/aeroportos?pais=${encodeURIComponent(pais)}`).then(r => r?.aeroportos || [])
    .catch(e => { estado.aeroportos.delete(pais); throw e; }));
  return estado.aeroportos.get(pais);
}
async function trocarPais(sel, alvo, marcarMaior) {
  esconderErro(erroRota);
  if (!sel.value) { alvo.innerHTML = ''; atualizarPares(); return; }
  alvo.innerHTML = '<p class="carregando-texto">Carregando aeroportos…</p>';
  try {
    const lista = await aeroportosDe(sel.value);
    if (!lista.length) { alvo.innerHTML = '<p class="dica">Nenhum aeroporto com voos regulares nesse país.</p>'; atualizarPares(); return; }
    alvo.innerHTML = lista.map((a, i) => `<label><input type="checkbox" value="${esc(a.iata)}"${marcarMaior && i === 0 ? ' checked' : ''}><span><b>${esc(a.iata)}</b><small>${esc(nomeCurto(a))}</small></span></label>`).join('');
  } catch (e) { alvo.innerHTML = ''; mostrarErro(erroRota, esc(mensagemDe(e))); }
  atualizarPares();
}
selDe.addEventListener('change', () => trocarPais(selDe, chipsDe, true));
selPara.addEventListener('change', () => trocarPais(selPara, chipsPara, false));
const marcados = alvo => $$('input:checked', alvo).map(i => i.value);
const pares = () => { const d = marcados(chipsDe), p = marcados(chipsPara); return d.flatMap(a => p.filter(b => b !== a).map(b => [a, b])); };
const paresDica = $('#pares-dica');
function atualizarPares(ev) {
  if (pares().length > MAX_PARES && ev?.target?.checked) {
    ev.target.checked = false;
    paresDica.textContent = `No máximo ${MAX_PARES} combinações por busca: cada uma custa uma consulta. Desmarque um aeroporto para trocar.`;
    paresDica.classList.add('atrasou');
  } else {
    const n = pares().length;
    paresDica.textContent = n ? `${n} ${n === 1 ? 'combinação' : 'combinações'} de aeroportos (máximo ${MAX_PARES}).` : 'Escolha pelo menos um aeroporto de cada lado.';
    paresDica.classList.remove('atrasou');
  }
  if (rotaAtual().nome === 'rota') cenaRota();
}
chipsDe.addEventListener('change', atualizarPares); chipsPara.addEventListener('change', atualizarPares);

async function aeroporto(iata) {
  for (const [, p] of estado.aeroportos) { const a = (await p.catch(() => [])).find(x => x.iata === iata); if (a) return a; }
  return null;
}
async function cenaRota() {
  const ps = pares(), voos = [], rotulos = [], vistos = new Set();
  for (const [de, para] of ps) {
    const a = await aeroporto(de), b = await aeroporto(para); if (!a || !b) continue;
    const id = `par-${de}-${para}`;
    voos.push({ id, a, b, t: 0, tipo: 'opcao' });
    if (!vistos.has(de)) { vistos.add(de); rotulos.push({ id, onde: 'a', classe: 'rotulo--aero', html: placaMini(de, '') }); }
    if (!vistos.has(para)) { vistos.add(para); rotulos.push({ id, onde: 'b', html: placaMini(para, nomeCurto(b)) }); }
  }
  if (rotaAtual().nome === 'rota') cenaGlobo({ voos, rotulos });
}
$('#form-rota').addEventListener('submit', async e => {
  e.preventDefault();
  esconderErro(erroRota);
  const ps = pares(), data = dataEscolhida('data-rota');
  if (!ps.length) return mostrarErro(erroRota, 'Escolha pelo menos um aeroporto de saída e um de chegada.');
  if (aeroapiDesligada()) return mostrarErro(erroRota, `${MSG_SEM_AEROAPI} <a href="#inicio">Busque pelo número do voo</a>.`);
  const de = [...new Set(ps.map(p => p[0]))], para = [...new Set(ps.map(p => p[1]))];
  const botao = $('#buscar-rota'); ocupado(botao, true);
  const res = $('#rota-resultados');
  try {
    const comEscala = $('#com-escala').checked;
    const r = await get(`/api/rotas/buscar?de=${de.join(',')}&para=${para.join(',')}&data=${data}${comEscala ? '&escala=1' : ''}`);
    await carregarEu();
    const prs = r?.pares || [];
    const itens = prs.flatMap(p => (p.voos || []).map(v => ({ v, par: `par-${p.de}-${p.para}` })))
      .sort((x, y) => new Date(saidaDe(x.v)) - new Date(saidaDe(y.v)));
    itens.forEach(({ v }) => estado.voos.set(v.fa_flight_id, v));
    const viagens = prs.flatMap(p => (p.viagens || []).map(x => ({ pernas: x.pernas, par: `par-${p.de}-${p.para}` })))
      .sort((x, y) => new Date(saidaDe(x.pernas[0])) - new Date(saidaDe(y.pernas[0])));
    viagens.forEach(x => x.pernas.forEach(v => estado.voos.set(v.fa_flight_id, v)));
    estado.rotaData = data; estado.rotaItens = itens; estado.rotaViagens = viagens;
    const partes = [itens.length ? plural(itens.length, 'voo sem escala', 'voos sem escala') : '', viagens.length ? plural(viagens.length, 'viagem com escala', 'viagens com escala') : ''].filter(Boolean);
    $('#t-res').textContent = partes.length ? `${partes.join(' e ')} ${nomeDoDia(data)}` : `Nenhum voo ${comEscala ? '' : 'sem escala '}${nomeDoDia(data)}`;
    const htmlViagens = viagens.map((x, i) => resultadoViagem(x, i)).join('');
    $('#lista-rota').innerHTML = (itens.length || viagens.length) ? htmlViagens + itens.map(({ v, par }) => {
      const f = fusoDe(v), sai = saidaDe(v), chega = chegadaDe(v), dur = minutosEntre(h(v).saida_prevista || sai, h(v).chegada_prevista || chega);
      return `<button class="resultado" type="button" data-id="${esc(v.fa_flight_id)}" data-par="${esc(par)}" data-sai="${esc(sai || '')}">
        <span class="resultado__cia"><span>${esc(v.companhia || '')}</span><b>${esc(codigo(v))}</b></span>
        <span class="ponta"><span class="ponta__codigo">${esc(v.origem?.iata || '')}</span><span class="ponta__hora num">sai ${hora(sai, f)}</span></span>
        <span class="resultado__meio">${dur ? duracao(dur, true) : ''}<br>sem escala</span>
        <span class="ponta ponta--fim"><span class="ponta__codigo">${esc(v.destino?.iata || '')}</span><span class="ponta__hora num">chega ${hora(chega, f)}</span></span>
      </button>`;
    }).join('') : vazio({ titulo: 'Nada nesse dia', texto: comEscala
      ? 'Não achamos voos diretos nem com uma escala entre esses aeroportos nessa data. Tente outro dia, outros aeroportos ou <a href="#inicio">busque pelo número do voo</a>.'
      : 'Não achamos voos diretos entre esses aeroportos nessa data. Marque "Incluir voos com uma escala", tente outro dia ou <a href="#inicio">busque pelo número do voo</a>.' });
    // os com escala vêm primeiro só quando não há direto; com direto, a ordem é pela saída
    if (itens.length && viagens.length) {
      const lista = $('#lista-rota'), todos = [...lista.children];
      todos.sort((a, b) => new Date(a.dataset.sai) - new Date(b.dataset.sai)).forEach(el => lista.append(el));
    }
    const cidades = [...new Set(itens.map(({ v }) => cidade(v.destino)))];
    const lim = estado.eu?.limites?.buscas_rota, usadas = estado.eu?.uso?.buscas_rota_hoje;
    const resto = Number.isFinite(lim) && Number.isFinite(usadas) ? Math.max(0, lim - usadas) : null;
    $('#rota-nota').textContent = [
      itens.length ? (cidades.length === 1 ? `Horários de ${cidades[0]}.` : 'Horários da cidade de chegada de cada voo.') + ' Toque num voo para acompanhar.' : '',
      viagens.length ? 'Nas viagens com escala, a saída está no horário da cidade de origem e a chegada no do destino final. A lista com escala mostra as próximas saídas e pode não ter todas as opções.' : '',
      comEscala && !viagens.length && itens.length ? 'Não achamos viagens com uma escala para essa data.' : '',
      prs.length && prs.every(p => p.cache) ? 'Esta busca veio do cache e não gastou nada.' : '',
      resto !== null ? `Você ainda tem ${plural(resto, 'busca', 'buscas')} por rota hoje.` : '',
    ].filter(Boolean).join(' ');
    res.hidden = false;
    $('#t-res').focus();
  } catch (err) {
    res.hidden = true;
    let html = esc(mensagemDe(err));
    if (err.erro === 'limite') html += estado.eu?.conta ? ' Amanhã libera de novo, ou <a href="#inicio">busque pelo número do voo</a>.'
      : ' <a href="#entrar">Entre com Google</a> para fazer mais buscas por dia, ou <a href="#inicio">busque pelo número do voo</a>.';
    else if (err.erro === 'pausado' || err.erro === 'aeroapi_sem_chave') html += ' Acompanhar pelo número continua funcionando: <a href="#inicio">busque pelo número do voo</a>.';
    mostrarErro(erroRota, html);
  } finally { ocupado(botao, false); }
});
$('#lista-rota').addEventListener('click', e => {
  const b = e.target.closest('.resultado'); if (!b) return;
  if (b.dataset.viagem != null) {
    const x = estado.rotaViagens?.[Number(b.dataset.viagem)]; if (!x) return;
    estado.buscaViagem = { pernas: x.pernas, data: estado.rotaData };
    location.hash = `confirmacao/${x.pernas.map(v => limparIdent(codigo(v))).join('+')}/${estado.rotaData}`;
    return;
  }
  const v = estado.voos.get(b.dataset.id); if (!v) return;
  const c = limparIdent(codigo(v)), data = estado.rotaData;
  estado.busca = { chave: `${c}|${data}`, voos: [v], escolhido: v.fa_flight_id };
  location.hash = `confirmacao/${encodeURIComponent(c)}/${data}`;
});
$('#lista-rota').addEventListener('mouseover', e => { const b = e.target.closest('.resultado'); if (b) globo?.realcar(b.dataset.par); });
$('#lista-rota').addEventListener('mouseleave', () => globo?.realcar(null));
/** Resultado da busca por rota: uma viagem com uma escala (as duas pernas num botão só). */
function resultadoViagem({ pernas, par }, i) {
  const [a, b] = pernas, sai = saidaDe(a), chega = chegadaDe(b);
  const total = minutosEntre(sai, chega), escala = minutosEntre(chegadaDe(a), saidaDe(b));
  const cias = [...new Set(pernas.map(v => v.companhia).filter(Boolean))].join(' + ');
  const maisDia = diaISO(chega, fusoDe(b)) !== diaISO(sai, a.origem?.fuso) ? ' <small>+1 dia</small>' : '';
  const aria = `${cias}, ${codigo(a)} e ${codigo(b)}: sai de ${cidade(a.origem)} às ${hora(sai, a.origem?.fuso)}, escala de ${duracao(escala)} em ${cidade(a.destino)}, chega a ${cidade(b.destino)} às ${hora(chega, fusoDe(b))}`;
  return `<button class="resultado resultado--escala" type="button" data-viagem="${i}" data-par="${esc(par)}" data-sai="${esc(sai || '')}" aria-label="${esc(aria)}">
    <span class="resultado__cia"><span>${esc(cias)}</span><b>${esc(codigo(a))} + ${esc(codigo(b))}</b></span>
    <span class="ponta"><span class="ponta__codigo">${esc(a.origem?.iata || '')}</span><span class="ponta__hora num">sai ${hora(sai, a.origem?.fuso)}</span></span>
    <span class="resultado__meio">${total ? duracao(total, true) : ''}<br><span class="resultado__escala">${icone('i-conexao')}${esc(a.destino?.iata || '')} · ${escala !== null ? duracao(Math.max(0, escala), true) : ''}</span></span>
    <span class="ponta ponta--fim"><span class="ponta__codigo">${esc(b.destino?.iata || '')}</span><span class="ponta__hora num">chega ${hora(chega, fusoDe(b))}${maisDia}</span></span>
  </button>`;
}
function telaRota() { carregarPaises().then(() => cenaRota()); cenaRota(); }

/* ============================================================ ENTRAR */
function telaEntrar() { pintarConta(); cenaLista({ girar: true }); if (!estado.eu?.conta) prepararGoogle(); }

/* ============================================================ ROTEADOR */
const TELAS = { inicio: telaInicio, confirmacao: telaConfirmacao, status: telaStatus, 'meus-voos': telaMeusVoos, rota: telaRota, entrar: telaEntrar };
function rotaAtual() {
  const [nome, ...args] = location.hash.replace(/^#/, '').split('/');
  return { nome: TELAS[nome] ? nome : 'inicio', args: args.map(a => { try { return decodeURIComponent(a); } catch { return a; } }) };
}
let telaAtual = null;
function mostrar(focar = false) {
  const { nome, args } = rotaAtual();
  pintarDias();
  $$('.tela').forEach(s => s.classList.toggle('ativa', s.dataset.tela === nome));
  document.body.dataset.tela = nome;
  if (nome !== telaAtual) { document.body.removeAttribute('data-recolhido'); globo?.ajustar(); }
  if (nome !== 'status') { pararAtualizacao(); statusId = null; }
  telaAtual = nome;
  $('#painel').scrollTop = 0; scrollTo(0, 0);
  if (nome === 'status') focarAoPintar = focar;
  TELAS[nome](args);
  if (focar && nome !== 'status') { const h1 = $('.tela.ativa h1:not([hidden])'); h1?.setAttribute('tabindex', '-1'); h1?.focus({ preventScroll: true }); }
}
addEventListener('hashchange', () => mostrar(true));

/* ============================================================ INÍCIO DO APP */
async function iniciar() {
  // link compartilhado: /v/<fa_flight_id> abre o status desse voo
  const link = location.pathname.match(/^\/v\/([^/?#]+)\/?$/);
  if (link && !location.hash) history.replaceState(null, '', `/#status/${link[1]}`);
  mostrarCaixasIOS();
  registrarSW();
  const config = estado.configPronta = get('/api/config').then(c => { mostrarSeloSimulado(c); return (estado.config = c); }).catch(() => null);
  const eu = estado.euPronta = carregarEu(), insc = carregarInscricoes();
  mostrar();
  await config; await eu; await insc;
  // repinta a tela atual com o que chegou (contador, limites, voos no globo)
  const { nome } = rotaAtual();
  if (nome === 'inicio') telaInicio();
  if (nome === 'entrar') pintarConta();
  if (nome === 'meus-voos') { pintarMeusVoos(); cenaLista(); }
}
iniciar();
