// Roda todas as suítes e devolve exit code != 0 se qualquer uma falhar.
// Existe porque a fusão das duas gerações trouxe grupos de teste com
// formatos diferentes: os de servidor (test.js) contam "16/16" no final, os
// portados da geração A (test/*.js) imprimem "OK:" e confiam no assert pra
// derrubar o processo.
//
// Suítes são DESCOBERTAS, não listadas à mão: as Tasks 9 e 10 ainda criam
// arquivos .test.js novos na raiz, e uma lista fixa os deixaria de fora em
// silêncio — pior do que não ter runner.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const suites = ['test.js']
  .concat(fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')))
  .concat(fs.readdirSync(path.join(__dirname, 'test'))
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('test', f)));

// Dependência externa ausente não é o mesmo que teste quebrado. Este repo
// não tem package.json nem node_modules de propósito — zero dependências é
// propriedade dele. test_visual_responsivo.js pede playwright, que não está
// instalado; tratar isso como falha treinaria a gente a ignorar vermelho.
function faltaDependencia(saida) {
  return /Cannot find module '(?!\.)/.test(saida);
}

const falhas = [];
const pulados = [];

for (const s of suites) {
  try {
    execFileSync('node', [s], { cwd: __dirname, stdio: 'inherit' });
  } catch (e) {
    // stdio:'inherit' não captura a saída, então relê o motivo rodando de
    // novo em modo capturado — só no caminho de erro, que é raro.
    let saida = '';
    try { execFileSync('node', [s], { cwd: __dirname, encoding: 'utf8', stdio: 'pipe' }); }
    catch (e2) { saida = `${e2.stdout || ''}${e2.stderr || ''}`; }

    if (faltaDependencia(saida)) {
      pulados.push({ suite: s, motivo: (saida.match(/Cannot find module '[^']+'/) || ['dependência ausente'])[0] });
    } else {
      falhas.push(s);
    }
  }
}

console.log(`\n${'='.repeat(60)}`);
for (const p of pulados) console.log(`PULADO: ${p.suite} — ${p.motivo}`);
for (const f of falhas) console.log(`FALHOU: ${f}`);

const rodadas = suites.length - pulados.length;
console.log(falhas.length === 0
  ? `\nTodas as ${rodadas} suítes rodadas passaram.${pulados.length ? ` (${pulados.length} pulada(s) por dependência ausente.)` : ''}`
  : `\n${falhas.length} de ${rodadas} suítes rodadas falharam.`);

process.exit(falhas.length === 0 ? 0 : 1);
