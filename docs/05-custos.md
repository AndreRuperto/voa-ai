# 05 · Custos

Valores da tabela oficial da FlightAware (novembro de 2026). Detalhes em [aeroapi/AeroAPI-FlightAware.pdf](aeroapi/AeroAPI-FlightAware.pdf).

> ⚠️ **Correção importante:** criar e apagar alertas é gratuito, mas **cada alerta entregue custa US$ 0,020**. Por isso, escolher os eventos ativos é a principal alavanca de custo.

## Custo por voo acompanhado (v1)

| Item | Qtde | Unit. (US$) | Total (US$) |
|---|---|---|---|
| `/flights/{ident}/canonical` (quando o usuário digita IATA) | 1 | 0,001 | 0,001 |
| `/flights/{ident}` (busca dos candidatos) | 1 | 0,005 | 0,005 |
| Checagens de atraso antes da decolagem | 3 | 0,005 | 0,015 |
| Alertas entregues: `off`, `minutes_out` (eta), `on`, `in` | 4 | 0,020 | 0,080 |
| **Total típico** | | | **≈ 0,10** |
| Pior caso (cancelado/desviado + nova busca) | | | ≈ 0,13 |

Como o alerta é **por voo** e não por pessoa (regra R1), 10 pessoas acompanhando o mesmo voo custam o mesmo que 1.

### Como reduzir

| Medida | Economia por voo |
|---|---|
| Desligar o evento `in` (portão) e manter só o pouso | −0,020 |
| Pular as checagens de atraso se o `change` funcionar | −0,015 |
| Cache de 2 min nas buscas repetidas do mesmo voo | variável |

## Que plano usar

| Fase | Plano | Custo fixo | Comporta |
|---|---|---|---|
| **Desenvolvimento e uso pessoal** (família e amigos) | **Personal** | US$ 0 (US$ 5/mês grátis) | ≈ **50 voos/mês** dentro do grátis |
| **Lançamento público** | **Standard** | **US$ 100/mês** (mínimo, que vira crédito) | ≈ 1.000 voos/mês dentro do mínimo |
| Escala (> 10 mil voos/mês) | Standard/Premium com desconto por volume | conforme uso | desconto progressivo a partir de US$ 1.000/mês |

> 🚨 **Licença:** o plano **Personal só permite uso pessoal ou acadêmico.** Abrir o Voa Aí para o público (B2C) exige pelo menos o **Standard**. O mesmo vale se houver monetização.

### Limites de taxa

| Plano | Limite | Impacto |
|---|---|---|
| Personal | **10 consultas/min** | Suficiente para uso pessoal. Os webhooks não contam para esse limite |
| Standard | 5 consultas/s | Folga para milhares de usuários |

## Outros custos

| Item | Estimativa |
|---|---|
| Railway (servidor + volume de 1 GB) | ≈ US$ 5/mês (plano Hobby) |
| Web Push | Gratuito |
| Domínio próprio (opcional) | ≈ R$ 40/ano (`.com.br`) |

## v2 (3D): atenção ao custo

Animar o avião em tempo real exige posição e trilha, que **não vêm pelos alertas**:

| Estratégia | Custo por voo de 10 h |
|---|---|
| `/position` a cada 1 min com a tela aberta | 600 × 0,010 = **US$ 6,00** ❌ |
| `/position` a cada 5 min com a tela aberta | 120 × 0,010 = **US$ 1,20** |
| `/track` uma vez ao abrir + interpolação local pela rota e ETA | **≈ US$ 0,02** ✅ |

Recomendação para a v2: **uma chamada de `/track` ao abrir a tela, e o resto é interpolação no front** (ver [06-v2-3d.md](06-v2-3d.md)).
