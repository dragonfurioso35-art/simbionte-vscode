# Changelog

## 1.1.0 — 2026-09-25

Fim dos falsos alarmes de "travou".

- **Estado da sessão** no painel: trabalhando, aguardando você, executando comando (com o comando e há quanto tempo), sessão encerrada. Só alerta *possivelmente travada* quando o Claude estava trabalhando e ficou sem sinal.
- Novo hook `estado-hook.js` nos eventos `PreToolUse`/`PostToolUseFailure` (Bash), `Notification`, `Stop`, `UserPromptSubmit` e `SessionEnd`. Estado guardado por sessão (várias sessões abertas não se sobrescrevem).
- Setting `simbionte.limiteTravadoMin` (padrão 15).
- Comando **Simbionte: Remover hooks do Claude Code** — tira só as entradas do Simbionte do `settings.json` e apaga os arquivos copiados.
- Instalação acrescenta só os hooks que faltam; `settings.json.bak` é gravado só na primeira vez (guarda o original).
- Quem vem da 1.0.x recebe o aviso "há hooks novos" → **Atualizar hooks**.

## 1.0.1 — 2026-09-24

- README com print do painel.

## 1.0.0 — 2026-09-24

Primeira versão pública.

- Painel na Activity Bar: progresso de plano (`docs/superpowers/plans/*.md` e TodoWrite), atividade por projeto, alerta de hooks travados.
- Comando **Simbionte: Instalar hooks do Claude Code** — copia os hooks pra `~/.claude/` e registra no `settings.json` (com backup).
- Store e hooks empacotados dentro da extensão.
