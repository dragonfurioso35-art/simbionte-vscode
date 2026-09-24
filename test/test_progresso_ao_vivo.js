// Self-check: progressoDoPlano lê o plano direto do disco — depois de um
// "git pull" (aqui simulado reescrevendo o arquivo sem passar pelo hook),
// o progresso já reflete o conteúdo novo, sem precisar de Edit/Write local.
// Sustenta o item "sincronizar entre as 2 máquinas" de extension.js:
// comProgressoAoVivo/planoMaisRecente.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
// Fonte do repo, não a cópia instalada em ~/.claude — testar a cópia deixa
// a fonte livre pra divergir sem ninguém perceber. Também destrava rodar
// esta suíte em qualquer máquina, não só na do autor.
const { progressoDoPlano } = require('../store.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'simbionte-plano-'));
const dir = path.join(tmpRoot, 'docs', 'superpowers', 'plans');
fs.mkdirSync(dir, { recursive: true });
const arquivo = path.join(dir, 'plano.md');

try {
  fs.writeFileSync(arquivo, '- [x] passo 1\n- [ ] passo 2\n');
  let p = progressoDoPlano(arquivo);
  assert.strictEqual(p.percent, 50);
  assert.strictEqual(p.completed, 1);
  assert.strictEqual(p.total, 2);

  // "git pull" trazendo o plano fechado da outra máquina — sem hook nenhum,
  // só o arquivo mudando no disco.
  fs.writeFileSync(arquivo, '- [x] passo 1\n- [x] passo 2\n');
  p = progressoDoPlano(arquivo);
  assert.strictEqual(p.percent, 100, 'leitura direta do disco deveria refletir o pull, sem Edit/Write');

  // fora do padrão docs/superpowers/plans -> ignora
  const outro = path.join(tmpRoot, 'nota.md');
  fs.writeFileSync(outro, '- [x] x\n');
  assert.strictEqual(progressoDoPlano(outro), null);

  console.log('OK: progressoDoPlano reflete o conteúdo do disco (git pull) sem depender do hook');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
