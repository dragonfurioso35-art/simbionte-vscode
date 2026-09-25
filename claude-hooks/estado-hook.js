#!/usr/bin/env node
// Hook de ESTADO da sessão pro watchdog do Simbionte. Um script só, registrado
// em vários eventos (PreToolUse/PostToolUseFailure com matcher Bash,
// Notification, Stop, UserPromptSubmit, SessionEnd) — o nome do evento vem no
// próprio payload (hook_event_name), então não precisa de um arquivo por evento.
//
// Nunca escreve em stdout: no UserPromptSubmit, stdout vira contexto do
// Claude; no Stop, uma saída errada poderia bloquear o fim da resposta.
const { registrarHeartbeat } = require('./simbionte-store');

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // Falha de Bash fecha o comando igual a um PostToolUse — senão a sessão
    // ficaria "executando comando" até o próximo evento.
    const evento = data.hook_event_name === 'PostToolUseFailure' ? 'PostToolUse' : data.hook_event_name;
    if (evento) registrarHeartbeat(evento, data);
  } catch (e) { /* payload inválido — ignora, hook nunca pode quebrar a sessão */ }
  process.exit(0);
});
