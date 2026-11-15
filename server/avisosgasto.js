// Avisos de gasto para os admins (docs/12-contas-admin-rotas.md, "Alertas do admin").
// Marcos do mês: 50% e 80% do crédito, teto mensal (a busca por rota pausa) e teto duro (o servidor
// para de fazer chamadas pagas). Cada marco avisa uma vez por mês, por push nos aparelhos dos admins.
// E-mail ainda não: precisa de um serviço de envio e de uma chave (ver PROXIMOS_PASSOS.md).
import { lerConfig, gastoDoMes, creditoMensal } from './limites.js';
import { ehAdmin } from './contas.js';
import { removerEndpoint } from './push.js';

const usd = (n) => `US$ ${n.toFixed(2).replace('.', ',')}`;
const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Marcos que valem com a configuração atual, do menor para o maior. */
export function marcos(db) {
  const c = lerConfig(db);
  const credito = creditoMensal();
  return [
    { marco: '50', usd: credito * 0.5 },
    { marco: '80', usd: credito * 0.8 },
    { marco: 'teto', usd: c.teto_mensal_usd },
    { marco: 'duro', usd: c.teto_duro_usd },
  ];
}

/** Texto do push de cada marco. */
export function mensagemGasto(marco, { gasto, credito, mes }) {
  const nomeMes = NOME_MES[Number(mes.slice(5, 7)) - 1];
  const base = `${usd(gasto)} de ${usd(credito)} em ${nomeMes}.`;
  switch (marco) {
    case '50': return { titulo: 'Metade do crédito da AeroAPI usada', corpo: `${base} Veja no painel o que está gastando mais.` };
    case '80': return { titulo: '80% do crédito da AeroAPI usado', corpo: `${base} Se precisar, pause a busca por rota ou ligue o modo econômico.` };
    case 'teto': return { titulo: 'Busca por rota pausada', corpo: `${base} O teto do mês foi atingido. Acompanhar por número continua.` };
    case 'duro': return { titulo: 'Buscas de voo paradas', corpo: `${base} O teto duro foi atingido: nenhuma busca nova até o mês virar. Os alertas já criados continuam.` };
    default: return null;
  }
}

/** Aparelhos com push dos admins (sem endpoints repetidos). */
export function aparelhosDosAdmins(db) {
  const linhas = db.prepare(`SELECT a.push_endpoint, a.push_p256dh, a.push_auth, u.email, u.bloqueado
                             FROM APARELHO a JOIN USUARIO u ON u.id = a.usuario_id
                             WHERE a.push_endpoint IS NOT NULL`).all();
  const vistos = new Set();
  return linhas.filter((l) => ehAdmin(l) && !vistos.has(l.push_endpoint) && vistos.add(l.push_endpoint))
    .map((l) => ({ endpoint: l.push_endpoint, keys: { p256dh: l.push_p256dh, auth: l.push_auth } }));
}

/** Manda um push a todos os aparelhos dos admins. Devolve quantos aceitaram. */
export async function avisarAdmins(ctx, { titulo, corpo, tag }) {
  let enviados = 0;
  const payload = JSON.stringify({ titulo, corpo, url: '/admin/', tag });
  for (const sub of aparelhosDosAdmins(ctx.db)) {
    try {
      await ctx.enviarPush(sub, payload);
      enviados++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) removerEndpoint(ctx.db, sub.endpoint);
      else console.warn(`[avisos] push para admin falhou (${e?.statusCode || e?.message})`);
    }
  }
  return enviados;
}

/**
 * Confere o gasto do mês e avisa os marcos novos. Roda no agendador.
 * Só o marco mais alto que passou manda push (quem pula de 40% para 90% recebe um aviso, não dois);
 * os de baixo ficam registrados como vistos.
 * @returns {Promise<string[]>} marcos registrados nesta rodada
 */
export async function verificarGasto(ctx) {
  const db = ctx.db;
  const agora = ctx.agora();
  const mes = agora.toISOString().slice(0, 7);
  const gasto = gastoDoMes(db, agora);
  const ja = new Set(db.prepare('SELECT marco FROM AVISO_GASTO WHERE mes = ?').all(mes).map((l) => l.marco));
  const novos = marcos(db).filter((m) => m.usd > 0 && gasto >= m.usd && !ja.has(m.marco)).sort((a, b) => a.usd - b.usd);
  if (!novos.length) return [];
  const topo = novos[novos.length - 1];
  const m = mensagemGasto(topo.marco, { gasto, credito: creditoMensal(), mes });
  const enviados = await avisarAdmins(ctx, { ...m, tag: `gasto:${mes}:${topo.marco}` });
  const st = db.prepare('INSERT OR IGNORE INTO AVISO_GASTO (mes, marco, gasto_usd, enviados, em) VALUES (?, ?, ?, ?, ?)');
  for (const n of novos) st.run(mes, n.marco, Math.round(gasto * 1e6) / 1e6, n === topo ? enviados : 0, agora.toISOString());
  console.log(`[avisos] gasto de ${usd(gasto)} passou do marco ${topo.marco}; push em ${enviados} aparelho(s) de admin.`);
  return novos.map((n) => n.marco);
}

/** Avisos do mês, para o painel. */
export function avisosDoMes(db, mes) {
  return db.prepare('SELECT marco, gasto_usd, enviados, em FROM AVISO_GASTO WHERE mes = ? ORDER BY em').all(mes);
}
