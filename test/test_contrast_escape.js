// Self-check: contraste AA do --dim novo contra --bg, e escapeHtml
// blindando campos numericos corrompidos (achados da critica impeccable).
const assert = require('assert');

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(hexA, hexB) {
  const [l1, l2] = [luminancia(hexA), luminancia(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const antigo = contraste('#4d7268', '#020a0a');
const novo = contraste('#7a9ba8', '#020a0a');
assert.ok(antigo < 4.5, `sanity check: --dim antigo deveria falhar AA (deu ${antigo.toFixed(2)}:1)`);
assert.ok(novo >= 4.5, `--dim novo deveria passar AA 4.5:1, deu ${novo.toFixed(2)}:1`);

// escapeHtml (mesma função do build.html) blindando String(numero corrompido)
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const malicioso = '<img src=x onerror=alert(1)>';
assert.ok(!escapeHtml(malicioso).includes('<img'), 'escapeHtml deveria neutralizar tag html mesmo vindo de um campo normalmente numerico');

console.log(`OK: contraste --dim ${antigo.toFixed(2)}:1 -> ${novo.toFixed(2)}:1 (AA >= 4.5:1); escapeHtml blinda campos corrompidos`);
