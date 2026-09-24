#!/usr/bin/env node
// PostToolUse hook (matcher: TodoWrite) — grava % de progresso pro Simbionte
// em disco (~/.claude/simbionte-store.js) — sem servidor HTTP no caminho.
const { resolverProjetoAtivo, atualizarProgresso } = require('./simbionte-store');

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const todos = data.tool_input?.todos || [];
    if (!todos.length) return process.exit(0);

    const proj = resolverProjetoAtivo(data.cwd || process.cwd());
    if (!proj) return process.exit(0);

    const total = todos.length;
    const completed = todos.filter(t => t.status === 'completed').length;
    const active = todos.find(t => t.status === 'in_progress');
    atualizarProgresso(proj.id, proj.name, {
      percent: Math.round((completed / total) * 100), completed, total,
      activeLabel: active ? (active.activeForm || active.content) : null,
      updatedAt: Date.now(),
    }, proj.path);
  } catch (e) { /* payload inválido ou projeto não reconhecido — ignora */ }
  process.exit(0);
});
