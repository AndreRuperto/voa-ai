# 08 · Roadmap

## Marco 0: Fundação ✅ / 🔄

- [x] Repositório criado
- [x] Documentação da AeroAPI (PDF + spec OpenAPI)
- [x] Visão, especificação da v1, arquitetura, custos e decisões
- [ ] Conta AeroAPI (plano Personal) e chave gerada
- [ ] Projeto no Railway com volume persistente

## Marco 1: Prova de conceito da AeroAPI

- [ ] Script `node scripts/buscar-voo.js TAP103` que busca e imprime o voo
- [ ] Criar um alerta real de teste e receber o webhook (pode usar a [interface de teste de push](https://www.flightaware.com/aeroapi/portal/) da FlightAware)
- [ ] Confirmar se o `change` chega quando há atraso
- [ ] Medir o custo real de 1 voo completo em `GET /account/usage`

## Marco 2: Servidor v1

- [ ] `aeroapi.js`: cliente com retry/backoff e log de custo estimado por chamada
- [ ] SQLite + migrações (`VOO`, `INSCRICAO`, `EVENTO`)
- [ ] Rotas `/api/*` e `/webhook/aeroapi/:segredo`
- [ ] `mensagens.js` com testes para cada `event_code`
- [ ] Agendador de checagens de atraso e limpeza de alertas
- [ ] Web Push (VAPID) com remoção de inscrições mortas

## Marco 3: PWA v1

- [ ] Tela de início, confirmação, status e "Meus voos"
- [ ] Service worker (push + cache offline da casca do app)
- [ ] Manifest e ícones ✈️
- [ ] Fluxo de instalação explicado para iOS
- [ ] Link de compartilhamento `/v/:fa_flight_id`

## Marco 4: Lançamento fechado (família e amigos)

- [ ] Deploy no Railway
- [ ] Testar com voos reais (nacional e internacional)
- [ ] Checar os critérios de aceite de [02-v1-alertas.md](02-v1-alertas.md#critérios-de-aceite-da-v1)
- [ ] Decidir se abre ao público (exige o plano **Standard**, ver [05-custos.md](05-custos.md))

## Marco 5: v2 3D

- [ ] Protótipo do globo Three.js com a rota de um voo fixo (dados mockados)
- [ ] Integração com `/track` + interpolação
- [ ] Animações de decolagem e pouso disparadas pelos eventos
- [ ] Testes de desempenho em celular
