#!/usr/bin/env node
// vscode:prepublish — o vsce empacota SÓ o que está sob vscode-extension/.
// As libs da raiz (compartilhadas com servidor e hooks) são copiadas pra
// lib/ antes de empacotar; a fonte continua sendo uma só, na raiz.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(__dirname, 'lib');
fs.mkdirSync(path.join(LIB, 'hooks'), { recursive: true });

for (const f of ['scan-store.js', 'insights.js', 'data.js', 'store.js', 'hooks-settings.js']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(LIB, f));
}
for (const f of fs.readdirSync(path.join(ROOT, 'claude-hooks')).filter(f => f.endsWith('.js'))) {
  fs.copyFileSync(path.join(ROOT, 'claude-hooks', f), path.join(LIB, 'hooks', f));
}
// Página do Marketplace/Open VSX sai destes três.
for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(__dirname, f));
}
console.log('lib/ pronta');
