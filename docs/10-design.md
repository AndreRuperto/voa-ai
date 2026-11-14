# 10 · Design visual

> Canvas com a identidade, os componentes e as telas: **[Voa Aí · Design](https://claude.ai/artifact/6LYsBMUph2SRaWdULXAn14)** (Artifact privado; só abre para quem tiver acesso compartilhado pelo menu Share).
> Na v2, esta direção foi unida à [09](09-direcao-visual.md): ver [11 · Visual da v2](11-v2-visual.md).
> Feito em 13/11/2026 com `/design`, a partir de todos os docs de `01` a `08`. A direção visual da sessão paralela (`/visual-frontend`) fica em [09-direcao-visual.md](09-direcao-visual.md).

## Conceito: "Céu noturno, luz de pista"

O app é para quem **espera**. Quem espera está ansioso, muitas vezes à noite, no carro ou no saguão. Então o visual é:

- **Fundo noite** (azul-marinho profundo), tema escuro como padrão. É também o "espaço" onde o globo da v2 vai flutuar, então a v1 já nasce com a cara da v2.
- **Luz de pista (âmbar)** marca o que importa agora: o horário de chegada, o destino e a próxima ação. Um único botão âmbar por tela.
- **Céu (azul-claro)** marca o que está acontecendo: em voo, trecho já percorrido.

### A marca

Wordmark **"Voa Aí"** em Bricolage Grotesque 800. O **acento do "í" é um ponto âmbar aceso**: o destino, a luz que espera o avião. Uma trajetória tracejada em azul-céu vem de longe até esse ponto. O ícone do app repete só o arco e o ponto, sem texto, e funciona como badge de push.

## Princípios

1. **Calma primeiro.** Uma informação por vez. Vermelho só para cancelamento.
2. **O horário é o herói.** A hora de chegada, no fuso do destino, é o maior texto da tela de status (mono, 88 px).
3. **Gente antes de código.** O apelido ("Mãe") é o título; `TAP103` é detalhe.
4. **Do painel ao globo.** As cores e os papéis valem igual em 2D e em 3D.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `--noite-950` | `#0B1426` | fundo |
| `--noite-900` | `#12203A` | cartões, folhas |
| `--noite-800` | `#1B2D4F` | campos de texto |
| `--borda` | `#2A3F66` | bordas, trilhos futuros |
| `--texto` | `#F2F5FA` | texto principal |
| `--texto-2` | `#A9B6CC` | texto secundário (9,6:1 no fundo) |
| `--pista` | `#FFB547` | ação primária, destino, hora de chegada. Só com texto `#0B1426` |
| `--ceu` | `#5CC8FF` | em voo, rota percorrida, avião |
| `--pousou` | `#5EE6A8` | pousou, no portão |
| `--atraso` | `#FF8A65` | atraso, desvio |
| `--cancelado` | `#FF6B7A` | cancelado |

Estados sempre levam **cor + ícone + palavra** ("Atrasado 35 min"), nunca só cor.

**Tipografia** (Google Fonts):

| Papel | Fonte | Tamanhos |
|---|---|---|
| Títulos | Bricolage Grotesque 700/800 | 40 / 34 / 28 / 22 |
| Texto | Inter 400/600 | 16 corpo, 13 mínimo |
| Horários e códigos | JetBrains Mono 500/700 | 88 (hora de chegada), 26 (IATA), 15 (linha do tempo) |

**Forma e movimento:** raio 12 (chips de data), 14 (botões), 16 (cartões), 20+ (folhas), pílula (estados). Espaço em múltiplos de 4, margem lateral de 20 px. Alvo de toque mínimo de 52 px. Transições de 200 ms; o ponto "agora" pulsa a cada 2 s e para com `prefers-reduced-motion`. Foco: anel âmbar de 3 px.

**Ícones:** traço de 2 px, grade de 24, um por evento da AeroAPI (`out` portão, `off` decolagem, `eta` ampulheta, `on` pouso, `in` check, atraso relógio, `cancelled` x, `diverted` alerta). Emojis só no texto do push, como em [02-v1-alertas.md](02-v1-alertas.md#notificações).

## Telas no canvas

| Prancha | O que mostra | Decisões que vieram dos docs |
|---|---|---|
| Identidade | marca, princípios, cores, estados, tipografia, ícones, voz | mensagens humanas em PT-BR (princípio 3 da visão) |
| Componentes | botões, campo do voo, seletor de data, cartão de candidato, linha do tempo, avisos, item de lista, push | — |
| 1 · Início | "Quem você está esperando?", campo do voo, data, **Acompanhar** | data em **3 botões (Hoje, Amanhã, +2)** em vez de calendário, porque a AeroAPI só busca até +2 dias (R4). Rodapé de privacidade (sem cadastro, apagamos em 7 dias) |
| 2 · Confirmação | trechos encontrados, apelido opcional, **Avisar-me** | origem/destino em IATA grande para escolher o trecho certo (H2); prévia de como o apelido aparece no aviso (H3) |
| 2b · iPhone | folha explicando "Adicionar à Tela de Início" em 3 passos antes de pedir permissão | Web Push no iOS 16.4+ só com a PWA instalada (arquitetura, Observações sobre iOS) |
| 3 · Status | apelido + estado, **hora de chegada gigante** no fuso do destino, barra de rota, aviso de atraso com "saia por volta de", linha do tempo, Ver no globo (v2), Mandar para a família, Parar | timeline Previsto → Decolou → Em voo → Pousou → No portão (H5); compartilhar (H7); parar (H6) |
| 4 · Notificações | tela de bloqueio com o histórico de pushes de um voo | título = o que aconteceu com o apelido; corpo = hora local do destino |
| 5 · Meus voos | lista com contador "3 de 5" e remover arrastando | limite de 5 voos por aparelho (R5) |
| v2 · Globo 3D | globo low-poly com terminador dia/noite, rota (sólida no voado, tracejada no resto), avião, câmeras Seguir/Destino/Livre, HUD com altitude, velocidade e tempo restante | posição **estimada** (texto diz isso), coerente com a estratégia de 1× `/track` + interpolação de [05-custos.md](05-custos.md#v2-3d-atenção-ao-custo) |

O link compartilhado `/v/:fa_flight_id` abre a tela de Status com um botão **Avisar-me também** no lugar de "Parar de acompanhar".

## Ponte para a v2 (3D)

- A linguagem da linha do tempo (passado sólido, agora com halo, futuro tracejado) é a mesma da rota no globo.
- No Three.js: rota percorrida `#5CC8FF`, restante tracejado `#F2F5FA` a 70%, destino `#FFB547` com brilho, oceano/terra nos tons `noite-900/800`, céu de fundo `#05090F`.
- O botão "Ver no globo" já existe na tela de Status da v1 (marcado como v2), então o 3D entra sem mudar a navegação. A cena carrega por import dinâmico só nessa tela.

## Em aberto

- Tema claro: não desenhado. O escuro é o padrão; avaliar claro só se houver pedido.
- Fonte: Bricolage, Inter e JetBrains Mono vêm do Google Fonts. Para a PWA offline, servir os arquivos `woff2` localmente no `public/`.
- Ícones de app em PNG (192/512, maskable) e badge monocromático do Android ainda precisam ser exportados a partir do canvas.
- Validar contraste e alvos de toque no app real (as pranchas seguem 4,5:1 e 52 px, mas não foram medidas em aparelho).
