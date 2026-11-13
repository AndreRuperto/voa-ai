# 07 · Registro de decisões

Formato curto de ADR (*Architecture Decision Record*). Cada decisão tem contexto, escolha e consequências. Decisões novas entram no fim. Uma decisão substituída é marcada, nunca apagada.

---

## ADR-001 · PWA com servidor Node, em vez de app nativo ou bot

**Status:** aceita · 13/11/2026

**Contexto.** A v1 precisa notificar o celular de quem espera. A v2 será 3D com Three.js.

**Opções.**
| Opção | Prós | Contras |
|---|---|---|
| **PWA + Node** | Sem loja, push gratuito, Three.js nativo no navegador, uma base de código só | iOS só recebe push com a PWA na tela inicial |
| App nativo (React Native/Flutter) | Push mais confiável no iOS | Lojas, revisão, duas plataformas, 3D mais trabalhoso |
| Bot WhatsApp | Todo mundo usa | API da Meta paga, aprovação de templates, sem caminho para o 3D |
| Bot Telegram | Grátis e simples | Pouco usado no Brasil por esse público, sem caminho para o 3D |

**Decisão.** PWA + servidor Node.

**Consequências.** É preciso ensinar o usuário de iPhone a instalar a PWA. Um canal extra (Telegram, e-mail) pode ser adicionado depois como opção de entrega.

---

## ADR-002 · JavaScript puro (sem TypeScript e sem framework de front)

**Status:** aceita · 13/11/2026

**Contexto.** O escrithorius-3d usa JavaScript + Three.js. O RepoPrint usa TypeScript.

**Decisão.** JavaScript (ES modules) no front e no servidor, com JSDoc nos pontos críticos. Front sem React ou Vue.

**Consequências.** Menos ferramentas e build mais simples. O Three.js entra sem adaptação, e o código do escrithorius pode ser reaproveitado. Migrar para TypeScript continua possível arquivo a arquivo (`// @ts-check` + JSDoc).

---

## ADR-003 · Alertas por webhook em vez de polling

**Status:** aceita · 13/11/2026

**Contexto.** Consultar o status a cada minuto custaria cerca de US$ 3 a US$ 6 por voo. Alertas entregues custam US$ 0,020 cada.

**Decisão.** Usar os alertas da AeroAPI (`POST /alerts`) com webhook. Polling só em momentos pontuais: 3 checagens antes da decolagem e 1 de segurança depois da chegada prevista.

**Consequências.** O servidor precisa de URL pública com HTTPS (Railway). Como a AeroAPI não assina os callbacks, o webhook usa um segredo na URL. O custo fica em cerca de US$ 0,10 por voo.

---

## ADR-004 · Um alerta por voo, compartilhado entre inscritos

**Status:** aceita · 13/11/2026

**Decisão.** A tabela `VOO` guarda o `alert_id`. Novas inscrições no mesmo `fa_flight_id` reutilizam o alerta existente.

**Consequências.** O custo não cresce com o número de pessoas por voo. O alerta só é apagado quando sai o último inscrito ou o voo termina.

---

## ADR-005 · SQLite no servidor

**Status:** aceita · 13/11/2026

**Decisão.** SQLite (`better-sqlite3`) em volume persistente do Railway.

**Consequências.** Zero infraestrutura extra. O limite é uma instância de servidor só, o que basta para a v1. Se precisar escalar horizontalmente, migrar para Postgres.
