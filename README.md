# ✈️ Voa Aí

> Saiba quando quem você espera chega.

**Voa Aí** acompanha voos em tempo real: decolagem, atrasos, mudanças de portão e pouso. Usa a [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/).

O nome é um trocadilho: *"tô indo aí"* virou *"voa aí"*.

## Status

📝 **v1 em especificação.** PWA + servidor Node que avisa por push quando o voo decola, atrasa, está chegando e pousa.
💭 **v2:** o avião voando num globo 3D (Three.js).

## Documentação

| # | Documento | Conteúdo |
|---|---|---|
| 01 | [Visão geral](docs/01-visao-geral.md) | Ideia, público, versões e princípios |
| 02 | [v1 · Alertas](docs/02-v1-alertas.md) | Histórias, fluxo, telas, notificações e critérios de aceite |
| 03 | [Arquitetura](docs/03-arquitetura.md) | Componentes, API interna, dados, segurança e deploy |
| 04 | [Integração AeroAPI](docs/04-integracao-aeroapi.md) | Endpoints, alertas e payload do webhook |
| 05 | [Custos](docs/05-custos.md) | Custo por voo, planos e limites |
| 06 | [v2 · 3D](docs/06-v2-3d.md) | Visão da versão 3D |
| 07 | [Decisões](docs/07-decisoes.md) | ADRs |
| 08 | [Roadmap](docs/08-roadmap.md) | Marcos e checklist |
| 09 | [Direção visual](docs/09-direcao-visual.md) | Tokens, tipografia, componentes, telas e o [protótipo](prototipo/index.html) |

### Referência da AeroAPI

- [AeroAPI: referência completa (PDF)](docs/aeroapi/AeroAPI-FlightAware.pdf): endpoints, parâmetros, respostas e preços.
- [Spec OpenAPI oficial](docs/aeroapi/fonte/aeroapi-openapi.yml)
- [Como regenerar o PDF](docs/aeroapi/README.md)

## Configuração

A chave da AeroAPI nunca deve ir para o repositório. Copie `.env.example` para `.env` e preencha. A lista completa de variáveis está em [03-arquitetura.md](docs/03-arquitetura.md#variáveis-de-ambiente).
