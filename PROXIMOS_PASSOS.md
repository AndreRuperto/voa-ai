# Próximos passos

**Data:** 15/11/2026 · **Branch:** `claude/camera-no-painel-do-voo` (a partir da `main` com os PRs até o #22)

## O que mudou nesta sessão: o app real existe

Os dados simulados saíram. O app agora tem servidor e telas de verdade, seguindo o contrato da [13 · API](docs/13-api.md):

- **`server/`** (Node 22.5+, `node:sqlite`, sem framework): cliente da AeroAPI com novas tentativas e registro de custo em `CHAMADA_API`, um alerta por voo (R1–R3), webhook com deduplicação e aviso de atraso, Web Push (VAPID), agendador (checagens de atraso, rede de segurança, limpeza), login Google real (ID token) com sessão em cookie, busca por rota com cache e limites, e o admin `/api/admin/*`. São 52 testes com `node --test`.
- **`server/dados/`**: 3.245 aeroportos com fuso (OurAirports), nomes em português para 291 aeroportos e nomes de companhias. Gerado por `scripts/gerar-aeroportos.js`.
- **`public/`**: o visual da v2 (globo e painel) e o admin, alimentados só pela API. Inclui service worker, manifest, ícones da PWA e os estados que faltavam (pousou, desviado, avisos bloqueados ou desligados).
- **`prototipo/`** continua como registro histórico.

## 15/11: país com bandeira na busca por rota

- O `<select>` nativo de país virou um campo com busca e bandeira (`public/seletor-pais.js`, funções puras em `public/paises.js`). A lista abre logo abaixo do campo, com no máximo 320 px de altura (antes o navegador abria até o topo do monitor). Digitar filtra sem acento ("japao", "jp", "sul"); setas, Enter, Esc e Tab funcionam.
- Bandeiras: fonte `public/fontes/bandeiras.woff2` (Twemoji Country Flags, 78 KB, CC-BY 4.0; crédito em `public/fontes/CREDITOS.md`), só para os caracteres de bandeira. Assim aparecem também no Windows.
- Testado no navegador a 1440×900 e 375×812 contra o simulador.
- [ ] Prancha de design: componente "campo de país" (fechado, aberto, filtrando, sem resultado, indisponível)
- [ ] Aeroporto pré-marcado na origem é o primeiro "grande" em ordem alfabética (Japão → Aomori, Brasil → Belém). Ordenar por movimento.

## 15/11: câmera junto do painel do voo

- Prancha de opções: [Voa Aí · topo e câmera](https://claude.ai/artifact/KUGkLFBG7Sv7QCihqx5SL2). Ela mostra o layout de hoje, três caminhos no desktop (A, B e C) e dois no celular. Escolhido: **B**.
- **Desktop:** a câmera saiu do topo e fica em cima dos números do voo (Falta · Chega · Posição), no canto de baixo à direita, num bloco só. O topo ficou só com "Meus voos" e "Entrar".
- **Celular:** a câmera fica numa barra na borda de baixo do globo.
- **Botões:** ícone + palavra, 52 px de altura, e o modo escolhido em azul-céu, em vez do branco.
- [ ] Atualizar a prancha **Voa Aí · Design** (componente da câmera e telas de status). Nesta sessão, a conta não conseguiu abrir a prancha ("não encontrada"); conferir o compartilhamento.

## 15/11: busca por rota com escala

- Na busca por rota, a opção **"Incluir voos com uma escala"** traz também viagens com uma escala (ex.: Guarulhos → Narita como EK262 + EK318 por Dubai). Ao tocar numa, a confirmação mostra "É esta viagem?" com os dois trechos e a conexão; **"Me avisar dos 2 voos"** acompanha os dois com o mesmo apelido.
- AeroAPI: `connection=onestop`, sem data (devolve as próximas saídas) e com a ressalva de que a lista pode vir incompleta. Mais uma consulta por par: ≈ US$ 0,10 por par com a opção marcada.
- Conferido no simulador, do começo ao fim, em 1440×900 e 375×812. **Não testado com a AeroAPI real:** falta ver o quanto a lista de escalas vem completa para Brasil → Japão.
- [ ] Com a chave: testar `GRU → NRT` com escala e conferir o formato dos `segments`

## 15/11: viagem com conexão

- Voos acompanhados que se encadeiam (sai de onde o outro chega, até 24 h depois, mesmo apelido) viram uma **viagem** (`public/viagens.js`, ADR-008). Não mexe no banco nem na API.
- **Meus voos:** um cartão por viagem (rota GRU → DXB → NRT, frase de onde ela está, os trechos e a conexão entre eles: escala, apertada abaixo de 45 min, ou pode perder).
- **Status:** a seção "Viagem até Tóquio · trecho N de M" com os outros trechos. No globo aparecem todos os trechos: o que já voou como rastro, o que falta tracejado, o destino final com halo e um rótulo só por viagem.
- Conferido no localhost em 1440×900 e 375×812, com a conexão simulada EK262 + EK318. São 68 testes.
- **Adicionar a conexão pelo status:** num voo acompanhado sem viagem, o cartão "Tem conexão em Dubai?" pede o número do próximo voo. O app procura o primeiro voo com esse número que sai de Dubai depois da chegada, até 24 h. Se nenhum sair depois, aceita um que sai até 3 h antes, porque este voo pode estar atrasado. O voo achado é seguido com o mesmo apelido e os dois viram a viagem.
- Correção: a simulação agora usa **sempre** `dados/simulado.sqlite`. Antes, o `DB_CAMINHO` do `.env` fazia ela gravar no banco de desenvolvimento. As linhas simuladas foram apagadas de lá; há uma cópia de antes da limpeza no scratchpad da sessão.
- **Aviso de conexão em risco** (`server/conexoes.js`, no agendador a cada minuto): push quando a troca de avião fica pior que a planejada. Primeiro "Conexão apertada em Dubai", depois "Ana pode perder a conexão em Dubai", e "Conexão em Dubai em dia" se o atraso for recuperado. Cada nível avisa uma vez (tabela `AVISO_CONEXAO`, migração 3). Vai para os aparelhos de quem acompanha o 2º trecho.
- Na simulação, a EK262 sai 35 min atrasada nos ciclos ímpares (sobram 15 min em Dubai). Conferido: o agendador gravou o aviso "apertada". O push real não foi testado num aparelho.
- [ ] Prancha de design: cartão de viagem, linha de conexão (escala, apertada, pode perder) e o ícone `i-conexao`

## 15/11: voos simulados (sem a chave)

- `npm run simular` sobe o servidor com uma **AeroAPI simulada** (`server/simulador.js`) e um banco à parte, `dados/simulado.sqlite`. A simulação não liga em produção.
- Voos de teste, curtos e em ciclo, sempre com um no ar: **TP1018** (OPO→MAD, 8 min), **TP103** (LIS→GRU, 40 min), **G31402** (GRU→SDU, 10 min), **AD4510** (VCP→REC, 20 min) e **LA8084** (GRU→LHR, 60 min). A busca por rota também funciona nesses pares.
- **Conexão Brasil → Japão:** **EK262** (GRU→DXB, 30 min) e **EK318** (DXB→NRT, 25 min), com 50 min de portão a portão em Dubai. Siga as duas pernas com o mesmo apelido e veja as duas em Meus voos. O app ainda não junta as pernas numa viagem: cada uma é um voo, e os rótulos se sobrepõem no aeroporto da escala.
- Um selo "Dados simulados" aparece na tela. No status, o avião avança no globo a cada 2 s, sem consultar a API de novo (vale também para voos reais).
- O histórico da AeroAPI (`/history/flights/{ident}`, US$ 0,02 por consulta; `/track` US$ 0,06) está disponível desde 2011, mas mostra voos que já terminaram. Não serve para ver o avião andando ao vivo; serviria para um "replay" de voo passado.

## 15/11: avião 3D

- Câmera nova **De perto**: perseguição atrás e acima do avião. Perto dele, o marcador vira o modelo 3D low-poly (`public/aviao3d.js`), com duas famílias pelo `aircraft_type`, sombra no chão, rastro fino até a cauda e aeroportos menores.
- Conferido no localhost com dois voos de teste no banco local (LIS→GRU A339 e OPO→MAD A20N), em 1440×900 e 375×812. Os voos de teste foram apagados.
- Mapa do globo mais legível: mais contraste entre terra e oceano, linha de litoral e divisas entre países, que ficam mais nítidas de perto.
- [ ] Atualizar a prancha de design (marcador e modelo de perto, botão De perto, novas cores de terra e oceano, litoral e divisas)
- [ ] Testar a 60 fps num celular intermediário com o modo De perto

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

- Ver o avião andar sem a chave: `npm run simular` e buscar `TP103` (ou a configuração "simulado" do `.claude/launch.json`).

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
