// Self-check: todo elemento que o painel esconde via atributo `hidden`
// precisa de uma regra que realmente o esconda.
//
// Achado real 2026-09-23, reportado DUAS vezes em uso ("o banner do hook
// não sumiu") depois de um fix que estava logicamente correto:
//
//   [hidden]{display:none}      <- folha do NAVEGADOR, especificidade (0,1,0)
//   .banner{display:flex;...}   <- folha do AUTOR,     especificidade (0,1,0)
//
// Empate de especificidade resolve pela ordem de origem, e a folha do autor
// vem depois da do navegador. Resultado: `display:flex` ganhava sempre e o
// atributo `hidden` não fazia absolutamente nada. O JS mandava o valor certo
// e o CSS o descartava — a classe de bug mais traiçoeira que apareceu nesta
// fusão, porque a lógica parecia correta em toda inspeção.
//
// Este teste falha se alguém der `display:` a uma classe que também usa
// `hidden`, sem a rede de segurança da regra global.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'vscode-extension', 'media', 'build.html'), 'utf8');

// 1. A rede de segurança global precisa existir.
assert.ok(/\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(html),
  'falta [hidden]{display:none!important} — sem isso, qualquer classe com display: anula o atributo hidden');

// 2. Todo elemento com `hidden` no markup tem que ser alcançado por ela.
//    (Hoje a regra global cobre todos; este passo documenta quem depende dela.)
const comHidden = [...html.matchAll(/<[^>]*\sid="([a-zA-Z0-9_-]+)"[^>]*\shidden[^>]*>/g)].map(m => m[1]);
const tambemComHiddenAntes = [...html.matchAll(/<[^>]*\shidden[^>]*\sid="([a-zA-Z0-9_-]+)"[^>]*>/g)].map(m => m[1]);
const todos = [...new Set([...comHidden, ...tambemComHiddenAntes])];

assert.ok(todos.length > 0, 'esperava encontrar elementos usando o atributo hidden no painel');
assert.ok(todos.includes('banner'), 'o banner de hook travado usa hidden e foi o caso que originou este teste');

// 3. O JS ainda controla o banner pelo atributo, e não por classe — se isso
//    mudar, a regra acima deixa de ser suficiente e o teste precisa mudar junto.
assert.ok(/getElementById\('banner'\)\.hidden\s*=/.test(html),
  'o banner deixou de ser controlado por .hidden — revise este teste e o CSS junto');

console.log(`hidden-css: 4/4 ok (elementos protegidos: ${todos.join(', ')})`);
