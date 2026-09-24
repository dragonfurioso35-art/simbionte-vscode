// Catálogo dos projetos, GERADO por gerar-data.js a partir do que o store
// (~/.claude/simbionte/) registra como realmente tocado. Não editar à mão:
// rode `node gerar-data.js --gravar`.
//
// Este é um catálogo de EXEMPLO — o primeiro `gerar-data.js --gravar` na sua
// máquina substitui pelos seus projetos reais.
//
// Categoria sai da recência real: ativo < 7 dias, pausado < 30, morto acima.
const CATEGORIES = {
  ativo:      { label: 'Ativo',       color: '#3fe8c4' },
  pausado:    { label: 'Pausado',     color: '#ffb757' },
  morto:      { label: 'Morto',       color: '#6b6f8a' },
  semstatus:  { label: 'Sem status',  color: '#c98bff' },
};

const PROJECTS = [
  { id: "meu-app", name: "Meu App", cat: 'ativo' },
  { id: "meu-app-api", name: "Meu App API", cat: 'pausado' },
];

// Caminhos que não seguem <raiz de projetos>/<id> — sem isto o git-scan
// procura no lugar errado e o projeto aparece como ausente.
const PATH_OVERRIDES = {
};

const RELATIONS = [
];

if (typeof module !== 'undefined') module.exports = { CATEGORIES, PROJECTS, RELATIONS, PATH_OVERRIDES };
