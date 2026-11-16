/* Voa Aí · funções puras da busca de aeroporto (sem DOM, testadas em test/aeroportos.test.js). */
import { normalizar } from './paises.js';

const palavras = s => normalizar(s).split(/[\s\-/,.()]+/).filter(Boolean);

/**
 * Filtra aeroportos pelo código IATA, pelo nome ou pela cidade, sem acento.
 * Ordem: código exato, depois quem tem uma palavra (ou o código) começando com o termo, depois quem só contém.
 * Dentro de cada grupo mantém a ordem recebida (a de movimento).
 */
export function filtrarAeroportos(aeroportos, termo) {
  const t = normalizar(termo);
  if (!t) return aeroportos;
  const exato = [], comeca = [], contem = [];
  for (const a of aeroportos) {
    const iata = normalizar(a.iata);
    if (iata === t) { exato.push(a); continue; }
    const textos = [a.nome, a.cidade].map(normalizar);
    if (iata.startsWith(t) || textos.some(x => x.startsWith(t)) || [a.nome, a.cidade].flatMap(palavras).some(w => w.startsWith(t))) comeca.push(a);
    else if (textos.some(x => x.includes(t))) contem.push(a);
  }
  return [...exato, ...comeca, ...contem];
}

/** "Guarulhos, São Paulo"; só "Salvador" quando nome e cidade são iguais. */
export function rotuloAeroporto(a) {
  const nome = a?.nome || '', cidade = a?.cidade || '';
  if (!nome) return cidade;
  if (!cidade || normalizar(cidade) === normalizar(nome)) return nome;
  return `${nome}, ${cidade}`;
}

/** Frase do anúncio (aria-live) depois de filtrar. */
export function textoResultados(n, termo) {
  if (!n) return `Nenhum aeroporto com “${String(termo || '').trim()}”.`;
  return `${n} ${n === 1 ? 'aeroporto' : 'aeroportos'}. Use as setas e Enter para marcar.`;
}
