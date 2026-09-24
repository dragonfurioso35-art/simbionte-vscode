// Self-check da maquina de estado do alerta de travamento (F1) - mesma
// logica de extension.js:iniciarAlertaTravamento, sem vscode.
const assert = require('assert');
const LIMITE = 15 * 60 * 1000;

function criarEstado() {
  let vistoFresco = false, jaAlertou = false;
  return {
    tick(agora, lastRun) {
      let alertou = false;
      if (agora - lastRun < LIMITE) { vistoFresco = true; jaAlertou = false; }
      else if (vistoFresco && !jaAlertou) { jaAlertou = true; alertou = true; }
      return alertou;
    },
  };
}

// 1) nunca viu heartbeat fresco (extensao acabou de abrir, Claude Code parado) -> nunca alerta
let e1 = criarEstado();
assert.strictEqual(e1.tick(1_000_000, 0), false, 'nao deveria alertar sem nunca ter visto fresco');

// 2) viu fresco, depois passa 20min sem heartbeat -> alerta uma vez
let e2 = criarEstado();
assert.strictEqual(e2.tick(0, 0), false); // fresco
assert.strictEqual(e2.tick(20 * 60 * 1000, 0), true, 'deveria alertar apos 20min parado');
assert.strictEqual(e2.tick(21 * 60 * 1000, 0), false, 'nao deveria repetir alerta no mesmo episodio');

// 3) volta a ficar fresco -> reseta, permite alertar de novo num novo episodio
assert.strictEqual(e2.tick(22 * 60 * 1000, 22 * 60 * 1000), false); // fresco de novo
assert.strictEqual(e2.tick(42 * 60 * 1000, 22 * 60 * 1000), true, 'deveria alertar de novo em novo episodio');

console.log('OK: maquina de estado do alerta de travamento');
