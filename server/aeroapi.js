// Cliente da FlightAware AeroAPI v4. Ver docs/04-integracao-aeroapi.md.
// Toda chamada é registrada em CHAMADA_API com o preço da tabela, para o painel de admin.

export const BASE_AEROAPI = 'https://aeroapi.flightaware.com/aeroapi';

/** Preço por página (US$), da tabela da doc 04. */
export const PRECOS = {
  canonical: 0.001,
  flights: 0.005,
  rota: 0.05,
  alerts: 0,
  alerta_entregue: 0.02,
};

/** Erro com código do contrato (docs/13-api.md). */
export class ErroAeroapi extends Error {
  /**
   * @param {'aeroapi_sem_chave'|'aeroapi_falhou'} codigo
   * @param {string} mensagem
   * @param {{status?: number, corpo?: string}} [extra]
   */
  constructor(codigo, mensagem, extra = {}) {
    super(mensagem);
    this.name = 'ErroAeroapi';
    this.codigo = codigo;
    this.http = codigo === 'aeroapi_sem_chave' ? 503 : 502;
    this.statusAeroapi = extra.status ?? null;
    this.corpo = extra.corpo ?? null;
  }
}

export const MENSAGEM_SEM_CHAVE = 'A busca de voos ainda não está ligada neste servidor. Falta configurar a chave da AeroAPI.';

/** Registra uma linha de custo em CHAMADA_API. */
export function registrarChamada(db, { tipo, endpoint, paginas = 1, status = null, fa_flight_id = null, ref = null, quem = null, preco }, agora = new Date()) {
  const p = preco ?? PRECOS[tipo] ?? 0;
  db.prepare(`INSERT INTO CHAMADA_API (tipo, endpoint, preco, paginas, custo, status, fa_flight_id, ref, quem, em)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(tipo, endpoint, p, paginas, Math.round(p * paginas * 1e6) / 1e6, status, fa_flight_id, ref, quem, agora.toISOString());
}

/**
 * @param {object} op
 * @param {import('node:sqlite').DatabaseSync} op.db
 * @param {typeof fetch} [op.fetch]
 * @param {() => string} [op.chave] lê a chave a cada chamada (padrão: process.env.AEROAPI_KEY)
 * @param {(ms:number)=>Promise<void>} [op.esperar]
 * @param {number} [op.tentativas] novas tentativas em 429/5xx/rede
 * @param {() => Date} [op.agora]
 */
export function criarAeroapi({
  db,
  fetch: buscar = globalThis.fetch,
  chave = () => process.env.AEROAPI_KEY || '',
  base = BASE_AEROAPI,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  tentativas = 3,
  agora = () => new Date(),
} = {}) {
  const temChave = () => Boolean(chave());

  /**
   * @param {string} metodo
   * @param {string} caminho
   * @param {{endpoint:string, tipo:string, query?:object, corpo?:object, fa_flight_id?:string, ref?:string, quem?:string, aceitar404?:boolean}} op
   */
  async function chamar(metodo, caminho, op) {
    const k = chave();
    if (!k) throw new ErroAeroapi('aeroapi_sem_chave', MENSAGEM_SEM_CHAVE);
    const url = new URL(base + caminho);
    for (const [n, v] of Object.entries(op.query || {})) if (v != null) url.searchParams.set(n, String(v));
    const endpoint = `${metodo} ${op.endpoint}`;

    let ultimoErro = null;
    for (let t = 0; t <= tentativas; t++) {
      let r;
      try {
        r = await buscar(url, {
          method: metodo,
          headers: { 'x-apikey': k, accept: 'application/json', ...(op.corpo ? { 'content-type': 'application/json' } : {}) },
          body: op.corpo ? JSON.stringify(op.corpo) : undefined,
        });
      } catch (e) {
        ultimoErro = new ErroAeroapi('aeroapi_falhou', `Falha de rede na AeroAPI: ${e.message}`);
        if (t < tentativas) { await esperar(1000 * 2 ** t); continue; }
        throw ultimoErro;
      }
      const texto = await r.text();
      let json = null;
      try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não JSON */ }
      const repetir = r.status === 429 || r.status >= 500;
      if (repetir && t < tentativas) {
        const ra = Number(r.headers.get('retry-after'));
        await esperar(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** t);
        continue;
      }
      const paginas = Math.max(1, Number(json?.num_pages) || 1);
      // A AeroAPI cobra as consultas que respondem; registramos todas para o painel bater com a fatura.
      registrarChamada(db, { tipo: op.tipo, endpoint, paginas, status: r.status, fa_flight_id: op.fa_flight_id, ref: op.ref, quem: op.quem }, agora());
      if (r.status === 404 && op.aceitar404) return { status: 404, json: null, headers: r.headers };
      if (!r.ok) {
        console.warn(`[aeroapi] ${metodo} ${url.pathname} → ${r.status} ${texto.slice(0, 300)}`);
        throw new ErroAeroapi('aeroapi_falhou', `A AeroAPI respondeu ${r.status}.`, { status: r.status, corpo: texto.slice(0, 1000) });
      }
      return { status: r.status, json, headers: r.headers };
    }
    throw ultimoErro;
  }

  return {
    temChave,

    /** IATA → ICAO (R6). Devolve a lista de idents canônicos. */
    async canonical(ident, { quem } = {}) {
      const { json } = await chamar('GET', `/flights/${encodeURIComponent(ident)}/canonical`, {
        endpoint: '/flights/{ident}/canonical', tipo: 'canonical', query: { ident_type: 'designator' }, quem, aceitar404: true,
      });
      return (json?.idents || []).filter((i) => i.ident_type === 'designator').map((i) => i.ident);
    },

    /** Voos de um ident num intervalo (`start` inclusivo, `end` exclusivo). */
    async voosPorIdent(ident, { start, end, quem } = {}) {
      const { json } = await chamar('GET', `/flights/${encodeURIComponent(ident)}`, {
        endpoint: '/flights/{ident}', tipo: 'flights', query: { ident_type: 'designator', start, end }, quem, aceitar404: true,
      });
      return json?.flights || [];
    },

    /** Um voo pelo fa_flight_id (em desvio, a API pode devolver duas pernas; fica a mais recente). */
    async vooPorId(faFlightId, { quem } = {}) {
      const { json } = await chamar('GET', `/flights/${encodeURIComponent(faFlightId)}`, {
        endpoint: '/flights/{id}', tipo: 'flights', query: { ident_type: 'fa_flight_id' }, fa_flight_id: faFlightId, quem, aceitar404: true,
      });
      const voos = json?.flights || [];
      return voos.find((v) => v.diverted) || voos[0] || null;
    },

    /** Voos sem escala entre dois aeroportos. Devolve só os de um trecho. */
    async voosEntre(de, para, { start, end, quem, ref } = {}) {
      const { json } = await chamar('GET', `/airports/${encodeURIComponent(de)}/flights/to/${encodeURIComponent(para)}`, {
        endpoint: '/airports/{id}/flights/to/{dest_id}', tipo: 'rota', query: { start, end, connection: 'nonstop', type: 'Airline' }, quem, ref, aceitar404: true,
      });
      return (json?.flights || []).filter((f) => f.segments?.length === 1).map((f) => f.segments[0]);
    },

    /** Cria um alerta e devolve o id (vem no cabeçalho Location: /alerts/{id}). */
    async criarAlerta(corpo, { fa_flight_id, quem } = {}) {
      const { json, headers } = await chamar('POST', '/alerts', { endpoint: '/alerts', tipo: 'alerts', corpo, fa_flight_id, quem });
      const loc = headers.get('location') || '';
      const id = Number(loc.match(/(\d+)\/?$/)?.[1] ?? json?.id);
      if (!Number.isFinite(id)) throw new ErroAeroapi('aeroapi_falhou', 'A AeroAPI criou o alerta mas não devolveu o id.');
      return id;
    },

    async apagarAlerta(id, { fa_flight_id, quem } = {}) {
      await chamar('DELETE', `/alerts/${encodeURIComponent(id)}`, { endpoint: '/alerts/{id}', tipo: 'alerts', fa_flight_id, quem, aceitar404: true });
    },
  };
}
