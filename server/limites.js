// Limites e interruptores na tabela CONFIG, com os padrões da docs/12-contas-admin-rotas.md.

/** Chave → tipo e valor padrão. */
export const CHAVES = {
  limite_voos_anonimo: { tipo: 'numero', padrao: 5 },
  limite_voos_conta: { tipo: 'numero', padrao: 15 },
  limite_rota_anonimo: { tipo: 'numero', padrao: 3 },
  limite_rota_conta: { tipo: 'numero', padrao: 10 },
  teto_alertas_dia: { tipo: 'numero', padrao: 50 },
  teto_mensal_usd: { tipo: 'numero', padrao: null }, // null → CREDITO_MENSAL_USD
  teto_duro_usd: { tipo: 'numero', padrao: null }, // null → 2 × teto_mensal_usd
  limite_ip_consultas: { tipo: 'numero', padrao: 40 }, // por IP a cada 10 min
  rota_pausada: { tipo: 'booleano', padrao: false },
  modo_economico: { tipo: 'booleano', padrao: false },
};

/** Chaves em US$ (aceitam centavos); as outras são contagens inteiras. */
const EM_DOLAR = new Set(['teto_mensal_usd', 'teto_duro_usd']);

export const creditoMensal = () => Number(process.env.CREDITO_MENSAL_USD) || 5;

/** Toda a configuração, com os padrões preenchidos. */
export function lerConfig(db) {
  const salvos = Object.fromEntries(db.prepare('SELECT chave, valor FROM CONFIG').all().map((l) => [l.chave, JSON.parse(l.valor)]));
  const r = {};
  for (const [k, def] of Object.entries(CHAVES)) r[k] = k in salvos ? salvos[k] : def.padrao;
  if (r.teto_mensal_usd == null) r.teto_mensal_usd = creditoMensal();
  if (r.teto_duro_usd == null) r.teto_duro_usd = Math.round(r.teto_mensal_usd * 2 * 100) / 100;
  return r;
}

/**
 * Valida e grava as chaves enviadas pelo admin.
 * @returns {{ok: true, mudancas: Array<{chave:string, de:any, para:any}>} | {ok: false, mensagem: string}}
 */
export function gravarConfig(db, corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, mensagem: 'Envie um objeto com as chaves a mudar.' };
  const atual = lerConfig(db);
  const novos = {};
  for (const [k, v] of Object.entries(corpo)) {
    const def = CHAVES[k];
    if (!def) return { ok: false, mensagem: `Chave desconhecida: ${k}.` };
    if (def.tipo === 'numero' && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) return { ok: false, mensagem: `${k} precisa ser um número ≥ 0.` };
    if (def.tipo === 'booleano' && typeof v !== 'boolean') return { ok: false, mensagem: `${k} precisa ser verdadeiro ou falso.` };
    novos[k] = def.tipo === 'numero' && !EM_DOLAR.has(k) ? Math.floor(v) : v;
  }
  const mudancas = [];
  const st = db.prepare('INSERT INTO CONFIG (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(novos)) {
    if (atual[k] === v) continue;
    st.run(k, JSON.stringify(v));
    mudancas.push({ chave: k, de: atual[k], para: v });
  }
  return { ok: true, mudancas };
}

/** Limites que valem para quem está pedindo. */
export function limitesPara(db, temConta) {
  const c = lerConfig(db);
  return temConta
    ? { voos: c.limite_voos_conta, buscas_rota: c.limite_rota_conta }
    : { voos: c.limite_voos_anonimo, buscas_rota: c.limite_rota_anonimo };
}

/** Gasto estimado do mês corrente (UTC), em US$, pela tabela CHAMADA_API. */
export function gastoDoMes(db, agora) {
  const mes = agora.toISOString().slice(0, 7);
  return db.prepare('SELECT COALESCE(SUM(custo), 0) s FROM CHAMADA_API WHERE substr(em, 1, 7) = ?').get(mes).s;
}

/** Teto duro: passou dele, o servidor para de fazer chamadas pagas à AeroAPI até o mês virar. */
export function tetoDuroAtingido(db, agora) {
  return gastoDoMes(db, agora) >= lerConfig(db).teto_duro_usd;
}
