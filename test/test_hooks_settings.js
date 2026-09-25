// Instalar/remover hooks no settings.json: idempotente, não duplica quem veio
// da 1.0.x e nunca mexe em hook de outra ferramenta.
const assert = require('assert');
const { HOOKS, hooksFaltando, adicionarHooks, removerHooks } = require('../hooks-settings.js');

const DIR = '/home/x/.claude';
const terceiro = { matcher: '', hooks: [{ type: 'command', command: 'node "/home/x/.claude/usage-warn-hook.js"' }] };
const clone = o => JSON.parse(JSON.stringify(o));

// Instalação limpa, preservando o hook de terceiro no mesmo evento.
const s = adicionarHooks({ model: 'opus', hooks: { UserPromptSubmit: [clone(terceiro)] } }, DIR);
assert.strictEqual(hooksFaltando(s).length, 0);
assert.strictEqual(s.model, 'opus');
assert.deepStrictEqual(s.hooks.UserPromptSubmit[0], terceiro, 'hook de terceiro intacto');
assert.ok(!('matcher' in s.hooks.Stop[0]), 'Stop não aceita matcher');
assert.strictEqual(s.hooks.PreToolUse[0].matcher, 'Bash');

// Rodar de novo não duplica nada.
const antes = JSON.stringify(s);
assert.strictEqual(JSON.stringify(adicionarHooks(s, DIR)), antes, 'segunda instalação é no-op');

// Quem veio da 1.0.x (só PostToolUse, matcher editado à mão) ganha só o que falta.
const v10 = { hooks: { PostToolUse: [
  { matcher: 'TodoWrite', hooks: [{ type: 'command', command: 'node "/home/x/.claude/progress-hook.js"' }] },
  { matcher: 'Edit|Write|Bash|MultiEdit', hooks: [{ type: 'command', command: 'node "/home/x/.claude/activity-hook.js"' }] },
] } };
assert.strictEqual(hooksFaltando(v10).length, HOOKS.length - 2);
adicionarHooks(v10, DIR);
assert.strictEqual(v10.hooks.PostToolUse.length, 2, 'não duplica os hooks antigos');
assert.strictEqual(hooksFaltando(v10).length, 0);

// Remoção: só sobra o que é de terceiro; eventos vazios somem.
const r = removerHooks(clone(s));
assert.deepStrictEqual(r.hooks, { UserPromptSubmit: [terceiro] });
assert.strictEqual(r.model, 'opus');
// Entrada mista (nosso + terceiro no mesmo bloco): tira só o nosso.
const misto = { hooks: { Stop: [{ hooks: [{ command: 'node "/h/.claude/estado-hook.js"' }, { command: 'say done' }] }] } };
assert.deepStrictEqual(removerHooks(misto).hooks.Stop[0].hooks, [{ command: 'say done' }]);
// Tudo nosso: a chave hooks some por completo.
assert.ok(!('hooks' in removerHooks(adicionarHooks({}, DIR))));

console.log('OK: instalar/remover hooks no settings.json');
