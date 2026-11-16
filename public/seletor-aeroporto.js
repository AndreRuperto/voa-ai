/* Voa Aí · buscar aeroporto digitando (cidade, nome ou código IATA) dentro do país escolhido.
   A grade de cartões continua como atalho: escolher aqui só marca o cartão correspondente.
   Padrão de acessibilidade: combobox + listbox (WAI-ARIA APG), com o total de resultados anunciado num role="status". */
import { esc } from '/formato.js';
import { filtrarAeroportos, rotuloAeroporto, textoResultados } from '/aeroportos.js';

/** Quantos resultados mostrar de uma vez (o Brasil tem dezenas de aeroportos). */
const MAX_VISTOS = 30;

/**
 * Uso: `const b = new BuscaAeroporto(div)`; `b.definirAeroportos(lista)` (ou `[]` para esconder);
 * `b.addEventListener('escolha', e => e.detail.iata)`; `b.anunciar('texto')`.
 */
export class BuscaAeroporto extends EventTarget {
  #raiz; #campo; #lista; #status; #aeros = []; #vistos = []; #ativo = -1; #aberta = false; #marcados = () => [];

  /** `marcados`: devolve os códigos já marcados na grade (para mostrar o ✓ na lista). */
  constructor(raiz, marcados) {
    super();
    this.#raiz = raiz;
    this.#campo = raiz.querySelector('input');
    this.#lista = raiz.querySelector('[role="listbox"]');
    this.#status = raiz.querySelector('[role="status"]');
    if (marcados) this.#marcados = marcados;
    const c = this.#campo;
    c.addEventListener('input', () => this.#filtrar());
    c.addEventListener('keydown', e => this.#tecla(e));
    raiz.addEventListener('focusout', e => { if (!raiz.contains(e.relatedTarget)) this.#fechar(); });
    // mousedown na lista não tira o foco do campo (senão o focusout fecha antes do clique)
    this.#lista.addEventListener('mousedown', e => e.preventDefault());
    this.#lista.addEventListener('click', e => {
      const li = e.target.closest('[role="option"][data-iata]');
      if (li) this.#escolher(this.#aeros.find(a => a.iata === li.dataset.iata));
    });
  }

  /** Aeroportos do país escolhido; lista vazia esconde o campo. */
  definirAeroportos(aeros) {
    this.#aeros = aeros || [];
    this.#fechar();
    this.#campo.value = '';
    this.#status.textContent = '';
    this.#raiz.hidden = !this.#aeros.length;
  }

  /** Mensagem para quem usa leitor de tela (ex.: limite de combinações). */
  anunciar(texto) { this.#status.textContent = texto; }

  #filtrar() {
    const termo = this.#campo.value;
    if (!termo.trim()) { this.#fechar(); this.#status.textContent = ''; return; }
    const achados = filtrarAeroportos(this.#aeros, termo);
    this.#vistos = achados.slice(0, MAX_VISTOS);
    this.#ativo = this.#vistos.length ? 0 : -1;
    const marcados = new Set(this.#marcados());
    const id = this.#lista.id;
    this.#lista.innerHTML = this.#vistos.length
      ? this.#vistos.map((a, i) => `<li role="option" id="${id}-${esc(a.iata)}" data-iata="${esc(a.iata)}" aria-selected="${i === this.#ativo}"${marcados.has(a.iata) ? ' class="escolhido"' : ''}><b>${esc(a.iata)}</b><span>${esc(rotuloAeroporto(a))}</span>${marcados.has(a.iata) ? '<span class="sr">, já marcado</span>' : ''}</li>`).join('')
      : `<li class="pais__vazio" role="option" aria-disabled="true" aria-selected="false">Nenhum aeroporto com “${esc(termo.trim())}” neste país</li>`;
    this.#lista.hidden = false;
    this.#campo.setAttribute('aria-expanded', 'true');
    this.#aberta = true;
    this.#marcarAtivo();
    this.#lista.scrollTop = 0;
    this.#status.textContent = textoResultados(achados.length, termo);
  }

  #fechar() {
    if (!this.#aberta) return;
    this.#aberta = false;
    this.#lista.hidden = true;
    this.#campo.setAttribute('aria-expanded', 'false');
    this.#campo.removeAttribute('aria-activedescendant');
  }

  #marcarAtivo() {
    const itens = this.#lista.querySelectorAll('[role="option"][data-iata]');
    itens.forEach((li, i) => li.setAttribute('aria-selected', String(i === this.#ativo)));
    const li = itens[this.#ativo];
    if (!li) { this.#campo.removeAttribute('aria-activedescendant'); return; }
    this.#campo.setAttribute('aria-activedescendant', li.id);
    // rola só a lista, sem mexer na página
    const l = this.#lista;
    if (li.offsetTop < l.scrollTop) l.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = li.offsetTop + li.offsetHeight - l.clientHeight;
  }

  #escolher(a) {
    if (!a) return;
    this.#fechar();
    this.#campo.value = '';
    this.#status.textContent = '';
    this.dispatchEvent(new CustomEvent('escolha', { detail: { iata: a.iata, aeroporto: a } }));
  }

  #tecla(e) {
    const n = this.#vistos.length;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowUp':
        if (!this.#aberta) { if (this.#campo.value.trim()) { e.preventDefault(); this.#filtrar(); } return; }
        e.preventDefault();
        if (!n) return;
        this.#ativo = (this.#ativo + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.#marcarAtivo();
        return;
      case 'Home': case 'End':
        if (!this.#aberta || !n) return;
        e.preventDefault();
        this.#ativo = e.key === 'Home' ? 0 : n - 1;
        this.#marcarAtivo();
        return;
      case 'Enter':
        // não envia o formulário enquanto o campo tem texto
        if (this.#aberta || this.#campo.value.trim()) e.preventDefault();
        if (this.#aberta) this.#escolher(this.#vistos[this.#ativo]);
        return;
      case 'Escape':
        if (this.#aberta || this.#campo.value) { e.preventDefault(); this.#fechar(); this.#campo.value = ''; this.#status.textContent = ''; }
        return;
    }
  }
}
