/* Voa Aí · chamadas à API (docs/13-api.md).
   - POST/PUT/DELETE sempre levam X-Requested-With: voa-ai (CSRF).
   - Erro vira ErroApi com o `mensagem` do servidor, pronto para mostrar na tela. */

export class ErroApi extends Error {
  constructor(status, erro, mensagem) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.erro = erro;
    this.mensagem = mensagem;
  }
}

const PADRAO = {
  0: 'Sem conexão. Confira a internet e tente de novo.',
  400: 'Algum dado veio fora do formato. Confira e tente de novo.',
  403: 'O navegador bloqueou o pedido. Recarregue a página e tente de novo.',
  404: 'Não achamos o que você procurou.',
  429: 'Você chegou ao limite por agora.',
  502: 'O serviço de voos não respondeu. Tente de novo em alguns minutos.',
  503: 'O serviço está indisponível agora. Tente de novo em alguns minutos.',
};

/** Texto para a pessoa. `aeroapi_sem_chave` ganha uma frase própria. */
export function mensagemDe(e) {
  if (e?.erro === 'aeroapi_sem_chave') return 'O serviço de voos ainda não está configurado. Tente de novo mais tarde.';
  return e?.mensagem || e?.message || PADRAO[503];
}

export async function api(caminho, { metodo = 'GET', corpo, sinal } = {}) {
  const opcoes = { method: metodo, headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: sinal };
  if (metodo !== 'GET' && metodo !== 'HEAD') opcoes.headers['X-Requested-With'] = 'voa-ai';
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  let r;
  try {
    r = await fetch(caminho, opcoes);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ErroApi(0, 'rede', PADRAO[0]);
  }
  if (r.status === 204) return null;
  let dados = null;
  try { dados = await r.json(); } catch { /* corpo vazio ou não-JSON */ }
  if (!r.ok) {
    const status = r.status;
    throw new ErroApi(status, dados?.erro || `http_${status}`, dados?.mensagem || PADRAO[status] || PADRAO[status >= 500 ? 503 : 400]);
  }
  return dados;
}

export const get = (c, o) => api(c, { ...o, metodo: 'GET' });
export const post = (c, corpo) => api(c, { metodo: 'POST', corpo });
export const put = (c, corpo) => api(c, { metodo: 'PUT', corpo });
export const del = c => api(c, { metodo: 'DELETE' });
