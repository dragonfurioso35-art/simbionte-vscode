#!/usr/bin/env node
// Regenera data.js a partir do que está REALMENTE no store.
//
// Achado 2026-09-23: o data.js era derivado à mão do grafo pessoal
// (um grafo mantido à mão) e ficou para trás — listava 18 projetos dos
// quais NENHUM aparecia no trabalho real. O bloco de saúde do painel
// avaliava projetos intocados havia 47 dias enquanto ignorava os abertos
// naquele dia, e "fora do mapa" marcaria 100% dos projetos, virando ruído.
//
// O store é o registro do que foi de fato tocado, então ele vira a fonte do
// catálogo. Categoria sai da recência real, não de um rótulo mantido à mão
// que ninguém lembra de atualizar.
//
// Uso:  node gerar-data.js           (mostra o que mudaria)
//       node gerar-data.js --gravar  (escreve data.js)
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');
const PROJECTS_ROOT = process.env.SIMBIONTE_PROJECTS_ROOT || path.join(os.homedir(), 'Projects');
const INTERNOS_RE = /^_(heartbeat|scan\.\d+|aviso_uso_[^/\\]*)\.json$/i;
const GRAVAR = process.argv[2] === '--gravar';

const DIA = 24 * 60 * 60 * 1000;
const ATIVO_ATE = 7 * DIA;    // tocado na última semana
const PAUSADO_ATE = 30 * DIA; // tocado no último mês

function ultimaAtividade(p) {
  return Math.max(
    (p.progress && p.progress.updatedAt) || 0,
    (p.activity && p.activity[0] && p.activity[0].ts) || 0,
    p.lastTouch || 0);
}

function categoria(idadeMs) {
  if (idadeMs < ATIVO_ATE) return 'ativo';
  if (idadeMs < PAUSADO_ATE) return 'pausado';
  return 'morto';
}

// Nomes que a regra geral erraria: o id não diz o que a coisa é.
const NOMES_ESPECIAIS = {
  'simbionte': 'Simbionte',
};

// Siglas comuns — sem isto viram "Ia", "Cx", "Pwa".
const SIGLAS = new Set(['ia', 'ai', 'ti', 'pwa', 'erp', 'api', 'ui', 'ux', 'cli', 'sdk', 'crm']);

// "meu-app-api" -> "Meu App API"
function nomeLegivel(id) {
  if (NOMES_ESPECIAIS[id]) return NOMES_ESPECIAIS[id];
  return id
    .replace(/^_/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => {
      if (SIGLAS.has(w.toLowerCase())) return w.toUpperCase();
      if (w === w.toUpperCase() && w.length > 1) return w; // já era sigla no id
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

const projetos = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.json') && !INTERNOS_RE.test(f))
  .map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
    catch (e) { return null; }
  })
  .filter(p => p && p.projectName)
  .map(p => ({
    id: p.projectId,
    name: nomeLegivel(p.projectId),
    cat: categoria(Date.now() - ultimaAtividade(p)),
    caminho: p.projectPath,
    idadeDias: Math.round((Date.now() - ultimaAtividade(p)) / DIA),
  }))
  .sort((a, b) => a.idadeDias - b.idadeDias);

// Projetos fora de ~/Projects/<id> precisam de override, senão o git-scan
// procura no lugar errado e o projeto aparece como ausente.
const overrides = projetos.filter(p => p.caminho !== path.join(PROJECTS_ROOT, p.id));

// Sub-projeto dentro de outro repo vira relação, não projeto solto: é o que
// o painel usa pra explicar por que dois cards falam do mesmo trabalho.
const relacoes = [];
for (const p of projetos) {
  const pai = projetos.find(o => o.id !== p.id && p.caminho && o.caminho &&
    p.caminho.toLowerCase().startsWith(o.caminho.toLowerCase() + path.sep));
  if (pai) relacoes.push({ from: p.id, to: pai.id, type: 'é-módulo-de' });
}

const saida = `// Catálogo dos projetos, GERADO por gerar-data.js a partir do que o store
// (~/.claude/simbionte/) registra como realmente tocado. Não editar à mão:
// rode \`node gerar-data.js --gravar\`.
//
// Antes disto o catálogo era derivado à mão do grafo pessoal e ficou para
// trás — em 2026-09-23 listava 18 projetos dos quais NENHUM aparecia no
// trabalho real, então o painel avaliava a saúde de projetos intocados havia
// 47 dias e ignorava os abertos naquele dia.
//
// Categoria sai da recência real: ativo < 7 dias, pausado < 30, morto acima.
// Gerado em ${new Date().toISOString().slice(0, 10)} — ${projetos.length} projetos.
const CATEGORIES = {
  ativo:      { label: 'Ativo',       color: '#3fe8c4' },
  pausado:    { label: 'Pausado',     color: '#ffb757' },
  morto:      { label: 'Morto',       color: '#6b6f8a' },
  semstatus:  { label: 'Sem status',  color: '#c98bff' },
};

const PROJECTS = [
${projetos.map(p => `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, cat: '${p.cat}' },`).join('\n')}
];

// Caminhos que não seguem ~/Projects/<id> — sem isto o git-scan procura no
// lugar errado e o projeto aparece como ausente.
const PATH_OVERRIDES = {
${overrides.map(p => `  ${JSON.stringify(p.id)}: ${JSON.stringify(p.caminho)},`).join('\n')}
};

const RELATIONS = [
${relacoes.map(r => `  { from: ${JSON.stringify(r.from)}, to: ${JSON.stringify(r.to)}, type: '${r.type}' },`).join('\n')}
];

if (typeof module !== 'undefined') module.exports = { CATEGORIES, PROJECTS, RELATIONS, PATH_OVERRIDES };
`;

const porCat = projetos.reduce((a, p) => ({ ...a, [p.cat]: (a[p.cat] || 0) + 1 }), {});
console.log(`${projetos.length} projetos: ${Object.entries(porCat).map(([k, v]) => `${v} ${k}`).join(', ')}`);
console.log(`${overrides.length} com caminho fora de ~/Projects/<id>, ${relacoes.length} relações de módulo`);
console.log('\nativos:');
projetos.filter(p => p.cat === 'ativo').forEach(p => console.log(`  ${p.name} (${p.idadeDias}d)`));

if (GRAVAR) {
  fs.writeFileSync(path.join(__dirname, 'data.js'), saida);
  console.log('\ndata.js gravado.');
} else {
  console.log('\n(nada gravado — use --gravar)');
}
