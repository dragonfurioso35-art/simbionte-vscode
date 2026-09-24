// Self-check da regra do aviso "checkbox editado via Bash" (store.viaBashNovo).
// Achado 2026-09-23: git add/commit do plano (Bash que só CITA o arquivo)
// acendia o ⚠ em todo projeto trabalhado, sem checkbox nenhum mudar.
const assert = require('assert');
const { viaBashNovo } = require('./store');

const p = (completed, total, viaBash) => ({ completed, total, viaBash });

assert.strictEqual(viaBashNovo(p(11, 43, false), p(11, 43), 'bash'), false,
  'Bash sem mudar progresso (git commit do plano) não acende o aviso');
assert.strictEqual(viaBashNovo(p(11, 43, true), p(11, 43), 'bash'), true,
  'Bash sem mudança mantém um aviso que já estava aceso');
assert.strictEqual(viaBashNovo(p(11, 43, false), p(12, 43), 'bash'), true,
  'Bash que mudou o progresso acende o aviso (regra de ouro)');
assert.strictEqual(viaBashNovo(null, p(1, 5), 'bash'), true,
  'primeiro registro vindo de Bash acende');
assert.strictEqual(viaBashNovo(p(11, 43, true), p(12, 43), 'edit'), false,
  'Edit sempre apaga o aviso');
console.log('viabash: ok');
