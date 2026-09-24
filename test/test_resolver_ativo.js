// Self-check: resolverProjetoAtivo deve preferir um sub-projeto tocado
// recentemente (dentro da mesma raiz) em vez de sempre cair na raiz do
// monorepo, que é o que TodoWrite (sem arquivo) faria sozinho.
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
// Fonte do repo, não a cópia instalada em ~/.claude — testar a cópia deixa
// a fonte livre pra divergir sem ninguém perceber. Também destrava rodar
// esta suíte em qualquer máquina, não só na do autor.
const { resolverProjeto, resolverProjetoAtivo } = require('../store.js');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simbionte-monorepo-'));
execSync('git init -q', { cwd: tmpRoot });
const addon = path.join(tmpRoot, 'addons', 'meu_addon');
fs.mkdirSync(addon, { recursive: true });
fs.writeFileSync(path.join(addon, '__manifest__.py'), '{}');

// Segundo addon: desde o fix de 2026-09-02, resolverProjeto() só separa em
// sub-projeto quando a raiz tem MAIS DE UM — repo de módulo único virava dois
// cards desconectados no painel. Este teste sempre quis um monorepo de verdade
// (o tmpdir se chama "simbionte-monorepo-"), mas montava um addon só, então
// passou a contradizer o fix. Sem este segundo addon, raiz e addon resolvem o
// mesmo id e o próprio setup do teste falha.
const outroAddon = path.join(tmpRoot, 'addons', 'outro_addon');
fs.mkdirSync(outroAddon, { recursive: true });
fs.writeFileSync(path.join(outroAddon, '__manifest__.py'), '{}');

const base = resolverProjeto(tmpRoot);
const subEsperado = resolverProjeto(addon);
assert.notStrictEqual(base.id, subEsperado.id, 'setup ruim: raiz e addon deveriam resolver ids diferentes');

// sem nenhum sub-projeto tocado recentemente -> cai pro cwd normal (raiz)
let semAtividade;
try {
  const semArquivo = path.join(DIR, `${subEsperado.id}.json`);
  try { fs.unlinkSync(semArquivo); } catch (e) {}
  semAtividade = resolverProjetoAtivo(tmpRoot);
  assert.strictEqual(semAtividade.id, base.id, 'sem sub-projeto tocado, deveria cair pro cwd (raiz)');

  // simula activity-hook.js tendo tocado o addon ha pouco
  fs.writeFileSync(semArquivo, JSON.stringify({
    projectId: subEsperado.id, projectName: subEsperado.id, projectPath: subEsperado.path,
    activity: [{ file: 'x.py', path: 'x.py', tool: 'Edit', ts: Date.now() }],
  }));
  const comAtividade = resolverProjetoAtivo(tmpRoot);
  assert.strictEqual(comAtividade.id, subEsperado.id, 'com addon tocado ha pouco, deveria preferir o sub-projeto, nao a raiz');

  console.log('OK: resolverProjetoAtivo prefere sub-projeto tocado recentemente, cai pro cwd sem isso');
} finally {
  try { fs.unlinkSync(path.join(DIR, `${subEsperado.id}.json`)); } catch (e) {}
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
