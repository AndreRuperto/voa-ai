/* Voa Aí · formatação de datas, horas e textos (Intl, pt-BR).
   A API manda ISO 8601 em UTC; a tela mostra no fuso do aeroporto de destino. */

const cache = new Map();
function fmt(opcoes) {
  const chave = JSON.stringify(opcoes);
  if (!cache.has(chave)) {
    try { cache.set(chave, new Intl.DateTimeFormat('pt-BR', opcoes)); }
    catch { const { timeZone, ...resto } = opcoes; cache.set(chave, new Intl.DateTimeFormat('pt-BR', resto)); }   // fuso desconhecido
  }
  return cache.get(chave);
}
const data = iso => (iso instanceof Date ? iso : new Date(iso));
const valido = iso => iso && !Number.isNaN(data(iso).getTime());

/** "18:40" no fuso dado. */
export function hora(iso, fuso) {
  if (!valido(iso)) return '';
  return fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: fuso || undefined }).format(data(iso));
}

/** "2026-11-14" no fuso dado (ou no do aparelho). */
export function diaISO(iso, fuso) {
  if (!valido(iso)) return '';
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit', timeZone: fuso || undefined })
    .formatToParts(data(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** "14 nov" */
export function diaCurto(iso, fuso) {
  if (!valido(iso)) return '';
  const p = Object.fromEntries(fmt({ day: 'numeric', month: 'short', timeZone: fuso || undefined })
    .formatToParts(data(iso)).map(x => [x.type, x.value]));
  return `${p.day} ${String(p.month).replace('.', '')}`;
}

const SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Os 3 dias que dá para acompanhar (R4): hoje, amanhã e +2, no fuso do aparelho. */
export function diasDeBusca(agora = new Date()) {
  return [0, 1, 2].map(n => {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + n, 12);
    return {
      valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      nome: n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : SEMANA[d.getDay()],
      curto: diaCurto(d),
    };
  });
}

/** "hoje", "amanhã", "ontem" ou "14 nov", comparando com hoje no aparelho. */
export function diaRelativo(iso, fuso) {
  const d = diaISO(iso, fuso); if (!d) return '';
  const hoje = new Date(), base = n => diaISO(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n, 12));
  if (d === base(0)) return 'hoje';
  if (d === base(1)) return 'amanhã';
  if (d === base(-1)) return 'ontem';
  return diaCurto(iso, fuso);
}

/** "hoje" / "amanhã" / "sábado" para um valor AAAA-MM-DD da busca. */
export function nomeDoDia(valor) {
  const d = diasDeBusca().find(x => x.valor === valor);
  if (d) {
    if (d.nome === 'Hoje') return 'hoje';
    if (d.nome === 'Amanhã') return 'amanhã';
    const n = d.nome.toLowerCase();
    return (n === 'sábado' || n === 'domingo' ? 'no ' : 'na ') + n;
  }
  const [a, m, dd] = valor.split('-').map(Number);
  return `em ${diaCurto(new Date(a, m - 1, dd, 12))}`;
}

/** Minutos → "3 h 50 min" (ou "3 h 50" no modo curto). */
export function duracao(min, curto = false) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  if (curto) return `${h} h ${String(m).padStart(2, '0')}`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const minutosEntre = (a, b) => (valido(a) && valido(b) ? (data(b) - data(a)) / 60000 : null);

/** Escapa texto que vai para innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const usd = (v, casas = 2) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
