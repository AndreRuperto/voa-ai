# Próximos passos

**Data:** 14/11/2026 · **Branch:** `claude/ativar` (a partir da `main` com os PRs #1 a #8)

## O que mudou nesta sessão: o app real existe

Os dados simulados saíram. O app agora tem servidor e telas de verdade, seguindo o contrato da [13 · API](docs/13-api.md):

- **`server/`** (Node 22.5+, `node:sqlite`, sem framework): cliente da AeroAPI com novas tentativas e registro de custo em `CHAMADA_API`, um alerta por voo (R1–R3), webhook com deduplicação e aviso de atraso, Web Push (VAPID), agendador (checagens de atraso, rede de segurança, limpeza), login Google real (ID token) com sessão em cookie, busca por rota com cache e limites, e o admin `/api/admin/*`. São 52 testes com `node --test`.
- **`server/dados/`**: 3.245 aeroportos com fuso (OurAirports), nomes em português para 291 aeroportos e nomes de companhias. Gerado por `scripts/gerar-aeroportos.js`.
- **`public/`**: o visual da v2 (globo e painel) e o admin, alimentados só pela API. Inclui service worker, manifest, ícones da PWA e os estados que faltavam (pousou, desviado, avisos bloqueados ou desligados).
- **`prototipo/`** continua como registro histórico.

## Estado

- **Funciona sem a chave da AeroAPI:** o servidor sobe e todas as telas carregam. A busca por número e por rota mostra "O serviço de voos ainda não está configurado".
- **Testado no localhost:3000:** início, rota (países e aeroportos reais) e entrar (botão oficial do Google) em 1440×860, sem erro no console.
- **Não testado com dados reais:** voo real, webhook real, push real, login Google completo (a origem `http://localhost:3000` foi incluída no cliente OAuth em 14/11; o Google pode levar alguns minutos para aplicar), iOS, `/v/<id>`, desviado e no portão.

## Próximos passos

- [ ] **Chave da AeroAPI.** O plano Personal foi assinado em 14/11/2026, mas o portal da FlightAware dá erro 500 e não mostra "API Keys". Abrir chamado no suporte da FlightAware. Com a chave, colocar em `AEROAPI_KEY` no `.env`.
- [ ] Com a chave: `npm run buscar-voo -- TP103` e um voo real de ponta a ponta (Marco 1 e critérios de aceite da [02](docs/02-v1-alertas.md#critérios-de-aceite-da-v1))
- [ ] Testar o login Google no localhost:3000 e o painel `/admin/` com `andreruperto@gmail.com`
- [x] Deploy no Railway em 14/11/2026: projeto `voa-ai`, serviço `voa-ai`, volume em `/data`, variáveis do `.env`, domínio **https://voaai.up.railway.app** (porta 8080)
- [ ] Ligar o repositório GitHub ao serviço no Railway (o app do Railway no GitHub precisa de acesso ao repo `voa-ai`). Até lá, o deploy é por `railway up --service voa-ai` nesta pasta
- [ ] Colocar a `AEROAPI_KEY` também no Railway: `railway variable set --service voa-ai AEROAPI_KEY=...`
- [ ] Migrar `railway.json` para `.railway/railway.ts` antes de 01/12/2026 (`railway config migrate`)
- [ ] Alertas do admin a 50% e 80% do crédito (push e e-mail) e rate limit por IP (não feitos)
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
