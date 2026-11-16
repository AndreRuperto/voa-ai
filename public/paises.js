/* Voa Aí · funções puras da escolha de país (sem DOM, testadas em test/paises.test.js). */

/** Bandeira em emoji a partir do código ISO de 2 letras ("BR" → 🇧🇷). A fonte "Bandeiras" (estilo.css) desenha em qualquer sistema. */
export function bandeira(codigo) {
  if (!/^[A-Z]{2}$/.test(codigo || '')) return '';
  return String.fromCodePoint(...[...codigo].map(l => 0x1F1E6 + l.charCodeAt(0) - 65));
}

/** Minúsculas e sem acento, para "japao" achar "Japão". */
export const normalizar = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Filtra pelo nome (sem acento) ou pelo código; quem começa com o termo vem antes de quem só contém. */
export function filtrarPaises(paises, termo) {
  const t = normalizar(termo);
  if (!t) return paises;
  const comeca = [], contem = [];
  for (const p of paises) {
    const n = normalizar(p.nome);
    if (n.startsWith(t) || p.codigo.toLowerCase() === t || n.split(/[\s-]+/).some(w => w.startsWith(t))) comeca.push(p);
    else if (n.includes(t)) contem.push(p);
  }
  return [...comeca, ...contem];
}
