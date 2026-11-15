# 13 · Contrato da API (app real)

> Status: **em implementação**. O app sai do protótipo e passa a ter servidor e dados reais.
> O servidor e o front seguem este contrato. As regras de negócio estão nas docs [02](02-v1-alertas.md), [03](03-arquitetura.md), [04](04-integracao-aeroapi.md) e [12](12-contas-admin-rotas.md).

## Decisões de implementação

| Tema | Escolha |
|---|---|
| Runtime | Node 22.5+ (testado no 26), ES modules, `node:http` sem framework |
| Banco | `node:sqlite` (`DatabaseSync`), sem dependência nativa. Arquivo em `DB_CAMINHO` |
| Dependências | `web-push` e `google-auth-library`. Testes com `node --test` |
| Aparelho | Cookie `aparelho` (ID aleatório, `HttpOnly`, `SameSite=Lax`, 400 dias), criado na primeira chamada à API |
| Sessão Google | Cookie `sessao` (ID aleatório da tabela `SESSAO`, `HttpOnly`, `SameSite=Lax`, `Secure` quando `URL_PUBLICA` é https, 30 dias) |
| CSRF | `POST`/`PUT`/`DELETE` em `/api/*` exigem o cabeçalho `X-Requested-With: voa-ai` (senão `403`). O webhook não exige |
| Sem `AEROAPI_KEY` | Toda rota que chamaria a AeroAPI responde `503 {"erro":"aeroapi_sem_chave"}`. Não existe modo de dados falsos |
| Lugares | Lista estática de países e aeroportos em `server/dados/aeroportos.json` (OurAirports, domínio público), só aeroportos `large_airport`/`medium_airport` com código IATA e serviço regular. Campos: `iata`, `icao`, `nome`, `cidade`, `pais` (código ISO), `lat`, `lon`, `fuso` |
| Horários | A API devolve ISO 8601 em UTC. O front formata no fuso do aeroporto de **destino** (`destino.fuso`) e diz isso na tela ("Horários de Guarulhos") |
| Limite por IP | Na memória, janela fixa: **consultas** (`GET /api/voos/buscar`, `GET /api/voos/:id`, `GET /api/rotas/buscar`, `POST /api/inscricoes`) 40 a cada 10 min (`limite_ip_consultas` no admin); `POST /api/sessao` 20 a cada 10 min; o resto de `/api/*` 240 por minuto. Admin e webhook ficam de fora. O IP vem de `X-Real-IP` no Railway (ou do cabeçalho em `CABECALHO_IP`); fora disso, do IP da conexão |
| Teto duro | `teto_duro_usd` (padrão 2 × teto do mês). Passou dele, o servidor não faz chamada paga à AeroAPI até o mês virar (`503 teto_duro`); apagar alerta continua |
| Avisos de gasto | O agendador confere o gasto a cada minuto e manda push aos aparelhos dos admins a 50% e 80% do crédito, no teto do mês e no teto duro. Uma vez por marco e por mês (tabela `AVISO_GASTO`); se vários marcos passam juntos, só o mais alto manda push. E-mail ainda não |
| Posição no globo | Sem `/track` na v1: o front estima a posição pela fração do tempo de voo (`actual_off` → `estimated_on`) ao longo do grande círculo, e a legenda diz que é estimada |
| Viagem com conexão | Deduzida no front (`public/viagens.js`), sem mudança na API: o voo B continua o A quando sai do aeroporto onde A chega, até 24 h depois, e os dois têm o mesmo apelido (ou um deles está sem apelido). Conexão **apertada** abaixo de 45 min de portão a portão; **pode perder** quando a chegada estimada de A passa da saída de B. O agendador (`server/conexoes.js`) faz a mesma dedução por pessoa (conta ou aparelho) e manda push aos aparelhos de quem acompanha o trecho B quando a conexão fica pior que a planejada; avisa de novo se piorar e uma vez se voltar ao planejado (tabela `AVISO_CONEXAO`) |

## Formato de erro

Todo erro é JSON `{"erro": "<codigo>", "mensagem": "<texto em PT-BR para mostrar>"}`.

| Código | HTTP | Quando |
|---|---|---|
| `invalido` | 400 | Parâmetro faltando ou fora do formato |
| `nao_encontrado` | 404 | Voo ou recurso inexistente (e `/admin` para quem não é admin) |
| `limite` | 429 | Limite de voos ativos ou de buscas por rota |
| `pausado` | 503 | Busca por rota pausada no admin ou teto mensal atingido |
| `muitos_pedidos` | 429 | Passou do limite de pedidos por IP (vem com `Retry-After` em segundos) |
| `teto_duro` | 503 | O gasto do mês chegou ao teto duro: nenhuma chamada paga à AeroAPI até o mês virar |
| `aeroapi_sem_chave` | 503 | `AEROAPI_KEY` vazia |
| `aeroapi_falhou` | 502 | A AeroAPI respondeu erro depois das novas tentativas |

## Objeto `Voo`

```json
{
  "fa_flight_id": "TAP103-1734567890-schedule-0001",
  "ident": "TAP103", "ident_iata": "TP103",
  "companhia": "TAP Air Portugal", "aeronave": "A339",
  "origem":  { "iata": "LIS", "icao": "LPPT", "nome": "Lisboa", "cidade": "Lisboa", "lat": 38.77, "lon": -9.13, "fuso": "Europe/Lisbon" },
  "destino": { "iata": "GRU", "icao": "SBGR", "nome": "Guarulhos", "cidade": "São Paulo", "lat": -23.43, "lon": -46.47, "fuso": "America/Sao_Paulo" },
  "horarios": {
    "saida_prevista": "…Z", "saida_estimada": "…Z", "saida_real": null,
    "decolagem_real": null,
    "pouso_previsto": "…Z", "pouso_estimado": "…Z", "pouso_real": null,
    "chegada_prevista": "…Z", "chegada_estimada": "…Z", "chegada_real": null
  },
  "estado": "previsto | no_portao | em_voo | pousou | no_portao_destino | atrasado | cancelado | desviado",
  "atraso_min": 0,
  "progresso": 0.62,
  "atualizado_em": "…Z"
}
```

- `estado` é calculado no servidor a partir dos horários reais e de `cancelled`/`diverted`. `atrasado` vale enquanto não decolou e `saida_estimada - saida_prevista >= 15 min`.
- `atraso_min` é a diferença da chegada (estimada − prevista), arredondada, nunca negativa.
- `progresso` (0 a 1) só existe em `em_voo`; nos outros estados vale 0 (antes) ou 1 (depois).
- `origem`/`destino` sem coordenadas conhecidas vêm com `lat`/`lon` `null`; o front então não desenha a rota no globo.

## Rotas

### Públicas

| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/saude` | `{"ok":true}` |
| `GET` | `/api/config` | `{"google_client_id","vapid_publica","aeroapi":true/false,"limites":{…}}` |
| `GET` | `/api/eu` | `{"conta": null | {"nome","email","foto","admin":bool}, "limites": {"voos":5,"buscas_rota":3}, "uso": {"voos":2,"buscas_rota_hoje":1}}` |
| `POST` | `/api/sessao` | Corpo `{"credential"}` (ID token do Google). Cria a sessão e leva as inscrições do aparelho para a conta. Resposta igual a `/api/eu` |
| `DELETE` | `/api/sessao` | Sai. `204` |
| `DELETE` | `/api/eu` | Apaga a conta. `204` |
| `GET` | `/api/voos/buscar?ident=TP103&data=2026-11-14` | `{"voos":[Voo…]}`. `data` entre hoje e +2 dias (R4). IATA vira ICAO por `/canonical` (R6). Cache de 10 min por `ident+data` |
| `GET` | `/api/voos/:fa_flight_id` | `Voo` (do banco; se tiver mais de 15 min e o voo não terminou, atualiza na AeroAPI antes) |
| `PUT` | `/api/aparelho/push` | Corpo `{"push":PushSubscription}`. Liga o push do aparelho sem voo (o painel usa para os avisos de gasto). `204` |
| `GET` | `/api/inscricoes` | `{"inscricoes":[{"id","apelido","criado_em","voo":Voo}]}` do aparelho ou da conta |
| `POST` | `/api/inscricoes` | Corpo `{"fa_flight_id","apelido","push":PushSubscription|null}`. Cria o alerta na AeroAPI se o voo ainda não tem (R1). `201 {"id", "voo":Voo}`. Respeita o limite (R5 / doc 12) |
| `PUT` | `/api/inscricoes/:id/push` | Corpo `{"push":PushSubscription}`. Liga o push depois da permissão |
| `DELETE` | `/api/inscricoes/:id` | `204`. Apaga o alerta se era o último inscrito (R3) |
| `GET` | `/api/lugares/paises` | `{"paises":[{"codigo":"PT","nome":"Portugal","aeroportos":3}]}` (nome em PT-BR) |
| `GET` | `/api/lugares/aeroportos?pais=PT` | `{"aeroportos":[{"iata","icao","nome","cidade","lat","lon","grande":bool}]}` grandes primeiro |
| `GET` | `/api/rotas/buscar?de=LIS,OPO&para=GRU&data=2026-11-14` | `{"pares":[{"de","para","cache":bool,"voos":[Voo…],"viagens"?:[{"pernas":[Voo, Voo]}]}]}`. Máx. 3 pares, cache de 30 min por par+dia, `connection=nonstop`. Com `&escala=1`, mais uma consulta por par com `connection=onestop` (a AeroAPI não aceita data com escala: devolve as próximas saídas, por heurística, e pode vir incompleta); o servidor guarda as pernas, filtra pelo dia da 1ª saída e faz cache de 30 min por par. Conta como uma busca no limite diário |
| `GET` | `/v/:fa_flight_id` | Devolve o `index.html` (o front abre a tela de status desse voo e oferece "Me avisar") |
| `POST` | `/webhook/aeroapi/:segredo` | Callback da AeroAPI. Segredo errado → `404`. Responde `200` na hora e processa depois |

### Admin (`404` para quem não está em `ADMIN_EMAILS`)

| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/admin/` | Página do painel |
| `GET` | `/api/admin/resumo?mes=2026-11` | `{"mes","credito_usd","teto_mensal_usd","teto_duro_usd","avisos_gasto":[{"marco","gasto_usd","enviados","em"}],"gasto_usd","projecao_usd","por_dia":[{"dia","usd"}],"por_tipo":[{"tipo","chamadas","usd"}],"voos_ativos","alertas_entregues","contas","buscas_rota"}` |
| `GET` | `/api/admin/avisos` | `{"aparelhos_com_push"}`: quantos aparelhos de admin recebem os avisos de gasto |
| `POST` | `/api/admin/avisos/teste` | Manda um push de teste aos aparelhos dos admins. `{"enviados"}` |
| `GET` | `/api/admin/voos` | `{"voos":[{"voo":Voo,"inscritos","alertas_entregues","custo_usd","alert_id"}]}` |
| `POST` | `/api/admin/voos/:fa_flight_id/parar` | Apaga o alerta e as inscrições do voo. `204` |
| `GET` | `/api/admin/contas` | `{"contas":[{"id","email","nome","foto","voos_ativos","buscas_mes","ultimo_acesso","bloqueado"}]}` |
| `POST` | `/api/admin/contas/:id/bloquear` | Corpo `{"bloqueado":bool}`. `204` |
| `DELETE` | `/api/admin/contas/:id` | `204` |
| `GET` | `/api/admin/rotas` | `{"rotas":[{"de","para","buscas","acertos_cache","custo_usd"}]}` |
| `GET` | `/api/admin/config` | `{"config":{chave:valor},"auditoria":[{"em","admin_email","acao","detalhe"}]}` |
| `PUT` | `/api/admin/config` | Corpo `{chave:valor}`. Chaves: `limite_voos_anonimo`, `limite_voos_conta`, `limite_rota_anonimo`, `limite_rota_conta`, `teto_alertas_dia`, `teto_mensal_usd`, `teto_duro_usd`, `limite_ip_consultas`, `rota_pausada`, `modo_economico` |

## Custo registrado

Cada chamada à AeroAPI grava uma linha em `CHAMADA_API` com o preço da tabela da [04](04-integracao-aeroapi.md) (`canonical` 0,001; `flights` 0,005 por página; `airports/…/flights/to` 0,050 por página; `alerts` 0). Cada webhook recebido grava uma linha `alerta_entregue` de 0,020. O painel soma essa tabela.
