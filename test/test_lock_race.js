// Self-check: 2 processos registrando atividade quase ao mesmo tempo pro
// mesmo projeto nao devem se pisar (bug da auditoria: ler->mesclar->escrever
// sem lock perdia update). Roda de verdade com 2 processos node separados.
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');
const PROJ = '_teste_lock_race_' + Date.now();
const alvo = path.join(DIR, `${PROJ}.json`);

function limpar() {
  try { fs.unlinkSync(alvo); } catch (e) {}
  try { fs.unlinkSync(path.join(DIR, `.${PROJ}.lock`)); } catch (e) {}
}
limpar();

const storePath = path.join(os.homedir(), '.claude', 'simbionte-store.js').replace(/\\/g, '\\\\');
const script = (n) => `
const { registrarAtividade } = require('${storePath}');
registrarAtividade('${PROJ}', '${PROJ}', { file: 'arquivo${n}.js', path: 'C:/x/arquivo${n}.js', tool: 'Write', ts: Date.now() });
`;

const p1 = spawn(process.execPath, ['-e', script(1)]);
const p2 = spawn(process.execPath, ['-e', script(2)]);

let pendentes = 2;
function checarFim() {
  pendentes--;
  if (pendentes > 0) return;
  const dados = JSON.parse(fs.readFileSync(alvo, 'utf8'));
  assert.strictEqual(dados.activity.length, 2, `esperava 2 atividades registradas, achou ${dados.activity.length} — update perdido pela corrida`);
  limpar();
  console.log('OK: 2 escritas quase simultaneas nao se perderam (lock funcionou)');
}
p1.on('exit', checarFim);
p2.on('exit', checarFim);
