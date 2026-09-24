// Self-check da resolucao de URL do F2 (mesma logica de extension.js:lerUrlProjeto)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function lerUrlProjeto(urlsPath, projectId) {
  try { return JSON.parse(fs.readFileSync(urlsPath, 'utf8'))[projectId] || null; }
  catch (e) { return null; }
}

const tmp = path.join(os.tmpdir(), 'simbionte-urls-test-' + Date.now() + '.json');
fs.writeFileSync(tmp, JSON.stringify({ 'meu-monorepo': 'http://localhost:8069' }));

assert.strictEqual(lerUrlProjeto(tmp, 'meu-monorepo'), 'http://localhost:8069', 'deveria achar URL mapeada');
assert.strictEqual(lerUrlProjeto(tmp, 'projeto-sem-url'), null, 'projeto nao mapeado -> null (cai pro fallback de arquivo)');
assert.strictEqual(lerUrlProjeto(tmp + '.nao-existe', 'meu-monorepo'), null, 'arquivo ausente -> null, sem lancar erro');

fs.writeFileSync(tmp, '{ json invalido');
assert.strictEqual(lerUrlProjeto(tmp, 'meu-monorepo'), null, 'json invalido -> null, sem lancar erro');

fs.unlinkSync(tmp);
console.log('OK: resolucao de URL do F2 (com fallback)');
