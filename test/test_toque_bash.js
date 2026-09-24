// Self-check: Bash genérico (sem file_path, sem referenciar plano nenhum)
// precisa contar como "você tá ativo aqui" — antes disso o hook dava
// return antes de resolver o projeto, e a bolinha de status ficava
// vermelha mesmo com o usuário trabalhando via comandos o tempo todo.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
// Fonte do repo, não a cópia instalada em ~/.claude — testar a cópia deixa
// a fonte livre pra divergir sem ninguém perceber. Também destrava rodar
// esta suíte em qualquer máquina, não só na do autor.
const { resolverProjeto, lerProjeto } = require('../store.js');

const HOOK = path.join(os.homedir(), '.claude', 'activity-hook.js');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simbionte-toque-'));
execSync('git init -q', { cwd: tmpRoot });
const proj = resolverProjeto(tmpRoot);

try {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd: tmpRoot, tool_input: { command: 'docker compose start odoo' } });
  execSync(`node "${HOOK}"`, { input: payload });

  const depois = lerProjeto(proj.id);
  assert.ok(depois, 'esperava projeto resolvido por cwd, mesmo sem file_path');
  assert.ok(typeof depois.lastTouch === 'number' && Date.now() - depois.lastTouch < 5000, 'lastTouch deveria estar recente');
  assert.strictEqual((depois.activity || []).length, 0, 'Bash sem arquivo não deveria virar "atividade" de arquivo fake');

  console.log('OK: Bash genérico registra lastTouch (recência), sem poluir activity');
} finally {
  try { fs.unlinkSync(path.join(os.homedir(), '.claude', 'simbionte', `${proj.id}.json`)); } catch (e) {}
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
