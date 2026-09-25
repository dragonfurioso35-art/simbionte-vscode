# Watchdog com estados (Simbionte 1.1.0)

Objetivo: parar os falsos alarmes de "travou". Hoje só `PostToolUse` alimenta o
heartbeat, então esperar o usuário, rodar um comando longo ou encerrar a sessão
vira "travou" depois de 15 min.

- [x] store.js: heartbeat por sessão (`registrarHeartbeat(evento, data)`) + `estadoDaSessao` / `resumoSessoes` puros
- [x] claude-hooks/estado-hook.js: PreToolUse(Bash), PostToolUseFailure(Bash), Notification, Stop, UserPromptSubmit, SessionEnd
- [x] activity-hook.js grava evento PostToolUse com session_id
- [x] hooks-settings.js: HOOKS por evento, registro idempotente, .bak só na 1ª vez, remoção
- [x] extension.js: estado por sessão, setting simbionte.limiteTravadoMin, comando removerHooks, aviso de hooks desatualizados
- [x] build.html: banner/linha de estado com texto vindo da extensão
- [x] testes: estados + instalar/remover; test-all verde (exceto insights-paridade, que já falhava antes: depende dos repos locais)
- [x] README (dor, PT/EN, eventos, remoção) + CHANGELOG 1.1.0 + versão
- [ ] teste real: instalar o .vsix, Atualizar hooks, ver os estados (sleep 120 / permissão / exit)
- [ ] GIF de ~10s (Oscar grava) → docs/painel.gif no topo do README
- [ ] Open VSX: conta Eclipse + namespace (Oscar), `npx ovsx publish` (Claude)
- [ ] decidir publisher antes da divulgação
- [ ] commit + push + publicar 1.1.0 no Marketplace
