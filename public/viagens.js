/* Voa Aí · viagens com conexão.
   O app guarda voos soltos; uma viagem é deduzida: o voo B continua o voo A quando sai do aeroporto
   onde A chega, até 24 h depois, e os dois são da mesma pessoa (mesmo apelido, ou um deles sem apelido).
   Sem dependências, para rodar no navegador e no node --test. */

const MIN = 60_000;
export const ESCALA_MAX_MIN = 24 * 60;     // mais que isso é outra viagem (ida e volta, por exemplo)
export const CONEXAO_APERTADA_MIN = 45;    // abaixo disso, a troca de avião fica corrida

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const hr = (v) => v?.horarios || {};
const saida = (v) => ms(hr(v).saida_real || hr(v).saida_estimada || hr(v).saida_prevista);
const chegada = (v) => ms(hr(v).chegada_real || hr(v).chegada_estimada || hr(v).chegada_prevista
  || hr(v).pouso_real || hr(v).pouso_estimado || hr(v).pouso_previsto);
const FIM = ['pousou', 'no_portao_destino'];
const PAROU = ['cancelado', 'desviado'];

function mesmaPessoa(a, b) {
  const x = (a.apelido || '').trim().toLowerCase(), y = (b.apelido || '').trim().toLowerCase();
  return !x || !y || x === y;
}

/** B continua A? Devolve os minutos de escala (pela hora estimada) ou null. */
export function continua(a, b) {
  const va = a.voo, vb = b.voo;
  if (!va?.destino?.iata || va.destino.iata !== vb?.origem?.iata) return null;
  if (!mesmaPessoa(a, b)) return null;
  const esc = (saida(vb) - chegada(va)) / MIN;
  // A pode atrasar e "invadir" a saída de B: ainda é a mesma viagem (conexão perdida), até 3 h de sobra.
  if (!Number.isFinite(esc) || esc < -180 || esc > ESCALA_MAX_MIN) return null;
  return esc;
}

/**
 * Junta as inscrições em viagens. Devolve grupos na ordem da 1ª saída:
 * { pernas: [inscrição…] } — um voo solto vira um grupo de uma perna.
 */
export function agruparViagens(inscricoes = []) {
  const itens = inscricoes.filter((i) => i?.voo).slice().sort((a, b) => (saida(a.voo) || 0) - (saida(b.voo) || 0));
  const usado = new Set(), grupos = [];
  for (const i of itens) {
    if (usado.has(i)) continue;
    const pernas = [i]; usado.add(i);
    for (;;) {
      const ult = pernas[pernas.length - 1];
      // a próxima perna é a que sai antes, entre as que continuam a última
      const prox = itens.filter((x) => !usado.has(x) && continua(ult, x) !== null).sort((x, y) => saida(x.voo) - saida(y.voo))[0];
      if (!prox) break;
      pernas.push(prox); usado.add(prox);
    }
    grupos.push({ pernas });
  }
  return grupos;
}

/**
 * Situação da troca de avião entre a perna `a` (voo) e a `b` (voo).
 * risco: 'ok' | 'apertada' | 'perdida'; minutos: escala pela hora estimada.
 */
export function conexao(a, b) {
  const minutos = Math.round((saida(b) - chegada(a)) / MIN);
  const partiu = !!hr(b).saida_real || ['em_voo', ...FIM].includes(b?.estado);
  let risco = 'ok';
  if (PAROU.includes(a?.estado) || PAROU.includes(b?.estado)) risco = 'perdida';
  else if (!partiu && minutos < 0) risco = 'perdida';
  else if (!partiu && !FIM.includes(a?.estado) && minutos < CONEXAO_APERTADA_MIN) risco = 'apertada';
  return { aeroporto: a?.destino, minutos, risco };
}

/**
 * Onde a viagem está agora.
 * { indice, fase: 'antes' | 'voando' | 'conexao' | 'chegou' | 'parou', perna }
 */
export function momentoDaViagem(pernas) {
  const voos = pernas.map((p) => p.voo ?? p);
  const parou = voos.findIndex((v) => PAROU.includes(v.estado));
  if (parou >= 0) return { indice: parou, fase: 'parou', perna: voos[parou] };
  const ativo = voos.findIndex((v) => !FIM.includes(v.estado));
  if (ativo < 0) return { indice: voos.length - 1, fase: 'chegou', perna: voos[voos.length - 1] };
  const v = voos[ativo];
  if (v.estado === 'em_voo') return { indice: ativo, fase: 'voando', perna: v };
  return { indice: ativo, fase: ativo > 0 ? 'conexao' : 'antes', perna: v };
}
