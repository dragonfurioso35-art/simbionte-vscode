# Simbionte

**Painel ao vivo, dentro do VS Code, do que o Claude Code está fazendo.**
Progresso dos planos, arquivos tocados e alerta quando a sessão trava — sem
servidor, sem conta, sem enviar nada pra lugar nenhum.

> **EN:** A VS Code sidebar that shows, live, what Claude Code is doing:
> plan progress (`- [ ]` / `- [x]` checkboxes), files touched, and an alert
> when hooks stop firing. 100% local — two small Claude Code hooks write
> JSON to `~/.claude/simbionte/`, the panel reads it. UI in Portuguese.

## O que ele mostra

- **Progresso do plano** — lê os checkboxes de `docs/superpowers/plans/*.md`
  (convenção do plugin [superpowers](https://github.com/obra/superpowers)) e
  a lista de tarefas (TodoWrite) do Claude Code. Notifica quando o plano
  chega a 100%.
- **Atividade** — quais arquivos o agente editou, em qual projeto, e há
  quanto tempo.
- **Travamento** — se nenhum hook rodar por 15 min, aparece um alerta.
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

O que o passo 2 faz, pra você saber antes de clicar:

- copia `progress-hook.js`, `activity-hook.js` e `simbionte-store.js` pra `~/.claude/`;
- adiciona 2 entradas `PostToolUse` no `~/.claude/settings.json`
  (matchers `TodoWrite` e `Edit|Write|Bash`), **sem mexer** nos hooks que já
  existem, e salva um `settings.json.bak` antes.

Rodar o comando de novo só atualiza os arquivos (útil depois de atualizar a
extensão).

Requisitos: VS Code 1.85+, Node no PATH (os hooks rodam com `node`),
Claude Code.

### Opcional: abrir o app do projeto com um clique

Crie `~/.claude/simbionte-urls.json` mapeando id do projeto → URL
(ver [`simbionte-urls.example.json`](vscode-extension/simbionte-urls.example.json)).

## Privacidade

Tudo fica no seu disco, em `~/.claude/simbionte/`. A extensão não faz
nenhuma chamada de rede. Para desinstalar por completo: remova as 2 entradas
do `settings.json` (ou restaure o `.bak`), apague os 3 arquivos em
`~/.claude/` e a pasta `~/.claude/simbionte/`.

---

## Para quem quer mexer no código

### Estrutura

```
store.js            <- leitura/escrita de ~/.claude/simbionte/ (o contrato de dados)
claude-hooks/       <- fonte dos hooks PostToolUse (progress-hook.js, activity-hook.js)
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
