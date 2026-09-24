# Design

<!-- impeccable:design-schema 1 -->

## World

Constelação hexagonal — "segundo cérebro" vivo. Referência pinada pelo
usuário: vídeo "WhatsApp Video 2026-09-09 at 17.45.27" (demo de app de
memória/grafo pessoal). Substitui o mundo anterior ("água-viva
bioluminescente": círculos, curvas orgânicas, esporos flutuantes) por um
mundo de **observatório/mapa estelar**: hexágonos-nó, anéis radiais fixos
por categoria com rótulo+contagem, um núcleo central pulsante que ancora
tudo. Fundo quase preto herdado do mundo anterior (já pertencia à
identidade "Simbionte" antes deste reskin — não é retomada do vídeo).

THESIS: o brilho é o dado, não clima — recriar a constelação "segundo
cérebro" do vídeo como painel funcional de git real, sem perder nenhuma
interação já validada (arrastar, fixar, filtrar, abrir painel, abrir no
VS Code).

OWN-WORLD: fundo radial quase preto; nós = hexágono com contorno em glow
(cor da categoria) e núcleo pequeno preenchido; 4 anéis fixos (um por
categoria de status), cada um com arco-rótulo "CATEGORIA · N"; hub central
pulsante mostra o total de organismos; foco (hover/seleção) vira âmbar-
branco quente, destacado do resto — o mesmo lampejo do nó central do
vídeo, mas reaproveitado como estado de interação, não como identidade
fixa de um nó.

STORY: o usuário abre localhost:4737 e vê o hub com os 17 projetos
distribuídos em 4 anéis; brilho e pulso comunicam vitalidade (commit
recente = brilha, parado = apaga); clicar abre o painel lateral já
existente; alterna entre "Anéis" (mapa radial fixo, novo padrão) e "Teia"
(deriva orgânica antiga, mantida como modo alternativo) por um par de
abas no topo.

FIRST VIEWPORT: canvas full-bleed; título pequeno centralizado no topo;
abaixo dele, par de abas "Anéis / Teia"; hub no centro da tela; 4 anéis
distribuídos em cruz (topo-direita ativo, direita pausado, baixo morto,
esquerda sem-status — ajustável para caber contagem real); legenda de
categorias e botão "reorganizar" mantidos no rodapé, mesma posição de
antes.

FORM: direção pinada pelo próprio usuário (referência de vídeo trazida
por ele) — sem torneio de conceitos; execução direta da referência
adaptada aos dados e interações reais do Simbionte.

## Color strategy

Full palette (3-4 named roles) — justificado: a cor carrega significado
funcional (status real do projeto), não é decoração. Mantém os 4 tons já
em uso (evidência de produto, não trocar por gosto):

- `--ativo:  #3fe8c4` (verde-água — vivo, mesma cor de antes)
- `--pausado:#ffb757` (âmbar — mesma cor de antes)
- `--morto:  #6b6f8a` (cinza-violeta apagado — mesma cor de antes)
- `--semstatus:#c98bff` (violeta — mesma cor de antes)
- `--focus:  #ffedc2` (dourado bem pálido, quase branco — NOVO: estado de
  foco/hover/hub, inspirado no nó central em glow amarelo do vídeo;
  substitui o branco puro usado antes para hover). Ajustado durante o
  build: uma primeira tentativa em âmbar saturado (`#ffd97a`) colidia
  visualmente com o `atencao` (`#ffd166`, anel de severidade) e com
  `--pausado` — o tom final é deliberadamente mais claro/frio-branco que
  os dois para não ser confundido com "atenção" ou "pausado" num relance.
  Usado só onde o significado é literalmente "isto está em foco" (nó
  hover/selecionado, hub, título do painel de detalhes, tooltip, aba de
  modo ativa) — o contador geral "organismos ativos" no canto superior
  direito continua em `--ativo` (teal), por não representar um nó focado.
- `--bg1:#020a0a`, `--bg2:#03120f` (mantidos do mundo anterior — já eram
  "quase preto" antes do reskin, não vieram do vídeo)

## Type

Mantém `Cormorant Garamond` (display, títulos/hub) + `Jost` (UI, labels,
painel) — já eram a identidade tipográfica do Simbionte, preservada.
Rótulos de anel usam Jost com tracking largo (.16–.2em), versalete,
tamanho pequeno (10–11px), ecoando os rótulos em caixa-alta do vídeo
("ROTINAS", "MEMÓRIA · 336") sem copiar fonte alguma dele (vídeo não
definiu tipografia própria reconhecível — é chrome de app de terceiro).

## Node language

- Hexágono "pointy-top" desenhado via path canvas (6 pontos), não CSS —
  contorno com `shadowBlur` na cor da categoria, núcleo pequeno
  preenchido. Tamanho e opacidade do glow seguem `freshness` (dado real),
  igual à física anterior.
- Nó em hover/seleção: contorno e núcleo mudam para `--focus`, escala
  cresce ~1.3x, glow mais intenso — é o único lugar onde a cor de
  categoria cede lugar, de propósito (estado, não identidade).
- Anel de severidade (alerta/atenção/info) continua como stroke fino por
  fora do hexágono, mesmas cores de antes (`#ff6f6f` / `#ffd166` /
  `#8fd9ff`).

## Layout

- Modo **Anéis** (padrão): 4 anéis concêntricos-radiais fixos, um por
  categoria, ao redor de um hub central. Nós de cada categoria distribuem-
  se em arco ao longo do raio da categoria (não em círculo completo
  sobreposto), com leve jitter físico (repulsão) para não colidir — não
  são posições 100% estáticas, têm a mesma física de repulsão de antes,
  só que presas a um arco em vez de soltas.
- Modo **Teia**: comportamento físico anterior preservado (âncoras soltas,
  nós migram livre, curvas com wobble) — vira modo alternativo, não é
  descartado.
- Troca de modo por par de abas no topo (abaixo do header), estilo pill,
  mesma linguagem visual das pills já usadas na legenda/botão reset.
- Hub central: hexágono maior, pulso permanente sutil, mostra contagem
  total; clique nele reseta zoom/filtro (equivalente ao botão
  "reorganizar", não duplica lógica nova).

## Motion

Um momento autoral: o pulso de "respiração" do hub (já existe como
`.breathe` — reaproveitado, não recriado). Transição de hover para
`--focus` é o único outro movimento novo, curva ease-out, ~150ms via
propriedades já animadas em canvas (sem CSS transition nova a inventar).
Não adicionar mais camadas de motion além dessas duas.

## Segunda superfície: build.html (painel VS Code)

Herda este mundo (não é um novo mundo — mesma paleta/forma hexagonal),
adaptado pra uma coluna estreita (~160-320px, barra lateral do VS Code):

- Reactor: os 40 segmentos de arco viraram miçangas hexagonais (mesma
  forma dos nós do mapa cheio) num anel SVG; cor/glow reagem a severidade
  igual antes (teal padrão, âmbar `atencao`, vermelho `alerta` — cores de
  severidade INTOCADAS, ver nota de colisão abaixo).
- Mini-mapa novo: hub + 4 arcos de categoria com nós hexagonais em miniatura,
  **leitura rápida, sem drag/filtro/hover** (decisão do usuário) — dado real
  vem de `data.js` (categorias/contagem) + `/api/status` (freshness por
  opacidade). Sem rótulo de texto no SVG (não cabe); contagem por categoria
  fica numa legenda abaixo, mesmo padrão do mapa cheio.
- Cor `--focus` usada só no hub do mini-mapa — mesmo princípio do mapa
  cheio (foco/destaque, não identidade de categoria).
- **Iteração (2026-09-09, feedback real):** reactor e mini-mapa ficaram
  soltos, cada um com seu título/divisor — lia como "2 interfaces" em vez
  de 1. Corrigido fundindo os dois num `.instrument` só: mesmo cartão de
  vidro (`--glass`/`--edge`, já usado em `.sig-item`/`.act-item` — reuso,
  não invenção), sem título "mapa", sem divisor entre reactor e mini-mapa,
  e um campo de glow ambiente (`::before` radial, opacidade baixa) que
  "respira" atrás dos dois — é esse glow compartilhado que faz ler como
  um instrumento (close-up da tarefa + zoom-out de todos os projetos), não
  dois widgets colados. O reactor encolheu de 180px pra 150px pra caber
  os dois no mesmo cartão sem esmagar o mini-mapa.
- **Escopo por sessão:** o painel só mostra o progresso/atividade do
  projeto cuja pasta está aberta NAQUELA janela do VS Code (extension.js
  manda `?cwd=` na URL do iframe; server.js resolve pra um id de
  `data.js`). N janelas abertas em N projetos = N reactors certos, cada
  um no seu — sem isso, TodoWrite de uma sessão sobrescrevia o % de
  outra (achado real, 2026-09-09). Um rótulo "sessão · <projeto>" aparece
  acima do cartão só quando o cwd resolve pra um projeto catalogado.

Pendência conhecida, não resolvida neste build: `--pausado` (`#ffb757`) e
a cor de severidade `atencao` (`#ffd166`) continuam próximas — a mesma
colisão já registrada pro mapa cheio. Ficou de fora aqui porque
`atencao`/`alerta`/`info` são cores compartilhadas com `simbionte.html` e
mudar uma sem mudar a outra quebra a consistência entre as duas telas.

## Preserved from before (not part of this reskin)

Sem autenticação/HTTPS (decisão de produto, ver PRODUCT.md), painel
lateral de detalhes, endpoints `/api/status` `/api/insights` `/api/open`,
persistência de layout em `localStorage`, botão "abrir no VS Code",
idioma pt-BR em toda a UI.
