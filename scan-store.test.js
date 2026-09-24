// Self-check do scan em disco: é o contrato entre o servidor (único
// escritor) e a extensão (leitora). Se quebrar, o painel passa a mostrar
// dado velho sem saber que é velho.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { escreverScan, lerScan, CAMINHO_SCAN } = require('./scan-store');

const backup = (() => {
  try { return fs.readFileSync(CAMINHO_SCAN(4577), 'utf8'); } catch (e) { return null; }
})();

try {
  // 1. nome do arquivo começa com "_" — lerTodosProjetos() da extensão trata
  // todo .json SEM esse prefixo como se fosse um projeto, e um scan.json
  // apareceria no painel como projeto fantasma.
  assert.ok(path.basename(CAMINHO_SCAN(4737)).startsWith('_'),
    'arquivo de scan precisa do prefixo _ pra não virar projeto fantasma');

  // 2. suffixado por porta — senão test.js (4577) sobrescreve o scan da
  // instância real (4737), mesmo raciocínio do PROGRESS_STATE_PATH.
  assert.notStrictEqual(CAMINHO_SCAN(4737), CAMINHO_SCAN(4577),
    'scan de portas diferentes não pode compartilhar arquivo');

  // 3. ida e volta
  const dados = { 'proj-a': { exists: true, lastCommitTs: 123 } };
  escreverScan(4577, dados);
  const lido = lerScan(4577);
  assert.deepStrictEqual(lido.data, dados);
  assert.ok(typeof lido.updatedAt === 'number' && lido.updatedAt > 0);

  // 4. ausente devolve null, não explode
  assert.strictEqual(lerScan(9999), null, 'scan inexistente devolve null');

  // 5. corrompido devolve null, não explode — o painel precisa sobreviver a
  // um arquivo truncado por queda de energia no meio da escrita.
  fs.writeFileSync(CAMINHO_SCAN(4578), '{"data":{"a":');
  assert.strictEqual(lerScan(4578), null, 'scan corrompido devolve null');

  console.log('scan-store: 5/5 ok');
} finally {
  for (const p of [4577, 4578]) { try { fs.unlinkSync(CAMINHO_SCAN(p)); } catch (e) {} }
  if (backup !== null) fs.writeFileSync(CAMINHO_SCAN(4577), backup);
}
