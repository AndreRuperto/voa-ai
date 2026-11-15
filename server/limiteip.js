// Limite de pedidos por IP (docs/03-arquitetura.md, "Abuso de cadastro"; docs/13-api.md).
// Fica na memória: um processo só, e reiniciar zera a contagem, o que é aceitável para frear rajadas.
// O limite por aparelho/conta (R5) e os tetos de gasto continuam valendo por cima deste.

const MIN = 60_000;

/**
 * Grupos de rotas e quantos pedidos cada IP pode fazer na janela.
 * `consulta` são as rotas que podem chamar a AeroAPI (custam dinheiro quando o cache não tem).
 */
export const GRUPOS = {
  consulta: { janelaMs: 10 * MIN, padraoMax: 40 },
  login: { janelaMs: 10 * MIN, padraoMax: 20 },
  api: { janelaMs: MIN, padraoMax: 240 },
};

/** Em qual grupo o pedido entra (null: não limita, ex.: webhook e arquivos estáticos). */
export function grupoDoPedido(metodo, caminho) {
  if (!caminho.startsWith('/api/') || caminho.startsWith('/api/admin/')) return null;
  if (metodo === 'GET' && (caminho === '/api/voos/buscar' || caminho === '/api/rotas/buscar' || /^\/api\/voos\/[^/]+\/?$/.test(caminho))) return 'consulta';
  if (metodo === 'POST' && caminho === '/api/inscricoes') return 'consulta';
  if (metodo === 'POST' && caminho === '/api/sessao') return 'login';
  return 'api';
}

/**
 * IP de quem pediu. Atrás do proxy do Railway, o IP real vem em X-Real-IP (o Railway sobrescreve esse
 * cabeçalho, então o cliente não consegue forjar). Fora do Railway, só confia num cabeçalho se
 * CABECALHO_IP disser qual; senão usa o IP da conexão.
 */
export function ipDoPedido(req, env = process.env) {
  const cab = (env.CABECALHO_IP || (env.RAILWAY_ENVIRONMENT_NAME ? 'x-real-ip' : '')).toLowerCase();
  if (cab) {
    const v = String(req.headers[cab] || '').split(',')[0].trim();
    if (v) return v;
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

/**
 * Contador de janela fixa por IP e grupo.
 * @param {{agora?: () => number, maximos?: Partial<Record<keyof GRUPOS, number>>}} [op]
 */
export function criarLimitePorIp({ agora = () => Date.now(), maximos = {} } = {}) {
  /** chave "grupo|ip" → {inicio, n} */
  const contas = new Map();
  let ultimaLimpeza = agora();

  function limpar(t) {
    if (t - ultimaLimpeza < MIN) return;
    ultimaLimpeza = t;
    for (const [k, c] of contas) if (t - c.inicio >= GRUPOS[k.split('|')[0]].janelaMs) contas.delete(k);
  }

  return {
    /**
     * Conta um pedido. Devolve {ok:true} ou {ok:false, esperarS} quando passou do limite.
     * @param {keyof GRUPOS} grupo
     * @param {string} ip
     * @param {number} [max] máximo da janela (o admin pode mudar o de `consulta`)
     */
    contar(grupo, ip, max) {
      const g = GRUPOS[grupo];
      const limite = max ?? maximos[grupo] ?? g.padraoMax;
      const t = agora();
      limpar(t);
      const k = `${grupo}|${ip}`;
      let c = contas.get(k);
      if (!c || t - c.inicio >= g.janelaMs) { c = { inicio: t, n: 0 }; contas.set(k, c); }
      if (c.n >= limite) return { ok: false, esperarS: Math.max(1, Math.ceil((c.inicio + g.janelaMs - t) / 1000)) };
      c.n++;
      return { ok: true };
    },
    /** Só para testes. */
    zerar() { contas.clear(); },
  };
}

/** Texto do 429, em minutos quando passa de um. */
export function mensagemLimiteIp(esperarS) {
  const min = Math.ceil(esperarS / 60);
  return esperarS <= 60
    ? 'Muitos pedidos seguidos desta rede. Espere um minuto e tente de novo.'
    : `Muitos pedidos seguidos desta rede. Tente de novo em ${min} minutos.`;
}
