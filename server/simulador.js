// AeroAPI simulada: só para desenvolvimento local, sem chave e sem custo.
// Liga com AEROAPI_SIMULADA=1 (npm run simular). Responde no mesmo formato da AeroAPI real,
// então todo o resto do servidor (normalização, cache, alertas, agendador) roda igual.
// Os voos são curtos e se repetem em ciclo: sempre há um no ar, um que pousou e um previsto.
import { aeroporto } from './lugares.js';

const MIN = 60_000;

/** Catálogo. `dur` = minutos no ar (encurtado de propósito, para ver o avião andar); `ciclo` = de quanto em quanto tempo sai um. */
export const CATALOGO = [
  { iata: 'TP1018', icao: 'TAP1018', op: ['TAP', 'TP'], de: 'OPO', para: 'MAD', tipo: 'A20N', dur: 8, ciclo: 12 },
  { iata: 'TP103', icao: 'TAP103', op: ['TAP', 'TP'], de: 'LIS', para: 'GRU', tipo: 'A339', dur: 40, ciclo: 50 },
  { iata: 'G31402', icao: 'GLO1402', op: ['GLO', 'G3'], de: 'GRU', para: 'SDU', tipo: 'B38M', dur: 10, ciclo: 15 },
  { iata: 'AD4510', icao: 'AZU4510', op: ['AZU', 'AD'], de: 'VCP', para: 'REC', tipo: 'A20N', dur: 20, ciclo: 30 },
  { iata: 'LA8084', icao: 'TAM8084', op: ['TAM', 'LA'], de: 'GRU', para: 'LHR', tipo: 'B789', dur: 60, ciclo: 75 },
];

export function simulacaoLigada(env = process.env) {
  if (env.AEROAPI_SIMULADA !== '1') return false;
  if (env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV === 'production') {
    console.warn('[simulador] AEROAPI_SIMULADA ignorada: não roda em produção.');
    return false;
  }
  return true;
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const lugar = (c) => {
  const a = aeroporto(c);
  return { code: a.icao, code_icao: a.icao, code_iata: a.iata, name: a.nome, city: a.cidade, timezone: a.fuso };
};

/** O voo `k` de um item do catálogo, no formato da AeroAPI, como estaria no instante `agora`. */
export function vooSimulado(item, k, agora) {
  const decola = k * item.ciclo * MIN, pousa = decola + item.dur * MIN;
  const sai = decola - 6 * MIN, chega = pousa + 4 * MIN;
  const ja = (t) => (agora >= t ? iso(t) : null);
  const noAr = agora >= decola && agora < pousa;
  return {
    fa_flight_id: `SIM-${item.icao}-${k}`,
    ident: item.icao, ident_icao: item.icao, ident_iata: item.iata,
    operator: item.op[0], operator_icao: item.op[0], operator_iata: item.op[1],
    flight_number: item.iata.replace(/^\D+/, ''),
    aircraft_type: item.tipo, registration: null,
    origin: lugar(item.de), destination: lugar(item.para),
    scheduled_out: iso(sai), estimated_out: iso(sai), actual_out: ja(sai),
    scheduled_off: iso(decola), estimated_off: iso(decola), actual_off: ja(decola),
    scheduled_on: iso(pousa), estimated_on: iso(pousa), actual_on: ja(pousa),
    scheduled_in: iso(chega), estimated_in: iso(chega), actual_in: ja(chega),
    departure_delay: 0, arrival_delay: 0,
    cancelled: false, diverted: false,
    status: agora >= chega ? 'Arrived / Gate Arrival' : agora >= pousa ? 'Landed / Taxiing' : noAr ? 'En Route / On Time' : 'Scheduled',
    progress_percent: noAr ? Math.round(((agora - decola) / (pousa - decola)) * 100) : agora >= pousa ? 100 : 0,
  };
}

/** Voos de um item cujo horário cai em [ini, fim). */
function voosNaJanela(item, ini, fim, agora) {
  const passo = item.ciclo * MIN, lista = [];
  for (let k = Math.ceil((ini + 6 * MIN) / passo); k * passo - 6 * MIN < fim; k++) lista.push(vooSimulado(item, k, agora));
  return lista;
}

/** Perto de agora: o anterior, o que está no ar (ou o próximo) e o seguinte. */
function voosPertoDeAgora(item, agora) {
  const k = Math.floor(agora / (item.ciclo * MIN));
  return [k - 1, k, k + 1].map((n) => vooSimulado(item, n, agora));
}

const resposta = (status, corpo, cabecalhos = {}) =>
  new Response(corpo == null ? null : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });

/** Um `fetch` que responde como a AeroAPI. */
export function criarFetchSimulado({ agora = () => Date.now() } = {}) {
  let proximoAlerta = 1;
  const porIdent = (id) => CATALOGO.find((i) => [i.iata, i.icao].includes(String(id).toUpperCase()));
  const noAeroporto = (c, cod) => { const a = aeroporto(c); return [a.iata, a.icao].includes(String(cod).toUpperCase()); };

  return async function fetchSimulado(url, { method = 'GET' } = {}) {
    const u = new URL(url), t = agora();
    const caminho = decodeURIComponent(u.pathname.replace(/^\/aeroapi/, ''));
    let m;
    if (method === 'POST' && caminho === '/alerts') return resposta(201, null, { location: `/alerts/${proximoAlerta++}` });
    if (method === 'DELETE' && caminho.startsWith('/alerts/')) return resposta(204, null);

    if ((m = caminho.match(/^\/flights\/([^/]+)\/canonical$/))) {
      const i = porIdent(m[1]);
      return i ? resposta(200, { idents: [{ ident: i.icao, ident_type: 'designator' }] }) : resposta(404, { title: 'Not found' });
    }
    if ((m = caminho.match(/^\/airports\/([^/]+)\/flights\/to\/([^/]+)$/))) {
      const ini = Date.parse(u.searchParams.get('start')), fim = Date.parse(u.searchParams.get('end'));
      const voos = CATALOGO.filter((i) => noAeroporto(i.de, m[1]) && noAeroporto(i.para, m[2]))
        .flatMap((i) => voosNaJanela(i, ini, fim, t));
      return resposta(200, { flights: voos.map((f) => ({ segments: [f] })), num_pages: 1 });
    }
    if ((m = caminho.match(/^\/flights\/([^/]+)$/))) {
      const id = m[1];
      const sim = id.match(/^SIM-([A-Z0-9]+)-(-?\d+)$/);
      if (sim) {
        const i = porIdent(sim[1]);
        return i ? resposta(200, { flights: [vooSimulado(i, Number(sim[2]), t)], num_pages: 1 }) : resposta(404, { title: 'Not found' });
      }
      const i = porIdent(id);
      if (!i) return resposta(200, { flights: [], num_pages: 1 });
      const ini = Date.parse(u.searchParams.get('start')), fim = Date.parse(u.searchParams.get('end'));
      const hoje = Number.isFinite(ini) && Number.isFinite(fim) && t >= ini && t < fim;
      return resposta(200, { flights: hoje ? voosPertoDeAgora(i, t) : voosNaJanela(i, ini, fim, t).slice(0, 6), num_pages: 1 });
    }
    return resposta(404, { title: 'Not simulated', detail: `${method} ${caminho}` });
  };
}
