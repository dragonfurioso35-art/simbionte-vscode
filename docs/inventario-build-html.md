# Inventário visual — os dois `build.html`

Levantamento manual (os dois montam o DOM via JavaScript, então `grep` não
adianta) do que cada geração efetivamente desenha na tela. Serve de base pra
Task 9 (porte pra dentro da geração A, que vira a base porque o painel final
usa `postMessage`, não iframe/HTTP).

- **Geração A** = `../simbionte-extension/media/build.html` (432 linhas,
  transporte `postMessage`, mensagens `update`/`commandStatus` vindas de
  `extension.js`)
- **Geração B** = `build.html` (417 linhas, transporte `fetch` +
  `EventSource`, endpoints `/api/status`, `/api/insights`, `/api/progress`,
  `/api/events`)

Convenção da coluna "existe": **Sim** / **Não** / **Parcial** (existe algo
parecido mas com diferença que importa pro porte) / **Incerto** (não dá pra
confirmar só lendo os dois `build.html`).

| # | Elemento (o que o usuário vê) | Existe na A? | Existe na B? |
|---|---|---|---|
| 1 | Anel de progresso segmentado — ~40 "miçangas" hexagonais dispostas em círculo, acendem em sequência conforme a % concluída | Não | Sim (`#ring`, 40 `<polygon>` hexagonais, `R=42`) |
| 2 | Percentual centralizado dentro do anel | Não (percentual aparece como texto à direita de uma barra linear, ver #20) | Sim (`#pct`) |
| 3 | Glow pulsante atrás do anel (halo "respirando" continuamente) | Não | Sim (`.core-glow`, `@keyframes pulse`) |
| 4 | Contador bruto "X / Y etapas" abaixo do anel | Não (A só expõe percentual, nunca contagem completada/total) | Sim (`#steps`) |
| 5 | Texto de status da tarefa em curso ("construindo: **X**" / "tarefa concluída" / "sistema em espera") | **Parcial** — A mostra por linha de projeto (`infoLinha()`), e tem um 4º estado que B não tem: "ativo: **arquivo**" quando há atividade sem plano de progresso | **Parcial** — B mostra só para o projeto da janela atual (escopado por `?cwd=`), como texto único abaixo do anel (`#label`) |
| 6 | Nota efêmera "✎ **arquivo**" que aparece e some sozinha ao detectar toque em arquivo agora | Não | Sim (`#touchNote`, aparece via evento SSE `activity`, some após 3.2s) |
| 7 | Flash de borda no cartão ao detectar atividade agora | Não — mecanismo mais próximo é outro (ver #21): respiração contínua na bolinha mais recente, não um flash único por evento | Sim (`.instrument.touched`, animação `touchFlash` de 0.9s, disparada por SSE) |
| 8 | Cor do indicador muda por severidade (vermelho = alerta, amarelo = atenção) | Não | Sim (`.reactor.sev-alerta` / `.sev-atencao`, aplicado ao anel + glow conforme `insights.synthesis`) |
| 9 | Tag de sessão no topo ("sessão **nome do projeto**") | Não | Sim, oculta por padrão (`#sessionTag`). Só aparece se `state.projectName` vier de `/api/progress`. **Incerto**: não dá pra confirmar, só lendo este arquivo, que esse campo é populado na prática — depende do lado do servidor, fora do escopo desta leitura |
| 10 | Mini-mapa radial "zoom-out": 4 arcos por categoria de status (ativo/pausado/morto/sem status), com nós hexagonais por projeto (opacidade = frescor do commit) e hub central | Não — o mapa de sinapses da A (#15) cobre só os projetos ativos recentes, não todos os catalogados por categoria | Sim (`#miniMap`, dados de `fetch('/api/status')` + `data.js` global `PROJECTS`/`CATEGORIES`) |
| 11 | Legenda do mini-mapa (swatch colorido + nome da categoria + contagem) | Não | Sim (`#miniLegend`) |
| 12 | Painel "saúde dos ativos": lista ordenada (pior primeiro) com badge de nota A–D colorido, nome do projeto e motivo | Não | Sim (`#healthList`, de `insights.health`; estados vazios "calculando…" e "nenhum projeto ativo catalogado") |
| 13 | Lista "sinais": cartões com mensagem + id do projeto, borda colorida por severidade (alerta/atenção/info) | Não | Sim (`#signalsList`, de `insights.synthesis`, até 5 itens, estado vazio "tudo tranquilo"). **Incerto**: o CSS define `.sig-item.info` (borda azul), mas não confirmei — só lendo os `build.html` — se `insights.js` chega a emitir severidade `info` na prática, ou se é uma classe morta |
| 14 | Divisor horizontal (linha em degradê) entre blocos | Sim — 1 divisor, entre a lista de projetos e a seção "hoje" | Sim — 2 divisores, um antes e um depois do painel de saúde |
| 15 | Mapa de sinapses: núcleo à esquerda + até 5 satélites (projetos mais recentes) ligados por curvas (dendritos), com pulso animado viajando satélite→núcleo quando a atividade de um projeto avança de verdade | Sim (`#synapseMap`) | Não |
| 16 | Banner de alerta "nenhum hook rodou nos últimos 15 min — Claude Code pode ter travado" | Sim, oculto por padrão (`#banner`). Depende de `postMessage`: a flag `travado` é calculada pelo `extension.js` (fora do escopo desta leitura) e só chega via mensagem `update` | Não — B silencia falhas de fetch/SSE mantendo o último estado na tela, sem aviso visível |
| 17 | Caixa de comando ("JARVIS"): campo de texto + botão enviar, desabilita durante execução | Sim (`#cmdInput` / `#cmdBtn`). Depende do transporte `postMessage`/`acquireVsCodeApi()` — envia `{type:'runCommand'}` | Não — B é somente leitura, não existe canal para B executar comando algum |
| 18 | Bloco de saída do comando (texto retornado, monoespaçado, com scroll, até 180px de altura) | Sim (`#cmdOutput`), populado pela mensagem `commandStatus` | Não |
| 19 | Cabeçalho de seção "projetos" com contador total à direita | Sim (`#statusCount`) | Não — equivalente mais próximo é a legenda do mini-mapa (#11), mas conta por categoria, não total de projetos ativos |
| 20 | Lista de linhas de status, uma por projeto ativo: bolinha de cor por recência (verde/amarelo/vermelho), nome + tempo relativo, linha de info (#5), barra de progresso linear + percentual, ícone de aviso se checkbox foi editado via Bash | Sim (`#statusList`) | Não — B só mostra o projeto da janela atual (via anel), nunca uma lista multi-projeto com barra linear |
| 21 | Bolinha de status "respirando" continuamente (indicador de "ao vivo"), só na linha mais recente | Sim (`.status-dot.pulso`, `@keyframes respirar`) | Não |
| 22 | Linhas de projeto clicáveis (mouse ou teclado) que abrem o arquivo/projeto | Sim — `postMessage({type:'openApp', projectId, path})`, com suporte a Enter/Espaço via teclado | Não — B não tem nenhuma interação de clique |
| 23 | Seção "hoje": título dinâmico ("hoje — N edições em M projetos") + lista de cartões com nome do projeto e contagem de edições do dia | Sim (`#hojeList` / `#hojeTitle`) | Não |
| 24 | Estados vazios textuais quando não há dado ainda | Sim — "nenhum projeto com atividade ainda", "nenhuma edição hoje ainda" | Sim — "calculando…" (saúde), "nenhum projeto ativo catalogado" (saúde), "tudo tranquilo" (sinais) |
| 25 | Ajuste responsivo por largura do painel (esconde info secundária/rótulos abaixo de 210px; aumenta respiro/fonte acima de 360px) | Sim (`@container painel`, dois breakpoints) | Não — B assume uma sidebar estreita fixa, sem container queries |
| 26 | Agrupamento visual deliberado: anel + mini-mapa dividem **um único cartão** ("instrument"), sem título/divisor entre eles, por decisão de design registrada em comentário (evitar ler como "2 widgets colados") | Não se aplica (A não tem os dois elementos) | Sim — importante pro porte: se o anel for pra dentro da A mas o mini-mapa não, essa decisão de "1 instrumento" de B se perde ou precisa ser recriada de propósito |

## O que ficou sem confirmação só de leitura

- **`#sessionTag` (linha 9)**: código alcançável, não é branch morto, mas não
  dá pra confirmar sem ler o servidor se `state.projectName` chega populado
  na prática.
- **`.sig-item.info` (linha 13)**: classe CSS existe e o JS aplicaria
  qualquer valor de `severity` vindo de `insights.synthesis`; não li
  `insights.js`, então não sei se a severidade `info` é de fato emitida ou é
  CSS morto.
- **Mini-mapa (linha 10) e mapa de sinapses (linha 15)** parecem cobrir a
  mesma necessidade ("visão geral de todos os projetos") com modelos de dado
  bem diferentes — um por categoria/status global, outro por recência dos
  5 mais ativos. O plano já sabia do anel e do bloco de insights; este mapa
  de status por categoria **não** estava na lista conhecida de "2 pendências"
  e precisa de decisão explícita na Task 9 (portar, descartar ou conviver com
  o mapa de sinapses).

## O que NÃO foi feito aqui

Nenhum dos dois `build.html` foi modificado. `extension.js` não foi tocado.
Este documento não decide o porte — só descreve o que existe hoje, pra Task 9
não decidir às cegas.
