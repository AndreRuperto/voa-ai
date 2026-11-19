/* Voa Aí · escolha de país com bandeira e busca.
   Substitui o <select> nativo: ele não mostra imagem e o navegador abre a lista do tamanho que quiser
   (às vezes até o topo do monitor). Aqui a lista abre logo abaixo do campo, com altura limitada,
   e dá para digitar para filtrar ("jap" → Japão). Padrão de acessibilidade: combobox + listbox (WAI-ARIA APG). */
import { esc } from '/formato.js';
import { bandeira, normalizar, filtrarPaises } from '/paises.js';

/**
 * Campo de país. Uso: `const s = new SeletorPais(div)`; `s.definirPaises(lista)`; `s.value = 'BR'`;
 * `s.addEventListener('change', …)` dispara só quando a pessoa escolhe outro país.
 */
export class SeletorPais extends EventTarget {
  #raiz; #campo; #lista; #flag; #paises = []; #vistos = []; #ativo = -1; #atual = null; #aberta = false;

  constructor(raiz) {
    super();
    this.#raiz = raiz;
    this.#campo = raiz.querySelector('input');
    this.#lista = raiz.querySelector('[role="listbox"]');
    this.#flag = raiz.querySelector('.pais__bandeira');
    const c = this.#campo;
    let acabouDeFocar = false;
    c.addEventListener('focus', () => { acabouDeFocar = true; this.#abrir(''); });
    // o mouseup do clique que deu foco desfaria a seleção do texto (e digitar emendaria no nome atual)
    c.addEventListener('mouseup', e => { if (acabouDeFocar) e.preventDefault(); acabouDeFocar = false; });
    c.addEventListener('click', () => { if (!this.#aberta) this.#abrir(''); });
    c.addEventListener('input', () => this.#abrir(c.value));
    c.addEventListener('keydown', e => { acabouDeFocar = false; this.#tecla(e); });
    raiz.addEventListener('focusout', e => { if (!raiz.contains(e.relatedTarget)) this.#fechar(); });
    // mousedown na lista não tira o foco do campo (senão o focusout fecha antes do clique)
    this.#lista.addEventListener('mousedown', e => e.preventDefault());
    this.#lista.addEventListener('click', e => {
      const li = e.target.closest('[role="option"][data-codigo]');
      if (li) this.#escolher(this.#paises.find(p => p.codigo === li.dataset.codigo));
    });
    raiz.querySelector('.pais__seta')?.addEventListener('mousedown', e => {
      e.preventDefault();
      if (this.#aberta) this.#fechar(); else { c.focus(); this.#abrir(''); }
    });
  }

  get value() { return this.#atual?.codigo || ''; }
  set value(codigo) { this.#atual = this.#paises.find(p => p.codigo === codigo) || null; this.#mostrarAtual(); }

  /** Lista já ordenada para exibição. */
  definirPaises(paises) {
    this.#paises = paises;
    this.#campo.disabled = false;
    this.#campo.placeholder = this.#raiz.dataset.placeholder || 'Escolha ou digite o país';
    this.#raiz.classList.remove('pais--erro');
    this.#mostrarAtual();
  }

  /** Sem lista (servidor fora do ar, por exemplo): campo travado com o motivo. */
  indisponivel(texto) {
    this.#fechar();
    this.#paises = []; this.#atual = null;
    this.#campo.disabled = true; this.#campo.value = ''; this.#campo.placeholder = texto;
    this.#raiz.classList.add('pais--erro');
    this.#flag.textContent = '';
  }

  #mostrarAtual() {
    this.#campo.value = this.#atual?.nome || '';
    this.#flag.textContent = bandeira(this.#atual?.codigo);
    this.#raiz.classList.toggle('pais--com-bandeira', !!bandeira(this.#atual?.codigo));   // aeroporto (código de 3 letras) não tem bandeira
  }

  #abrir(termo) {
    if (this.#campo.disabled || !this.#paises.length) return;
    const filtrando = !!normalizar(termo);
    this.#vistos = filtrarPaises(this.#paises, termo);
    // lista inteira: começa no país escolhido; filtrando: no primeiro que bate
    this.#ativo = filtrando ? (this.#vistos.length ? 0 : -1) : Math.max(0, this.#vistos.indexOf(this.#atual));
    if (!filtrando && !this.#aberta) this.#campo.select();
    this.#raiz.classList.toggle('pais--com-bandeira', !filtrando && !!bandeira(this.#atual?.codigo));
    this.#flag.textContent = filtrando ? '' : bandeira(this.#atual?.codigo);
    this.#lista.innerHTML = this.#vistos.length
      ? this.#vistos.map((p, i) => `<li role="option" id="${this.#lista.id}-${esc(p.codigo)}" data-codigo="${esc(p.codigo)}" aria-selected="${i === this.#ativo}"${p === this.#atual ? ' class="escolhido"' : ''}><span class="bandeira" aria-hidden="true">${bandeira(p.codigo)}</span><span>${esc(p.nome)}</span></li>`).join('')
      : `<li class="pais__vazio" role="option" aria-disabled="true" aria-selected="false">Nenhum país com “${esc(termo.trim())}”</li>`;
    this.#lista.hidden = false;
    this.#campo.setAttribute('aria-expanded', 'true');
    const primeiraVez = !this.#aberta;
    this.#aberta = true;
    this.#marcarAtivo(primeiraVez ? 'center' : 'nearest');
    // no painel que rola (ou na página, no celular), traz a lista inteira para a vista
    if (primeiraVez) this.#lista.scrollIntoView({ block: 'nearest' });
  }

  #fechar() {
    if (!this.#aberta) return;
    this.#aberta = false;
    this.#lista.hidden = true;
    this.#campo.setAttribute('aria-expanded', 'false');
    this.#campo.removeAttribute('aria-activedescendant');
    this.#mostrarAtual();   // texto digitado sem escolher volta para o país atual
  }

  #marcarAtivo(onde = 'nearest') {
    const itens = this.#lista.querySelectorAll('[role="option"][data-codigo]');
    itens.forEach((li, i) => li.setAttribute('aria-selected', String(i === this.#ativo)));
    const li = itens[this.#ativo];
    if (li) {
      this.#campo.setAttribute('aria-activedescendant', li.id);
      // rola só a lista, sem mexer na página
      const l = this.#lista;
      if (onde === 'center') l.scrollTop = li.offsetTop - (l.clientHeight - li.offsetHeight) / 2;
      else if (li.offsetTop < l.scrollTop) l.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = li.offsetTop + li.offsetHeight - l.clientHeight;
    } else this.#campo.removeAttribute('aria-activedescendant');
  }

  #escolher(p) {
    if (!p) return;
    const mudou = p !== this.#atual;
    this.#atual = p;
    this.#fechar();
    this.#mostrarAtual();
    if (mudou) this.dispatchEvent(new Event('change'));
  }

  #tecla(e) {
    const n = this.#vistos.length;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowUp': {
        e.preventDefault();
        if (!this.#aberta) { this.#abrir(''); return; }
        if (!n) return;
        const passo = e.key === 'ArrowDown' ? 1 : -1;
        this.#ativo = Math.min(n - 1, Math.max(0, this.#ativo + passo));
        this.#marcarAtivo();
        return;
      }
      case 'PageDown': case 'PageUp':
        if (!this.#aberta || !n) return;
        e.preventDefault();
        this.#ativo = Math.min(n - 1, Math.max(0, this.#ativo + (e.key === 'PageDown' ? 8 : -8)));
        this.#marcarAtivo();
        return;
      case 'Enter':
        if (!this.#aberta) return;
        e.preventDefault();   // não envia o formulário
        this.#escolher(this.#vistos[this.#ativo]);
        return;
      case 'Escape':
        if (this.#aberta) { e.preventDefault(); this.#fechar(); this.#campo.select(); }
        return;
      case 'Tab':
        // digitou e saiu com Tab: fica com o primeiro que bateu (como um autocompletar)
        if (this.#aberta && normalizar(this.#campo.value) !== normalizar(this.#atual?.nome)) this.#escolher(this.#vistos[this.#ativo]);
        return;
    }
  }
}
