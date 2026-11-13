# 04 · Integração com a AeroAPI

Referência completa: [aeroapi/AeroAPI-FlightAware.pdf](aeroapi/AeroAPI-FlightAware.pdf) (v4.17.1).
Base URL: `https://aeroapi.flightaware.com/aeroapi`. Header: `x-apikey: $AEROAPI_KEY`.

## Endpoints usados

| Uso no Voa Aí | Endpoint | Custo (US$) | Versão |
|---|---|---|---|
| Normalizar o ident digitado (IATA → ICAO) | `GET /flights/{ident}/canonical` | 0,001 | v1 |
| Buscar voos candidatos | `GET /flights/{ident}?start=&end=` | 0,005 | v1 |
| Checagem de atraso antes da decolagem | `GET /flights/{fa_flight_id}` | 0,005 | v1 |
| Criar alerta | `POST /alerts` | 0,000 | v1 |
| Apagar alerta | `DELETE /alerts/{id}` | 0,000 | v1 |
| Listar alertas (auditoria) | `GET /alerts` | 0,000 | v1 |
| **Cada alerta entregue (callback)** | *push da FlightAware* | **0,020** | v1 |
| Medir gasto | `GET /account/usage` | 0,000 | v1 |
| Trilha percorrida | `GET /flights/{id}/track` | 0,012 | v2 |
| Posição atual | `GET /flights/{id}/position` | 0,010 | v2 |
| Rota planejada | `GET /flights/{id}/route` | 0,010 | v2 |

## Buscar o voo

```bash
curl -H "x-apikey: $AEROAPI_KEY" \
  "https://aeroapi.flightaware.com/aeroapi/flights/TAP103?start=2026-12-20&end=2026-12-21"
```

Campos usados da resposta (`flights[]`): `fa_flight_id`, `ident_icao`, `ident_iata`, `operator`, `origin.code_iata`, `origin.city`, `origin.timezone`, `destination.*`, `scheduled_out`, `estimated_out`, `scheduled_in`, `estimated_in`, `status`, `cancelled`.

> Limites: `start` vai até 10 dias no passado e 2 dias no futuro. Sem `start`/`end`, a API devolve cerca de 14 dias de voos. Sempre passe o intervalo para reduzir as páginas e o custo.

## Criar o alerta

```bash
curl -X POST -H "x-apikey: $AEROAPI_KEY" -H "Content-Type: application/json" \
  "https://aeroapi.flightaware.com/aeroapi/alerts" \
  -d '{
    "ident": "TAP103",
    "origin": "LPPT",
    "destination": "SBGR",
    "start": "2026-12-20",
    "end": "2026-12-20",
    "eta": 40,
    "events": {
      "out": false, "off": true, "on": true, "in": true,
      "departure": false, "arrival": false,
      "cancelled": true, "diverted": true, "filed": false
    },
    "target_url": "https://voa-ai.up.railway.app/webhook/aeroapi/<WEBHOOK_SEGREDO>"
  }'
```

| Campo | Valor no Voa Aí | Observação |
|---|---|---|
| `ident` + `origin` + `destination` | do voo confirmado | Filtrar por origem e destino evita alertas de outros trechos com o mesmo número |
| `start` / `end` | data do voo | **No fuso do aeroporto de partida** |
| `eta` | `40` | Minutos antes da chegada. Só dispara se o voo estiver no ar há ≥ 15 min. `0` desliga |
| `events` | `off`, `on`, `in`, `cancelled`, `diverted` | Cada evento entregue custa US$ 0,020. `departure`/`arrival` duplicariam `off`/`on` |
| `target_url` | URL com segredo | Tem prioridade sobre a URL padrão da conta (`PUT /alerts/endpoint`) |
| `max_weekly` | omitir | Só rejeita alertas que dispararem demais. Útil para voos recorrentes |

## Payload do webhook

A FlightAware faz `POST` com JSON (`application/json; charset=UTF-8`). Os valores abaixo são ilustrativos, mas a estrutura segue a spec oficial:

```json
{
  "long_description": "...",
  "short_description": "...",
  "summary": "TAP103 departed LPPT",
  "event_code": "off",
  "alert_id": 123456,
  "flight": {
    "fa_flight_id": "TAP103-1734567890-schedule-0001",
    "ident": "TAP103",
    "ident_icao": "TAP103",
    "ident_iata": "TP103",
    "registration": "CS-TUA",
    "aircraft_type": "A339",
    "origin": "LPPT",
    "destination": "SBGR",
    "scheduled_out": "2026-12-20T10:30:00Z",
    "estimated_out": "2026-12-20T10:45:00Z",
    "actual_out": "2026-12-20T10:47:00Z",
    "scheduled_off": "…", "estimated_off": "…", "actual_off": "…",
    "scheduled_on": "…",  "estimated_on": "…",  "actual_on": null,
    "scheduled_in": "…",  "estimated_in": "…",  "actual_in": null,
    "cancelled": false,
    "diverted": false
  }
}
```

Valores possíveis de `event_code`: `filed`, `departure`, `arrival`, `out`, `off`, `on`, `in`, `diverted`, `cancelled`, `position_only_arrival`, `position_only_departure`, `fru_arrival`, `nonairport_arrival`, `nonairport_departure`, `nonairport_filed`, `minutes_out`, `power_on`, `change`.

### Tratamento no servidor

1. Validar o segredo da URL. Se for inválido, responder `404`.
2. Responder **`200` rápido** e processar de forma assíncrona.
3. Salvar o evento bruto na tabela `EVENTO` (auditoria e depuração).
4. Atualizar a tabela `VOO` com os horários do `flight`.
5. Deduplicar (`alert_id` + `event_code` + `actual_*`).
6. Montar a mensagem (`mensagens.js`) e enviar o push para cada inscrição do voo.
7. Se `event_code` for `in` ou `cancelled`: agendar `DELETE /alerts/{alert_id}`.

Eventos desconhecidos são salvos e ignorados sem erro. Assim, uma novidade da API não derruba o webhook.

## Erros e limites

| Situação | Ação |
|---|---|
| `429` (limite do plano: 10/min no Personal) | Backoff exponencial e fila no servidor |
| `404` em `/flights/{ident}` | "Voo não encontrado. Confira o número e a data" |
| `400` no `POST /alerts` | Logar o corpo da resposta. Geralmente é data fora do intervalo ou ident inválido |
| Webhook não chega | O agendador consulta `/flights/{id}` 30 min depois da chegada prevista como rede de segurança |
