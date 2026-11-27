# 01 · Visão geral

## A ideia

**Voa Aí** avisa quem está esperando alguém chegar de avião.

Você digita o número do voo de quem vem visitar, buscar ou encontrar. O app manda uma notificação no celular quando o voo **decola**, **atrasa**, **está chegando** e **pousa**. Ninguém precisa ficar abrindo site de companhia aérea nem perguntando "já pousou?".

O nome brinca com o *"tô indo aí"*: a pessoa está **voando aí**, até você.

> Slogan: **"Saiba quando quem você espera chega."**

## Para quem é

| Persona | Situação | O que precisa |
|---|---|---|
| **Quem busca no aeroporto** | Vai buscar a mãe em Guarulhos | Saber a hora certa de sair de casa e se houve atraso |
| **Quem espera em casa** | O namorado volta de viagem | Saber que ele decolou e pousou bem |
| **Quem viaja** | Quer tranquilizar a família | Compartilhar o voo para que outros acompanhem |

## Versões

| Versão | Entrega | Status |
|---|---|---|
| **v1 · Alertas** | PWA no celular: cadastra o voo e recebe push de decolagem, atraso, aproximação e pouso | ✅ No ar |
| **v2 · 3D** | O avião voando num globo 3D (Three.js) com a rota real, no estilo do [escrithorius-3d](https://github.com/AndreRuperto/escrithorius-3d) | 💭 Visão: [06-v2-3d.md](06-v2-3d.md) |

## Princípios

1. **Zero atrito para quem espera.** Abre o link, digita o voo, permite notificações. Sem cadastro na v1.
2. **Barato de operar.** Alertas por webhook em vez de consultas repetidas. Cada chamada da AeroAPI é paga (ver [05-custos.md](05-custos.md)).
3. **Mensagens humanas, em português.** "O voo da Ana decolou de Lisboa 🛫", e não "event_code: off".
4. **Base pronta para o 3D.** Mesma stack (JavaScript + Node) e o mesmo app web, para o Three.js entrar sem reescrever nada.

## Fora do escopo da v1

- Contas de usuário e login
- Compra de passagens, check-in ou informações de bagagem
- Rastreamento de voos sem número (aviação geral por matrícula fica para depois)
- App nativo nas lojas: a PWA instalável cobre o caso

## Documentos

| # | Documento | Conteúdo |
|---|---|---|
| 01 | [Visão geral](01-visao-geral.md) | Este documento |
| 02 | [v1 · Alertas](02-v1-alertas.md) | Histórias, fluxos, notificações e critérios de aceite |
| 03 | [Arquitetura](03-arquitetura.md) | Componentes, API interna, dados, segurança e deploy |
| 04 | [Integração AeroAPI](04-integracao-aeroapi.md) | Endpoints usados, alertas, payload do webhook |
| 05 | [Custos](05-custos.md) | Custo por voo, escolha de plano e limites |
| 06 | [v2 · 3D](06-v2-3d.md) | Visão da versão 3D |
| 07 | [Decisões](07-decisoes.md) | Registro das decisões de arquitetura |
| 08 | [Roadmap](08-roadmap.md) | Marcos e checklist |
| 09 | [Direção visual](09-direcao-visual.md) | Tokens, tipografia, componentes e telas da v1 |
| — | [AeroAPI (como gerar o PDF)](aeroapi/README.md) | Referência completa da API |
