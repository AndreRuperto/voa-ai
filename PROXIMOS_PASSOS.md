# Próximos passos

**Data:** 15/11/2026 · **Branch:** `claude/proteger-custo` (a partir da `main` com os PRs #1 a #14)

## O que mudou nesta sessão: o app real existe

Os dados simulados saíram. O app agora tem servidor e telas de verdade, seguindo o contrato da [13 · API](docs/13-api.md):

- **`server/`** (Node 22.5+, `node:sqlite`, sem framework): cliente da AeroAPI com novas tentativas e registro de custo em `CHAMADA_API`, um alerta por voo (R1–R3), webhook com deduplicação e aviso de atraso, Web Push (VAPID), agendador (checagens de atraso, rede de segurança, limpeza), login Google real (ID token) com sessão em cookie, busca por rota com cache e limites, e o admin `/api/admin/*`. São 52 testes com `node --test`.
- **`server/dados/`**: 3.245 aeroportos com fuso (OurAirports), nomes em português para 291 aeroportos e nomes de companhias. Gerado por `scripts/gerar-aeroportos.js`.
- **`public/`**: o visual da v2 (globo e painel) e o admin, alimentados só pela API. Inclui service worker, manifest, ícones da PWA e os estados que faltavam (pousou, desviado, avisos bloqueados ou desligados).
- **`prototipo/`** continua como registro histórico.

## 15/11: proteção de custo

- **Limite por IP:** 40 consultas a cada 10 min por rede (ajustável em Limites), 20 logins a cada 10 min e 240 pedidos por minuto no resto da API. Quando passa do limite, a API responde `429 muitos_pedidos` com `Retry-After`. No Railway, o IP vem do `X-Real-IP`.
- **Teto duro:** padrão de 2 × o teto do mês. Ao chegar nele, nenhuma chamada paga sai para a AeroAPI até o mês virar (`503 teto_duro`); apagar alerta continua.
- **Avisos de gasto:** push nos aparelhos dos admins a 50% e 80% do crédito, no teto do mês e no teto duro, uma vez por mês cada. O cartão "Avisos de gasto" fica em Limites, com os botões "Receber neste aparelho" e "Enviar aviso de teste".
- São 59 testes.

## Estado

- **Funciona sem a chave da AeroAPI:** o servidor sobe e todas as telas carregam. A busca por número e por rota mostra "O serviço de voos ainda não está configurado".
- **Testado no localhost:3000:** início, rota (países e aeroportos reais) e entrar (botão oficial do Google) em 1440×860, sem erro no console.
- **Não testado com dados reais:** voo real, webhook real, push real, login Google completo (a origem `http://localhost:3000` foi incluída no cliente OAuth em 14/11; o Google pode levar alguns minutos para aplicar), iOS, `/v/<id>`, desviado e no portão.

## Próximos passos

- [ ] **Chave da AeroAPI.** O plano Personal foi assinado em 14/11/2026, mas o portal da FlightAware dá erro 500 e não mostra "API Keys". Abrir chamado no suporte da FlightAware. Com a chave, colocar em `AEROAPI_KEY` no `.env`.
- [ ] Com a chave: `npm run buscar-voo -- TP103` e um voo real de ponta a ponta (Marco 1 e critérios de aceite da [02](docs/02-v1-alertas.md#critérios-de-aceite-da-v1))
- [x] Login Google e painel `/admin/` testados em produção
- [ ] Depois do merge: em https://voaai.up.railway.app/admin/#limites, tocar em "Receber neste aparelho" no celular e em "Enviar aviso de teste"
- [ ] E-mail nos avisos de gasto (precisa de um serviço de envio, ex.: Resend, e da chave dele)
- [x] Deploy no Railway em 14/11/2026: projeto `voa-ai`, serviço `voa-ai`, volume em `/data`, variáveis do `.env`, domínio **https://voaai.up.railway.app** (porta 8080)
- [x] Repositório GitHub ligado ao Railway: cada merge na `main` publica sozinho
- [ ] Colocar a `AEROAPI_KEY` também no Railway: `railway variable set --service voa-ai AEROAPI_KEY=...`
- [ ] Migrar `railway.json` para `.railway/railway.ts` antes de 01/12/2026 (`railway config migrate`)
- [x] Alertas do admin a 50% e 80% do crédito (push) e limite por IP
- [ ] Incluir em "Público-alvo → Usuários de teste" quem mais for testar o login
- [ ] Prancha Admin · Visão geral: trocar "dia 25" por "dia 24"
- [ ] Prancha: placa mini em Meus voos (v1) e os estados novos (pousou, desviado, avisos bloqueados)
- [ ] Testar o globo num celular intermediário (meta de 60 fps) e com leitor de tela
- [ ] Levar three.js, world-atlas e fontes do CDN para `public/` (doc 11)

## Comandos úteis

- Produção: https://voaai.up.railway.app (saúde em `/saude`). Logs: `railway logs --service voa-ai`. Deploy manual: `railway up --service voa-ai --detach`.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

- App: `http://localhost:3000` (no Claude, configuração `app` em `.claude/launch.json`). Admin: `http://localhost:3000/admin/`.
- Protótipo antigo: `python -m http.server 8741 --directory prototipo` (configuração `prototipo`).
- Buscar um voo pelo terminal: `node --env-file=.env scripts/buscar-voo.js TP103`.
- Regerar os aeroportos: `node scripts/gerar-aeroportos.js`.
- O `.env` (fora do git) já tem `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `SESSAO_SEGREDO`, VAPID e `WEBHOOK_SEGREDO`. Falta só `AEROAPI_KEY`.
