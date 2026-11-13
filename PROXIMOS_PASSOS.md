# Próximos passos

**Data:** 13/11/2026 · **Branch:** `claude/modest-bose-270dbb`

## Feito nesta sessão (/design)

- Lidos todos os docs (`01` a `08`, `aeroapi/README.md`).
- Criado o canvas de design **[Voa Aí · Design](https://claude.ai/artifact/6LYsBMUph2SRaWdULXAn14)** (privado): identidade, componentes, 6 telas da v1 e 1 tela da v2 (globo 3D).
- Resumo e decisões em [docs/10-design.md](docs/10-design.md).

## Estado

- Design: pronto para revisão. Não validado em aparelho real.
- Código do app: ainda não existe.
- `docs/09-direcao-visual.md` é da sessão paralela `/visual-frontend`; conciliar com o `10-design.md` quando as duas terminarem.

## Próximos passos

- [ ] Revisar o canvas e escolher entre esta direção e a do `09-direcao-visual.md` (ou juntar as duas)
- [ ] Exportar ícones da PWA (192/512 maskable, badge Android) a partir do canvas
- [ ] Marco 1 do roadmap: conta AeroAPI e script `scripts/buscar-voo.js`
- [ ] Marco 3: transformar os tokens de `docs/10-design.md` em `public/tokens.css`

## Decisões

- Tema escuro padrão ("céu noturno, luz de pista"), âmbar = ação/destino, azul-céu = em voo.
- Seletor de data com 3 botões (Hoje/Amanhã/+2) por causa do limite de +2 dias da AeroAPI.
- Folha específica para iPhone antes do pedido de permissão de push.
