// Self-check: cor de recência da bolinha de status (mesma lógica de
// media/build.html:corRecencia) — substitui o anel único por N linhas,
// cada uma precisa sinalizar sozinha se está fresca, morna ou parada.
const assert = require('assert');

function corRecencia(ts) {
  if (!ts) return '';
  const diffMin = (Date.now() - ts) / 60000;
  if (diffMin < 5) return 'verde';
  if (diffMin < 15) return 'amarelo';
  return 'vermelho';
}

assert.strictEqual(corRecencia(null), '', 'sem nenhuma atividade -> sem cor (cinza no CSS)');
assert.strictEqual(corRecencia(Date.now()), 'verde');
assert.strictEqual(corRecencia(Date.now() - 4 * 60000), 'verde');
assert.strictEqual(corRecencia(Date.now() - 10 * 60000), 'amarelo');
assert.strictEqual(corRecencia(Date.now() - 20 * 60000), 'vermelho');

function tempoRelativo(ts) {
  if (!ts) return '';
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  return `${Math.round(diffMin / 60)}h`;
}

assert.strictEqual(tempoRelativo(null), '');
assert.strictEqual(tempoRelativo(Date.now()), 'agora');
assert.strictEqual(tempoRelativo(Date.now() - 2 * 60000), '2min');
assert.strictEqual(tempoRelativo(Date.now() - 90 * 60000), '2h');

console.log('OK: cor de recência + tempo relativo da linha de status');
