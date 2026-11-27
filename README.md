# ✈️ Voa Aí

> Saiba quando quem você espera chega.

**Voa Aí** acompanha voos em tempo real: decolagem, atrasos, mudanças de portão e pouso. Usa a [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/).

O nome é um trocadilho: *"tô indo aí"* virou *"voa aí"*.

## Status

✅ **No ar** em [voaai.up.railway.app](https://voaai.up.railway.app): PWA + servidor Node 22 (sem framework) que avisa por Web Push quando o voo decola, atrasa, está chegando e pousa, com o avião num globo 3D (Three.js), login com Google e painel de admin.

A busca ao vivo na AeroAPI está aberta só para convidados (o plano usado é de uso pessoal); para ver o app funcionando sem chave, rode o modo simulado: `npm run simular`.

**Como rodar e testar**

```bash
npm ci
npm run simular   # AeroAPI simulada, sem chave e sem custo (simulacao.env)
npm test          # node --test
```

**Destaques técnicos:** cliente da AeroAPI com novas tentativas e registro de custo por chamada; tetos de gasto mensal e limites por IP e por conta; webhook com segredo comparado em tempo constante e deduplicação; detecção de atraso com histerese; agendador que consulta o voo nos marcos certos quando o plano não tem alertas; CSP estrita e cabeçalhos de segurança.

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
| 09 | [Direção visual](docs/09-direcao-visual.md) | Tokens, tipografia, componentes, telas e o [protótipo v1](prototipo/index.html) |
| 10 | [Design](docs/10-design.md) | Identidade e prancha de design (`/design`) |
| 11 | [Visual da v2](docs/11-v2-visual.md) | Junção da 09 com a 10, globo 3D e tela larga, com o [protótipo v2](prototipo/v2/index.html) |
| 12 | [Contas, rotas e admin](docs/12-contas-admin-rotas.md) | Login Google opcional, busca por rota, painel de admin e o [protótipo do admin](prototipo/admin/index.html) |
| 13 | [Contrato da API](docs/13-api.md) | Rotas, objeto `Voo` e decisões do app real (`server/` + `public/`) |

### Referência da AeroAPI

- AeroAPI: a referência em PDF e a especificação OpenAPI são da FlightAware e ficam fora do repositório; [docs/aeroapi/README.md](docs/aeroapi/README.md) explica como baixar e gerar.
- [Como regenerar o PDF](docs/aeroapi/README.md)

## Configuração

A chave da AeroAPI nunca deve ir para o repositório. Copie `.env.example` para `.env` e preencha. A lista completa de variáveis está em [03-arquitetura.md](docs/03-arquitetura.md#variáveis-de-ambiente).

## Segurança e uso

- Falhas de segurança: veja [SECURITY.md](SECURITY.md) (aviso privado, não abra issue pública).
- **Código aberto para leitura.** Todos os direitos reservados: não há licença de uso, cópia ou redistribuição.
