// Registro/remoção dos hooks do Simbionte no settings.json do Claude Code.
// Puro (recebe e devolve o objeto settings, sem disco nem vscode) pra ser
// testável; quem lê/grava o arquivo e faz o backup é o extension.js.
const path = require('path');

// evento -> matcher -> arquivo. Sem matcher = todos (e eventos como Stop e
// SessionEnd nem aceitam matcher).
const HOOKS = [
  { evento: 'PostToolUse', matcher: 'TodoWrite', file: 'progress-hook.js' },
  { evento: 'PostToolUse', matcher: 'Edit|Write|Bash', file: 'activity-hook.js' },
  { evento: 'PreToolUse', matcher: 'Bash', file: 'estado-hook.js' },
  { evento: 'PostToolUseFailure', matcher: 'Bash', file: 'estado-hook.js' },
  { evento: 'Notification', file: 'estado-hook.js' },
  { evento: 'Stop', file: 'estado-hook.js' },
  { evento: 'UserPromptSubmit', file: 'estado-hook.js' },
  { evento: 'SessionEnd', file: 'estado-hook.js' },
];
// Arquivos que o Simbionte copia pra ~/.claude (hooks + store).
const ARQUIVOS = [...new Set(HOOKS.map(h => h.file)), 'simbionte-store.js'];

// Por evento + arquivo, ignorando o matcher: quem instalou à mão com um
// matcher diferente (ex. "Edit|Write|Bash|MultiEdit") não ganha duplicata.
function jaTem(settings, h) {
  const entradas = (settings && settings.hooks && settings.hooks[h.evento]) || [];
  return entradas.some(e => (e.hooks || []).some(x => String(x.command || '').includes(h.file)));
}

function hooksFaltando(settings) {
  return HOOKS.filter(h => !jaTem(settings, h));
}

// Acrescenta só o que falta (idempotente). Não toca em hooks de terceiros.
function adicionarHooks(settings, claudeDir) {
  settings.hooks = settings.hooks || {};
  for (const h of hooksFaltando(settings)) {
    const entrada = { hooks: [{ type: 'command', command: `node "${path.join(claudeDir, h.file)}"`, timeout: 3 }] };
    if (h.matcher) entrada.matcher = h.matcher;
    (settings.hooks[h.evento] = settings.hooks[h.evento] || []).push(entrada);
  }
  return settings;
}

// Tira todo comando que cita um arquivo do Simbionte, em qualquer evento.
// Entrada que fica sem hook some; evento que fica vazio some. O resto
// (hooks de outras ferramentas) fica exatamente como estava.
function removerHooks(settings) {
  if (!settings || !settings.hooks) return settings;
  const nosso = x => ARQUIVOS.some(f => String(x.command || '').includes(f));
  for (const evento of Object.keys(settings.hooks)) {
    const entradas = (settings.hooks[evento] || [])
      .map(e => ({ ...e, hooks: (e.hooks || []).filter(x => !nosso(x)) }))
      .filter(e => e.hooks.length);
    if (entradas.length) settings.hooks[evento] = entradas;
    else delete settings.hooks[evento];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

module.exports = { HOOKS, ARQUIVOS, hooksFaltando, adicionarHooks, removerHooks };
