// POST /webhook/aeroapi/:segredo. Segredo errado → 404. Responde 200 na hora e processa depois.
import { enviarJson, enviarErro, lerJson } from '../http.js';
import { segredoValido, processarWebhook } from '../webhook.js';

/** @param {ReturnType<import('../http.js').criarRoteador>} r */
export function registrarWebhook(r) {
  r.rota('POST', '/webhook/aeroapi/:segredo', async ({ ctx, req, res, params }) => {
    if (!segredoValido(params.segredo)) return enviarErro(res, 404, 'nao_encontrado');
    let corpo;
    try {
      corpo = await lerJson(req, 1_000_000);
    } catch {
      corpo = null;
    }
    enviarJson(res, 200, { ok: true });
    ctx.emSegundoPlano(() => processarWebhook(ctx, corpo));
  });
}
