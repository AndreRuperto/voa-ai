# Próximos passos

**Data:** 13/11/2026 · **Branch:** `main` (com o PR #1 `/design` e o PR #2 `/visual-frontend` mergeados)

## Decisão pendente: há duas direções visuais

Duas sessões paralelas desenharam a interface, e as duas estão na `main`:

| | [09 · Direção visual](docs/09-direcao-visual.md) (`/visual-frontend`) | [10 · Design](docs/10-design.md) (`/design`) |
|---|---|---|
| Ideia central | Placa de status na gramática das placas de pista | "Céu noturno, luz de pista" |
| Tema padrão | Segue o sistema (claro "céu de dia" / escuro "céu de noite") | Escuro |
| Cores de estado | Amarelo normal, laranja atraso, vermelho cancelado | Âmbar = ação/destino, azul-céu = em voo |
| Entregável | Protótipo HTML navegável (`prototipo/index.html`) + capturas em `docs/visual/` | Canvas de design (artifact privado) |

Em comum: escolha de data com 3 botões (limite de +2 dias da AeroAPI), passo explicado para o iPhone antes de pedir permissão e o globo da v2 nos mesmos tons noturnos.

## Feito

- **/visual-frontend:** [docs/09-direcao-visual.md](docs/09-direcao-visual.md) com tokens, tipografia (Barlow Semi Condensed + Atkinson Hyperlegible Next), componentes, textos e ponte para a v2. Protótipo navegável com início, erro, confirmação, status (em voo, atrasado, cancelado), link compartilhado e meus voos. Contrastes medidos (texto ≥ 5,46:1, controles ≥ 3,84:1). Sem rolagem lateral em 375 px nem com zoom de 200%.
- **/design:** canvas **[Voa Aí · Design](https://claude.ai/artifact/6LYsBMUph2SRaWdULXAn14)** (privado) com identidade, componentes, 6 telas da v1 e 1 tela da v2. Resumo em [docs/10-design.md](docs/10-design.md).

## Estado

- Nenhuma das duas direções foi validada em aparelho real nem com leitor de tela.
- O código do app ainda não existe.

## Próximos passos

- [ ] Escolher entre o `09` e o `10`, ou juntar os dois, e marcar o outro como substituído
- [ ] Decidir se "Me avisar" substitui "Avisar-me" na [02-v1-alertas.md](docs/02-v1-alertas.md)
- [ ] Desenhar os estados que faltam: desviado, offline, permissão de notificação negada
- [ ] v2: usar a largura toda no desktop (globo de fundo e painéis), sem coluna estreita no centro. Ver [06-v2-3d.md](docs/06-v2-3d.md#aproveitar-a-tela-grande)
- [ ] Exportar os ícones da PWA (192/512 maskable, badge Android)
- [ ] Marco 1 do roadmap: conta AeroAPI e script `scripts/buscar-voo.js`
- [ ] Marco 3: levar os tokens escolhidos para `public/tokens.css`

## Comandos úteis

```bash
python -m http.server 8741 --directory prototipo
```

Abrir `http://localhost:8741/#status` (as portas 5173 e 8765 costumam estar ocupadas nesta máquina; no app, use a configuração `prototipo` em `.claude/launch.json`). Use `?tema=escuro` ou `?tema=claro` para forçar o tema e `?ios=1` para ver o passo do iPhone.
