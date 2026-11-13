# Próximos passos

**Data:** 13/11/2026 · **Branch:** `claude/competent-bohr-5d64e4`

## O que foi feito nesta sessão

- Direção visual da interface web definida a partir de todos os docs: [docs/09-direcao-visual.md](docs/09-direcao-visual.md).
  - Conceito: a **placa de status** segue a gramática das placas de pista (amarelo = direção/normal, preto com borda amarela = posição/identificação, laranja = temporário/atraso, vermelho = obrigatório/cancelado).
  - Tokens de cor (claro "céu de dia" e escuro "céu de noite"), tipografia (Barlow Semi Condensed para placas e horários, Atkinson Hyperlegible Next para texto e digitação), espaçamento, raios e movimento.
  - Ponte para a v2: os tokens viram a paleta do globo Three.js, e o "palco" do desktop é onde o globo entra.
- Protótipo navegável das telas da v1: [prototipo/index.html](prototipo/index.html), com as telas início, erro, confirmação, status (em voo, atrasado, cancelado), link compartilhado e meus voos (com lista e vazia).
- Capturas verificadas (375 px e desktop, claro e escuro) em [docs/visual/](docs/visual/).

## Estado atual

- Funciona: navegação entre telas por hash, prévia do aviso que muda com o apelido, folha de "Parar de acompanhar", animação do avião na rota (desliga com reduced motion).
- Verificado: contrastes medidos (textos ≥ 5,46:1, controles ≥ 3,84:1), sem rolagem horizontal em 375 px nem com zoom de 200%.
- Não testado: celular real (sol, brilho baixo), leitor de tela real (VoiceOver/TalkBack).
- O protótipo é estático (dados de exemplo); não é o código da PWA.

## Próximos passos

- [ ] Revisar a direção visual com o usuário (e cruzar com a sessão paralela de `/design`, se ela produzir algo)
- [ ] Decidir se "Me avisar" substitui "Avisar-me" na [02-v1-alertas.md](docs/02-v1-alertas.md)
- [ ] Desenhar os estados que faltam: desviado, pousou/no portão na lista, offline e permissão de notificação negada
- [ ] Ícones da PWA (192/512 e maskable) a partir da placa de posição
- [ ] Ao implementar o Marco 3, levar os tokens de `prototipo/index.html` para `public/` como um `tokens.css`

## Comandos úteis

```bash
python -m http.server 5173 --directory prototipo
```

Abrir `http://localhost:5173/#status`. Use `?tema=escuro` ou `?tema=claro` para forçar o tema e `?ios=1` para ver o passo do iPhone.
