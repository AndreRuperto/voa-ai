# 09 · Direção visual

> Status: **proposta para a v1**, com o caminho da v2 (3D) já previsto.
> Protótipo navegável: [`prototipo/index.html`](../prototipo/index.html). Capturas verificadas em [`docs/visual/`](visual/).

## O assunto

| Pergunta | Resposta |
|---|---|
| **O que é** | Um app que avisa quando o voo de alguém decola, atrasa, está chegando e pousa ([01](01-visao-geral.md)) |
| **Trabalho principal da tela** | Responder em 2 segundos: *"já pousou? a que horas chega? mudou alguma coisa?"* |
| **Quem usa e como** | Quem espera, no celular: em casa, no carro, no saguão de desembarque. Humor entre ansioso e impaciente. Muitas vezes é uma pessoa mais velha esperando um filho, ou o contrário |
| **De onde vem o vocabulário** | Das **placas de pista e de pátio dos aeroportos**: o sistema de sinalização mais legível que existe, feito para ser lido de relance, de longe, com pressa |

### O princípio

> **O único lugar ousado é a placa de status.** Ela segue a gramática real das placas de pista; todo o resto é quieto, claro e disciplinado.

As placas de aeroporto têm cores com significado fixo, e o Voa Aí herda esse significado:

| Placa real | Significado no aeroporto | No Voa Aí |
|---|---|---|
| Fundo preto, texto e borda amarelos | **Posição:** "você está aqui" | Identifica o voo (`TP103`) e a marca |
| Fundo amarelo, texto preto | **Direção:** para onde ir | Estado normal: *Previsto, Em voo, Pousou, No portão* |
| Fundo laranja | **Temporário:** obra, aviso provisório | **Atraso:** `+35 min` |
| Fundo vermelho, texto branco | **Obrigatório:** pare | **Cancelado, Desviado** |

A placa é composta em painéis lado a lado, como as placas de pista de verdade: `[ TP103 | Atrasado, chega 19:15 | +35 min ]`. A cor nunca é o único sinal, porque o texto do painel sempre diz o estado.

## Cor

Nada de hex solto no CSS: tudo sai das variáveis abaixo, definidas em `:root` no protótipo.

### Tema claro: "céu de dia"

| Token | Hex | Papel |
|---|---|---|
| `--c-fundo` | `#F2F5F9` | Fundo da página: céu claro, levemente frio |
| `--c-superficie` | `#FFFFFF` | Cartões, campos, folha |
| `--c-tinta` | `#13213A` | Texto principal: azul-marinho de cartão de embarque |
| `--c-tinta-suave` | `#4B5A72` | Texto secundário |
| `--c-linha` | `#D5DCE6` | Divisórias decorativas |
| `--c-linha-forte` | `#75839A` | Bordas de controles (campos, opções) |
| `--c-pista` | `#FFC72C` | Amarelo de placa de direção |
| `--c-local` | `#13213A` | Fundo da placa de posição |
| `--c-atencao` | `#F28C28` | Painel de atraso |
| `--c-critico` | `#C8102E` | Painel de cancelado/desviado, botão "Parar avisos" |
| `--c-atencao-texto` | `#9A4A00` | Horário novo em atraso, sobre o fundo |
| `--c-critico-texto` | `#B00D28` | Erros e "Parar de acompanhar" |
| `--c-ok-texto` | `#1A6E44` | Reservado para confirmações |
| `--c-foco` | `#1C5BD6` | Anel de foco do teclado |
| `--c-botao` / `--c-botao-tinta` | `#13213A` / `#FFFFFF` | Botão principal |

### Tema escuro: "céu de noite"

O tema escuro não é um cinza invertido: é o azul da noite, o mesmo lado escuro do globo da v2. As placas mantêm as cores, como placas iluminadas numa pista à noite, e o botão principal passa a ser amarelo.

| Token | Hex |
|---|---|
| `--c-fundo` | `#0D1828` |
| `--c-superficie` | `#15233A` |
| `--c-tinta` / `--c-tinta-suave` | `#E6ECF4` / `#A7B4C8` |
| `--c-linha` / `--c-linha-forte` | `#2A3A55` / `#6E7F9A` |
| `--c-local` | `#060B14` (a borda amarela separa a placa do fundo) |
| `--c-atencao-texto` / `--c-critico-texto` / `--c-ok-texto` | `#FFB061` / `#FF8593` / `#63D39C` |
| `--c-foco` | `#8AB4FF` |
| `--c-botao` / `--c-botao-tinta` | `#FFC72C` / `#13213A` |
| `--c-rota-voada` | `#FFC72C` |

O tema segue `prefers-color-scheme`. Pode ser forçado com `data-theme="light|dark"` no `<html>` (no protótipo: `?tema=claro` ou `?tema=escuro`).

### Contraste medido

| Par | Claro | Escuro |
|---|---|---|
| Texto principal sobre fundo | 14,70 | 14,99 |
| Texto secundário sobre fundo | 6,39 | 8,49 |
| Texto da placa amarela | 10,30 | 10,30 |
| Amarelo sobre placa de posição | 10,30 | 12,63 |
| Texto sobre o painel laranja | 6,55 | 6,55 |
| Branco sobre o painel vermelho | 5,88 | 5,88 |
| Texto de atraso / de erro sobre fundo | 5,73 / 6,54 | 9,87 / 7,66 |
| Anel de foco sobre fundo | 5,46 | 8,53 |
| Borda de controle sobre superfície | 3,84 | 3,87 |
| Rota restante (tracejado) | 3,84 | 3,87 |

Todos os textos passam de 4,5:1 e todos os componentes, de 3:1. O amarelo puro sobre o fundo claro tem só 1,43:1, por isso ele **nunca** aparece sozinho no tema claro: a placa sempre tem texto em tinta e o ponto de destino tem contorno em tinta.

## Tipografia

Duas famílias com trabalhos diferentes:

| Família | Uso | Por quê |
|---|---|---|
| **Barlow Semi Condensed** 600/700 | Placas, códigos de aeroporto (`LIS`, `GRU`), horários | Desenhada a partir da sinalização rodoviária da Califórnia: é a voz de uma placa. Condensada, cabe `Atrasado, chega 19:15` numa linha de celular |
| **Atkinson Hyperlegible Next** 400/600/700 | Todo o texto corrido, rótulos, botões e o **campo do número do voo** | Feita pelo Braille Institute para distinguir letras parecidas. O `0` tem barra, e `O`/`0` e `I`/`1` não se confundem |

**Decisão importante, achada na crítica:** a primeira versão usava Barlow no campo de digitação. No estado de erro "TP1O3" (letra O), a Barlow deixava a letra O igual ao zero, justo o erro que a mensagem explicava. O campo passou para Atkinson. Regra: **o que o usuário digita ou precisa conferir caractere a caractere usa Atkinson; o que o sistema mostra como placa usa Barlow.**

### Escala (razão 1,25, base 17 px)

| Token | Tamanho | Uso |
|---|---|---|
| `--fs-pp` | 14 px | Dicas, fuso, metadados |
| `--fs-p` | 17 px | Corpo (um pouco acima de 16 para quem lê com pressa ou sem óculos) |
| `--fs-m` | 21 px | Subtítulos, horários da linha do tempo |
| `--fs-g` | 26,5 px | Títulos de tela, código do voo na placa |
| `--fs-gg` | 33 px | Pergunta da tela inicial, estado na placa |

Números sempre com `font-variant-numeric: tabular-nums` (classe `.num`), para os horários não "dançarem" quando atualizam.

## Espaço, forma e movimento

| Token | Valores |
|---|---|
| Espaçamento | `4 · 8 · 12 · 16 · 24 · 32 · 48` (`--e-1` a `--e-7`) |
| Raio da placa | `4px`: placas reais têm canto quase reto |
| Raio de campo/botão | `10px` |
| Raio de cartão | `14px` |
| Raio da folha inferior | `22px` |
| Elevação | Só na folha de confirmação, que de fato sobrepõe a tela |
| Movimento padrão | `200ms cubic-bezier(.2,.7,.2,1)`: abrir folha, selecionar opção |
| Momento orquestrado (único) | Ao abrir o status, o avião percorre a rota até a posição atual (1,4 s, desaceleração) |
| Ambiente | O destino pulsa devagar ("o aeroporto brilhando à espera", [06](06-v2-3d.md)) |

Tudo isso desliga com `prefers-reduced-motion`: o avião aparece direto na posição.

## Componentes

| Componente | Onde | Notas |
|---|---|---|
| **Placa** (`.placa`) | Status, lista, marca | Painéis `__local`, `__direcao`, `__atencao`, `__critico`. Variantes `--mini` (lista) e `--marca` (logo). Tem `role="status"` e `aria-label` com a frase completa |
| **Faixa da rota** (`.rota`) | Status | SVG: arco origem→destino, trecho voado sólido, restante tracejado, avião orientado pela tangente, destino com halo. É a versão 2D do arco 3D da v2 |
| **Linha do tempo** (`.linha-tempo`) | Status | Etapas `feito`, `agora` (`aria-current="step"`) e `previsto`. Horário novo em laranja escuro e o antigo riscado logo abaixo |
| **Escolha de data** (`.segmentado`) | Início | Só três botões: **Hoje, Amanhã e o dia seguinte**, porque a API só aceita até +2 dias (regra R4). Sem calendário, sem data impossível |
| **Cartão de voo** (`.cartao-voo`) | Confirmação | Rádio com aparência de cartão de embarque: código grande, cidade, "sai" e "chega" |
| **Prévia do aviso** (`.previa`) | Confirmação | Mostra a notificação real e muda enquanto o usuário digita o apelido |
| **Passo do iPhone** (`.aviso-ios`) | Confirmação | Só aparece no iOS fora da Tela de Início ([03](03-arquitetura.md#observações-sobre-ios)) |
| **Folha de confirmação** (`dialog.folha`) | Parar de acompanhar | `<dialog>` nativo, foco no botão seguro |
| **Botões** | Todas | Principal (`.botao`), secundário com borda, texto (`--texto`), perigo (`--perigo`). Altura mínima de 56 px (44 px nos compactos) |

## Telas da v1

| Tela | Captura | O que decide o desenho |
|---|---|---|
| **Início** | [claro](visual/inicio-m-claro.png) · [erro](visual/inicio-erro-m-claro.png) | Abre com uma pergunta humana, "Quem você está esperando?". Um campo, três datas e um botão |
| **Confirmação** | [claro](visual/confirmacao-m-claro.png) | "É um destes?". Cartões de voo, apelido opcional, prévia do aviso, passo do iPhone e **Me avisar** |
| **Status em voo** | [claro](visual/status-m-claro.png) · [escuro](visual/status-m-escuro.png) · [desktop](visual/status-d-claro.png) | Placa, rota, linha do tempo e o aviso de "40 min antes do pouso" |
| **Status atrasado** | [claro](visual/status-atraso-m-claro.png) | Painel laranja `+35`, horários novos com os antigos riscados e a promessa "você recebe outro aviso" |
| **Status cancelado** | [escuro](visual/status-cancelado-m-escuro.png) | Painel vermelho e "E agora?" com o próximo passo |
| **Link compartilhado** | [claro](visual/compartilhado-m-claro.png) | Mesma tela de status, com "A Ana compartilhou este voo" e **Receber os avisos deste voo** (H7) |
| **Meus voos** | [claro](visual/meus-voos-m-claro.png) · [vazio](visual/meus-voos-vazio-m-escuro.png) | Placas mini por voo, contador "3 de 5" (regra R5) e remoção com confirmação |

### Layout do status: as duas opções consideradas

```
A · placa primeiro (escolhida)        B · relógio primeiro
┌────────────────────────┐            ┌────────────────────────┐
│ Voo da Mãe        TAP  │            │ Voo da Mãe             │
│ [TP103|Em voo 18:52 ]  │            │      18:52             │
│ ╭──────✈┄┄┄┄┄┄┄◎╮      │            │  chegada prevista      │
│ LIS            GRU     │            │ [TP103|Em voo]         │
│ ● Decolou      08:58   │            │ ● Decolou      08:58   │
│ ◉ Em voo       agora   │            │ ...                    │
│ ○ Pousa        18:52   │            │                        │
│ [Compartilhar voo]     │            │                        │
└────────────────────────┘            └────────────────────────┘
```

**A** vence porque estado e horário cabem juntos na placa e o atraso ganha painel próprio. **B** é o herói "número gigante + rótulo", genérico, e esconde o estado num segundo plano. Alinhamento à esquerda, com a ordem de leitura: quem → estado → onde está → próximas etapas → ações.

### Desktop: o palco

A partir de 960 px, as telas de status viram duas colunas: placa e linha do tempo à esquerda, a rota num **palco** à direita ([captura](visual/status-d-escuro.png)). Esse palco é exatamente o espaço que o globo 3D vai ocupar na v2. As outras telas, que são formulários, ficam numa coluna de 440 px centralizada. Em monitores largos, essa coluna deixa muito espaço vazio dos dois lados; isso vai ser corrigido na v2 (ver [06 · Aproveitar a tela grande](06-v2-3d.md#aproveitar-a-tela-grande)).

## Textos (UX copy)

| Situação | Texto | Regra |
|---|---|---|
| Título do início | **Quem você está esperando?** | Fala da pessoa, não do voo |
| Botão do início | **Acompanhar voo** | Verbo + resultado |
| Confirmação | **É um destes?** / "Achamos 2 voos TP103 hoje. Escolha o de quem você espera." | |
| Botão de inscrição | **Me avisar** | A spec diz "Avisar-me". "Me avisar" é como se fala no Brasil. **Proposta:** atualizar a [02](02-v1-alertas.md) |
| Depois da inscrição | "Pronto! Vamos te avisar." | |
| Erro de voo | "Não achamos o voo TP1O3 hoje. Confira se é a letra O ou o número 0 e a data do voo." | O que houve + causa provável + como resolver |
| Apelido | **Como chamar quem vem?** (opcional), com o exemplo "Mãe, Ana, Vô Zé…" | |
| Aviso em voo | "Vamos te avisar **40 min antes do pouso**, a hora de sair para o aeroporto." | Explica o `eta: 40` ([04](04-integracao-aeroapi.md)) em linguagem de quem espera |
| Atraso | "Se o horário mudar de novo, você recebe outro aviso. Não precisa ficar conferindo." | Acalma: é a promessa do produto |
| Cancelado | **E agora?** "A LATAM costuma remarcar quem estava no voo. Pergunte ao Pedro qual é o novo voo e acompanhe por aqui." + **Acompanhar o novo voo** | Estado ruim sempre vem com o próximo passo |
| Parar | **Parar de acompanhar o voo da Mãe?** / **Parar avisos** e **Continuar acompanhando** | Nada de "OK/Cancelar" |
| Lista vazia | **Pista livre** / "Nenhum voo sendo acompanhado neste aparelho. Quando você acompanhar um, ele aparece aqui." + **Acompanhar um voo** | |
| Fuso | "Horários de Brasília." em toda tela com horário | Regra da [02](02-v1-alertas.md#notificações): o fuso de quem espera |
| Datas | **Hoje / Amanhã / Sábado** com "13 nov" embaixo | O dia da semana a partir de +2 é mais natural que "depois de amanhã" |

Ícone das notificações push: a placa de posição (avião amarelo em fundo marinho com borda amarela). No `manifest.webmanifest`: `theme_color #13213A`, `background_color #F2F5F9`.

## Acessibilidade (verificada no protótipo)

- Contrastes medidos na tabela acima.
- Alvos de toque: botões com 56 px de altura, links do topo e ações compactas com 44 px no mínimo.
- Foco de teclado visível (anel de 3 px em `--c-foco`). Ao trocar de tela, o foco vai para o `<h1>` sem desenhar anel.
- Estado nunca só por cor: a placa sempre escreve o estado, a linha do tempo usa ícone (✓, avião, círculo vazio) e o horário antigo aparece riscado.
- A faixa da rota tem `role="img"` com descrição ("O avião já fez 62% do caminho; faltam 3 h 50 min").
- 375 px sem rolagem horizontal em todas as telas. Com zoom de 200% (viewport efetivo de 187 px) também, depois de corrigir a grade das datas e dos cartões.
- `prefers-reduced-motion` desliga a animação do avião, o halo e as transições.

## Ponte para a v2 (3D)

Os tokens já são a paleta da cena Three.js:

| Elemento 3D ([06](06-v2-3d.md)) | Token |
|---|---|
| Lado noturno do globo e oceano | `--c-fundo` escuro `#0D1828` |
| Continentes low-poly | `--c-superficie` escuro `#15233A`, com arestas em `--c-linha` |
| Trecho voado | `--c-rota-voada` (amarelo), sólido |
| Trecho restante | `--c-rota-falta`, tracejado |
| Aeroporto de destino "brilhando à espera" | `--c-pista` com o mesmo halo pulsante |
| Pinos de aeroporto | Placa de posição (`LIS`, `GRU`) |
| HUD (altitude, velocidade, ETA) | Componente `.placa` em Barlow |
| Avião | Mesma silhueta do ícone, orientada pela tangente da rota |

A função de desenho da rota no protótipo (`desenharRota`) já separa "voado" e "restante" a partir de um progresso `t`. Na v2, o mesmo `t` vem da interpolação `posição = f(tempo, ETA)` e alimenta o arco 3D. A troca é de componente, não de layout: o globo entra no lugar da `.rota`, no palco.

## O que foi evitado e por quê

- **Fundo quase preto + um acento ácido:** o escuro é azul-noite e o amarelo é sinalização com regra, não decoração.
- **Kit de cards iguais:** só cartões onde há agrupamento real; a placa não é um card.
- **Herói "número gigante":** considerado (opção B) e descartado.
- **Rótulos em caixa alta espaçada, separadores " · " e setas em botões:** fora. Só os códigos de aeroporto e de voo ficam em maiúsculas, porque é assim que eles existem.
- **Uma animação em cada seção:** só o avião se move.

## Próximos passos de design

- [ ] Ícones da PWA (192/512 e maskable) a partir da placa de posição
- [ ] Estados que faltam: **Desviado** (painel vermelho com o novo destino), **Pousou/No portão** na lista, sem conexão (offline do service worker), permissão de notificação negada
- [ ] Testar a leitura da placa ao sol, num celular real, com brilho baixo
- [ ] Decidir se "Me avisar" substitui "Avisar-me" na spec
- [ ] Protótipo do globo da v2 usando estes tokens
