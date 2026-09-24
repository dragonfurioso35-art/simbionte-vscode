// Persistência do scan git em disco — o contrato entre o servidor (único
// escritor) e a extensão (leitora). Antes disso o scan só vivia em memória
// no server.js, então o painel morria junto com o servidor.
//
// Separado do store.js de propósito: o store fala de PROJETOS (progresso,
// atividade, escritos pelos hooks), este fala de SCAN (estado do git,
// escrito pelo servidor). Misturar os dois faria o store depender do
// git-scan, que é caro e assíncrono.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');

// Prefixo "_": lerTodosProjetos() na extensão trata todo .json sem prefixo
// como projeto — um "scan.json" apareceria no painel como projeto fantasma.
// Sufixo de porta: mesmo raciocínio do PROGRESS_STATE_PATH (server.js:34) —
// sem ele, test.js na 4577 sobrescreveria o scan da instância real.
function CAMINHO_SCAN(porta) {
  return path.join(DIR, `_scan.${porta}.json`);
}

function escreverScan(porta, data) {
  fs.mkdirSync(DIR, { recursive: true });
  const alvo = CAMINHO_SCAN(porta);
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), data }));
  fs.renameSync(tmp, alvo); // atômico no mesmo volume — o leitor nunca pega
  // o arquivo pela metade, mesmo se o processo morrer entre write e rename.
}

function lerScan(porta) {
  try {
    const bruto = JSON.parse(fs.readFileSync(CAMINHO_SCAN(porta), 'utf8'));
    if (!bruto || typeof bruto.updatedAt !== 'number' || !bruto.data) return null;
    return bruto;
  } catch (e) {
    return null; // ausente, truncado ou ilegível — quem chama decide o que mostrar
  }
}

module.exports = { escreverScan, lerScan, CAMINHO_SCAN };
