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

**Status:** aceita · 13/11/2026 · no plano Personal, substituída pela [ADR-009](#adr-009--plano-personal-o-agendador-consulta-o-voo)

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

---

## ADR-006 · Conta Google opcional

**Status:** aceita · 14/11/2026

**Contexto.** A v1 foi pensada sem cadastro (zero atrito). Surgiu a necessidade de ver os voos em mais de um aparelho, de dar limites maiores a quem se identifica e de ter um painel de admin protegido.

**Decisão.** Login com Google, **opcional**, via Google Identity Services e ID token validado no servidor. Acompanhar um voo e abrir um link compartilhado continuam sem login. O admin exige Google e um e-mail na lista `ADMIN_EMAILS`.

**Consequências.** Entram as tabelas `USUARIO`, `SESSAO` e `APARELHO`. A R5 vira "5 por aparelho sem conta, 15 por conta". Passamos a guardar e-mail e nome de quem entra, e "Minha conta" precisa permitir apagar tudo. Detalhes em [12](12-contas-admin-rotas.md).

---

## ADR-007 · Busca por rota de aeroporto a aeroporto

**Status:** aceita · 14/11/2026

**Contexto.** Pedido para acompanhar voos "de país para país". A AeroAPI só busca entre dois aeroportos (`/airports/{id}/flights/to/{dest_id}`, US$ 0,050 por conjunto de resultados). Assinar todos os voos de uma rota custaria US$ 0,10 por voo, dezenas por dia.

**Decisão.** A busca por rota serve para **achar e escolher um voo**, não para assinar a rota. O país é um filtro de interface para escolher os aeroportos; cada busca usa no máximo 3 pares, com cache de 30 min por par e dia, limite diário por pessoa e um interruptor no admin.

**Consequências.** Uma busca típica custa US$ 0,05. A lista de países e aeroportos fica no nosso banco. Seguir uma rota inteira fica fora do escopo até haver plano pago e demanda.

---

## ADR-008 · Viagem com conexão deduzida dos voos acompanhados

**Status:** aceita · 15/11/2026

**Contexto.** Quem vem do Japão passando por Dubai faz dois voos. O app acompanhava cada voo solto: dois cartões sem relação, dois aviões e rótulos sobrepostos no aeroporto da escala, e nada dizia se a troca de avião estava em risco.

**Decisão.** A viagem é **deduzida**, não cadastrada: o voo B continua o A quando sai do aeroporto onde A chega, até 24 h depois, e é da mesma pessoa (mesmo apelido, ou um sem apelido). Em Meus voos, as pernas viram um cartão de viagem com a frase de onde ela está e a conexão entre os trechos (escala, apertada abaixo de 45 min, pode perder). No status, uma seção mostra todos os trechos; no globo, o que já voou fica como rastro, o que falta como tracejado, com um rótulo só por viagem.

**Consequências.** Nenhuma mudança na API e nenhum custo extra na AeroAPI. Cada perna continua com seus avisos. O agendador repete a dedução no servidor (mesmo `public/viagens.js`) e avisa por push quando a conexão fica pior que a planejada: apertada, depois pode perder, e uma vez quando volta ao normal. Uma conexão vendida apertada pela companhia não gera aviso; cancelado e desviado ficam com o aviso do próprio voo. Uma ida e volta no mesmo dia, com o mesmo apelido e menos de 24 h de intervalo, seria lida como conexão.

---

## ADR-009 · Plano Personal: o agendador consulta o voo

**Status:** aceita · 19/11/2026

**Contexto.** Com a chave ativa, a AeroAPI recusou `POST /alerts`, `GET /alerts` e `/flights/{ident}/canonical` com 401 e a frase "Alerts and Historical data are only available on Standard and Premium tiers". O plano Personal não tem alertas, então a ADR-003 não vale nele. `/flights/{ident}`, `/flights/{id}` e `/airports/{id}/flights/to/{dest}` respondem normalmente.

**Decisão.** O cliente descobre o plano na primeira recusa (`aeroapi_plano`) e deixa de tentar alertas e `/canonical` até o servidor reiniciar. `AEROAPI_ALERTAS=0` força esse modo e `=1` ignora a descoberta. Sem `/canonical`, a busca usa o número como veio: `/flights/TP103` acha o TAP103. Sem alerta, a inscrição funciona com `alert_id` vazio e o agendador consulta o voo (`intervaloDeConsulta`):

| Fase | Intervalo |
|---|---|
| Mais de 20 min antes da saída | só os marcos de 3 h, 1 h e 15 min |
| Da saída −20 min até +1 h, sem decolar | 10 min |
| Atraso longo sem decolar (até 12 h) | 30 min |
| Voando, até 40 min antes do pouso | 45 min |
| Perto do pouso (até 2 h depois do previsto) | 10 min |
| Pousou, esperando o portão (até 90 min; desligado no modo econômico) | 10 min |
| Chegou ao portão ou cancelado | para |

Qualquer atualização do voo conta, inclusive a de quem abre a página dele, então ninguém paga duas consultas seguidas. Os avisos olham o **estado**, não a diferença: decolou, pousou, chegou ao portão, cancelado e desviado saem uma vez cada (mesma chave da rede de segurança), e só para eventos depois da primeira inscrição.

**Consequências.**

- O aviso pode chegar até ~10 min depois do evento, contra segundos no webhook.
- O custo é parecido com o dos alertas: ~14 consultas (US$ 0,07) num voo de 2 h e ~25 (US$ 0,13) num de 12 h, contra ~US$ 0,08 em alertas. O crédito de US$ 5/mês segue cerca de 50 voos curtos.
- O limite do Personal é de 10 consultas/min; o cliente já espera e tenta de novo no 429.
- Recusas 401/403 ficam no painel com custo zero.
- Se a conta passar para o Standard, basta reiniciar o servidor: os alertas voltam a ser criados sem mudar código.

