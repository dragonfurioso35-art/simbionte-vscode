// Self-check: atualizarProgresso grava viaBash=true quando origem='bash',
// pra o painel poder alertar de verdade em vez de só resincronizar em
// silêncio (era o comportamento antigo da trava da REGRA DE OURO).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
// Fonte do repo, não a cópia instalada em ~/.claude — testar a cópia deixa
// a fonte livre pra divergir sem ninguém perceber. Também destrava rodar
// esta suíte em qualquer máquina, não só na do autor.
const { resolverProjeto, atualizarProgresso, lerProjeto } = require('../store.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simbionte-viabash-'));
execSync('git init -q', { cwd: tmpRoot });
const proj = resolverProjeto(tmpRoot);

try {
  atualizarProgresso(proj.id, proj.name, { percent: 50, completed: 1, total: 2, activeLabel: null, updatedAt: Date.now() }, proj.path, 'edit');
  assert.strictEqual(lerProjeto(proj.id).progress.viaBash, false, 'origem edit não deveria marcar viaBash');

  atualizarProgresso(proj.id, proj.name, { percent: 100, completed: 2, total: 2, activeLabel: null, updatedAt: Date.now() }, proj.path, 'bash');
  assert.strictEqual(lerProjeto(proj.id).progress.viaBash, true, 'origem bash deveria marcar viaBash pro painel alertar');

  console.log('OK: atualizarProgresso marca viaBash quando origem é bash');
} finally {
  try { fs.unlinkSync(path.join(os.homedir(), '.claude', 'simbionte', `${proj.id}.json`)); } catch (e) {}
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
