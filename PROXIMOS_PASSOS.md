# Próximos passos

**Data:** 14/11/2026 · **Branch:** `claude/admin-contas-rotas` (a partir da `main` com os PRs #1 a #4)

## Decisão tomada: as duas direções visuais foram unidas

A [09 · Direção visual](docs/09-direcao-visual.md) (`/visual-frontend`) e a [10 · Design](docs/10-design.md) (`/design`) foram juntadas na [11 · Visual da v2](docs/11-v2-visual.md):

- **Da 10:** a marca em Bricolage com o ponto âmbar, a paleta "céu noturno, luz de pista" e o tema escuro.
- **Da 09:** a placa de pista como elemento de estado, o Atkinson no texto e no campo, o Barlow na placa e nos horários, e todos os textos da v1.

## Feito

- **v1:** protótipo em [`prototipo/index.html`](prototipo/index.html) (direção 09) e prancha [Voa Aí · Design](https://claude.ai/artifact/6LYsBMUph2SRaWdULXAn14) (direção 10).
- **v2 (esta sessão):** protótipo em [`prototipo/v2/index.html`](prototipo/v2/index.html), com globo 3D em three.js (continentes low-poly, dia e noite, rotas, avião, destino aceso, rótulos em placa, câmera Avião/Destino/Livre, HUD). No desktop, o globo ocupa a tela toda e o painel flutua à esquerda, podendo ser recolhido. No celular, a coluna da v1 continua, com o globo em faixa no status. Telas: início, confirmação, status (em voo, atrasado, cancelado) e meus voos. Capturas em `docs/visual/v2-*.png`.

- **Contas, rotas e admin:** spec em [docs/12-contas-admin-rotas.md](docs/12-contas-admin-rotas.md) (ADR-006 e ADR-007). Prancha com 4 telas novas (versão 14). Protótipo: "Entrar" e "Buscar pela rota" no v2, e painel em [`prototipo/admin/index.html`](prototipo/admin/index.html). Tudo com dados e login simulados.

## Estado

- Testado no navegador em 1600×900 e 375×812: as telas carregam sem erro no console, o painel recolhe e volta, e a câmera troca de modo.
- Não testado: desempenho em celular real, leitor de tela, zoom de 200% na v2.
- Prancha de design atualizada (versão 12) com a junção. Meus voos (v1) ainda mostra pílulas de estado.
- O código do app ainda não existe.

## Próximos passos

- [x] Atualizar a prancha [Voa Aí · Design](https://claude.ai/artifact/6LYsBMUph2SRaWdULXAn14) com a junção da 11 (fontes, placa, trajeto, capturas da v2)
- [ ] Backend: login Google real (precisa de um Client ID no Google Cloud), rotas `/api/admin/*` e tabela `CHAMADA_API`
- [ ] Prancha Admin · Visão geral: trocar "dia 25" por "dia 24" (o cálculo do protótipo dá 24)
- [ ] Levar a placa mini para a prancha de Meus voos (v1), que ainda usa pílulas
- [ ] Levar a v1 (`prototipo/index.html`) para a paleta unificada, ou marcá-la como histórica
- [ ] Testar o globo num celular intermediário (meta de 60 fps)
- [ ] Decidir se "Me avisar" substitui "Avisar-me" na [02-v1-alertas.md](docs/02-v1-alertas.md)
- [ ] Desenhar os estados que faltam: desviado, offline, permissão de notificação negada, pousou/no portão na v2
- [ ] Exportar os ícones da PWA (192/512 maskable, badge Android) a partir da marca da 10
- [ ] Marco 1 do roadmap: conta AeroAPI e script `scripts/buscar-voo.js`
- [ ] Marco 3: levar os tokens da 11 para `public/tokens.css`

## Comandos úteis

```bash
python -m http.server 8741 --directory prototipo
```

- v1: `http://localhost:8741/#status` (`?tema=escuro|claro`, `?ios=1`)
- v2: `http://localhost:8741/v2/#status` (telas: `inicio`, `confirmacao`, `status`, `status-atraso`, `status-cancelado`, `meus-voos`, `rota`, `entrar`)
- admin: `http://localhost:8741/admin/` (o botão do Google simula o login de admin; seções `#visao`, `#voos`, `#contas`, `#rotas`, `#limites`)
- As portas 5173 e 8765 costumam estar ocupadas nesta máquina. No app, use a configuração `prototipo` em `.claude/launch.json`.
- Capturas da v2, com o servidor no ar: `python prototipo/v2/capturas.py docs/visual`. O script usa Playwright com `--use-angle=swiftshader` para o WebGL rodar sem GPU.
