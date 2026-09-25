# Simbionte

**Deixou o Claude Code rodando e não sabe se ele terminou, travou ou está
esperando você?** O Simbionte mostra isso ao vivo numa barra lateral do VS
Code: progresso dos planos, arquivos tocados e o estado da sessão — sem
servidor, sem conta, sem enviar nada pra lugar nenhum.

<img src="https://raw.githubusercontent.com/dragonfurioso35-art/simbionte-vscode/main/docs/painel.png" alt="Painel do Simbionte: progresso do plano atual em 62%, lista de projetos e edições de hoje" width="360">

> **English.** Left Claude Code running and can't tell whether it finished,
> got stuck or is waiting for you? Simbionte is a VS Code sidebar that shows
> it live: plan progress (`- [ ]` / `- [x]`), files touched and session state
> (working, waiting for you, running a command, possibly stuck). 100% local:
> small Claude Code hooks write JSON to `~/.claude/simbionte/` and the panel
> reads it. The UI is in Portuguese.

## O que ele mostra

- **Progresso do plano** — lê os checkboxes de `docs/superpowers/plans/*.md`
  (convenção do plugin [superpowers](https://github.com/obra/superpowers)) e
  a lista de tarefas (TodoWrite) do Claude Code. Notifica quando o plano
  chega a 100%.
- **Atividade** — quais arquivos o agente editou, em qual projeto, e há
  quanto tempo.
- **Estado da sessão** — *Claude trabalhando*, *aguardando você* (resposta
  terminada ou pedido de permissão), *executando comando há N min* (com o
  comando), *sessão encerrada*. Só alerta **possivelmente travada** quando o
  Claude estava trabalhando e ficou sem sinal além do limite (15 min por
  padrão, ajustável em *Settings → Simbionte: Limite Travado Min*).
- **Checkbox marcado via Bash** — avisa quando o agente fechou item de plano
  por script em vez de Edit/Write (o jeito que mais deixa o painel
  desatualizado).
- Projeto identificado sozinho pela raiz git (e por sub-pacote em
  monorepos: `package.json`, `pyproject.toml`, `__manifest__.py`).

## Instalação

1. Instale **Simbionte** pelo Marketplace do VS Code (ou Open VSX) — ou baixe
   o `.vsix` na página de [Releases](https://github.com/dragonfurioso35-art/simbionte-vscode/releases) e use
   *Extensions → … → Install from VSIX*.
2. Na primeira abertura aparece *"os hooks do Claude Code ainda não estão
   instalados"* → **Instalar agora**. (Ou `Ctrl+Shift+P` →
   **Simbionte: Instalar hooks do Claude Code**.)
3. Abra uma sessão nova do Claude Code. Pronto — o ícone do Simbionte na
   Activity Bar mostra o painel.

Vindo da 1.0.x? A extensão avisa *"há hooks novos"* → **Atualizar hooks**.
Sem isso o painel funciona, mas o estado da sessão não aparece.

Requisitos: VS Code 1.85+, Node no PATH (os hooks rodam com `node`),
Claude Code.

### O que a extensão altera no seu computador

O passo 2 (e só ele — a extensão não mexe em nada sozinha):

- copia 4 arquivos pra `~/.claude/`: `progress-hook.js`, `activity-hook.js`,
  `estado-hook.js` e `simbionte-store.js`;
- adiciona entradas no `~/.claude/settings.json`, **sem mexer** nos hooks que
  já existem:

  | Evento | Matcher | Hook | Pra quê |
  |---|---|---|---|
  | `PostToolUse` | `TodoWrite` | progress-hook.js | progresso da lista de tarefas |
  | `PostToolUse` | `Edit\|Write\|Bash` | activity-hook.js | arquivos tocados, progresso do plano |
  | `PreToolUse` / `PostToolUseFailure` | `Bash` | estado-hook.js | "executando comando" |
  | `Notification`, `Stop` | — | estado-hook.js | "aguardando você" |
  | `UserPromptSubmit` | — | estado-hook.js | "trabalhando" |
  | `SessionEnd` | — | estado-hook.js | "sessão encerrada" |

- antes de alterar o `settings.json` pela primeira vez, salva o original em
  `settings.json.bak` (instalações seguintes não sobrescrevem esse backup).

Rodar o comando de novo é seguro: atualiza os arquivos e só acrescenta o que
faltar, sem duplicar.

### Remover / reverter

`Ctrl+Shift+P` → **Simbionte: Remover hooks do Claude Code**. Tira do
`settings.json` só as entradas do Simbionte (hooks de outras ferramentas
ficam) e apaga os 4 arquivos. Depois é só desinstalar a extensão e, se
quiser, apagar `~/.claude/simbionte/`. O `settings.json.bak` continua lá
caso você prefira voltar ao arquivo exatamente como era antes da instalação.

### Opcional: abrir o app do projeto com um clique

Crie `~/.claude/simbionte-urls.json` mapeando id do projeto → URL
(ver [`simbionte-urls.example.json`](vscode-extension/simbionte-urls.example.json)).

## Privacidade

Tudo fica no seu disco, em `~/.claude/simbionte/`. A extensão não faz
nenhuma chamada de rede. O comando de um Bash em execução é guardado ali
(primeiros 120 caracteres) só pra aparecer no painel.

---

## Para quem quer mexer no código

### Estrutura

```
store.js            <- leitura/escrita de ~/.claude/simbionte/ (o contrato de dados)
claude-hooks/       <- fonte dos hooks (progress-hook.js, activity-hook.js, estado-hook.js)
hooks-settings.js   <- puro: registrar/remover os hooks no settings.json
vscode-extension/   <- a extensão (media/build.html é o painel; lib/ é gerado pelo prepare.js)
insights.js         <- puro: sinais, síntese, nota de saúde, classificação
scan-store.js       <- persiste o scan git em _scan.<porta>.json
git-scan.js         <- lê git real de cada projeto
data.js             <- catálogo dos projetos (GERADO — node gerar-data.js --gravar)
server.js           <- (opcional) HTTP + grafo completo em simbionte.html
supervisor.js, run-server.cmd, deploy.js  <- autostart do servidor (Windows)
test-all.js         <- roda todas as suítes
```

### Como as peças conversam

O contrato é o **disco**, não HTTP:

```
hooks    ──escrevem──>  ~/.claude/simbionte/<projeto>.json     ──lê──>  painel
servidor ──escreve───>  ~/.claude/simbionte/_scan.<porta>.json ──lê──>  painel
```

O painel funciona sem o servidor. O servidor (opcional) só acrescenta o scan
git — saúde dos projetos e sinais como "sem commit há N dias" — e o grafo em
`simbionte.html`.

### Servidor opcional (saúde dos projetos)

```
node gerar-data.js --gravar   # monta data.js com os projetos que os hooks já viram
node server.js                # http://localhost:4737
```

Projetos são procurados em `~/Projects/<id>`; mude com a variável
`SIMBIONTE_PROJECTS_ROOT`. No Windows, `node deploy.js` empacota e instala a
extensão, copia os hooks e registra o servidor no Startup.

**Segurança:** o servidor não tem autenticação e manda
`Access-Control-Allow-Origin: *`. Isso só é aceitável porque ele escuta
apenas em loopback (`127.0.0.1`/`::1`, coberto por teste) e `/api/open` só
abre pastas já presentes em `data.js`. Não exponha fora do `localhost`.

**Porta 4737:** escolhida fora da faixa do Firebase Emulator Suite (4000,
4400, 4500, 5000, 5001, 8080, 8085, 9000, 9099, 9199, 9299, 9499) — a 4500
colidia com o Logging Emulator e o painel parava de atualizar em silêncio.

### Testes

```
node test-all.js
```

Zero dependências de propósito (não há `package.json` na raiz). Suítes são
descobertas sozinhas (`*.test.js` na raiz e `test/*.js`). Dependência
ausente (ex.: `playwright` no teste visual) aparece como `PULADO:`, não
como falha. `test.js` sobe uma instância isolada na porta 4577.

Alguns testes chamam os hooks instalados em `~/.claude/` — o CI copia antes
(ver `.github/workflows/ci.yml`).

## Licença

[MIT](LICENSE) © Oscar Wilder Rojas Rivero
