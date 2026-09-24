// Self-check da classificação de projeto contra o catálogo.
//
// As duas gerações do Simbionte respondiam perguntas diferentes: o store
// descobre projeto pelo cwd (qualquer raiz git serve), o data.js é curado à
// mão. Quando os dois discordam, o projeto não pode simplesmente sumir.
//
// A divergência é real hoje: a pasta no disco é "tatame-app", o catálogo diz
// "tatame-app-real"; "estoque-inteligente" no disco contra "estoque-ia" no
// catálogo. Antes da fusão a geração A mostrava esses projetos sem contexto
// nenhum e a B não os via — dois jeitos diferentes de errar em silêncio.
const assert = require('assert');
const { PROJECTS } = require('./data.js');
const { classificar } = require('./insights.js');

// Ausente do catálogo → marcado, não escondido
const fora = classificar('tatame-app', PROJECTS);
assert.strictEqual(fora.foraDoMapa, true, 'id ausente do catalogo precisa ser marcado');
assert.strictEqual(fora.catalogado, null, 'sem entrada no catalogo, nao ha o que anexar');

// Presente no catálogo → não marcado, e traz a entrada junto
const dentro = classificar(PROJECTS[0].id, PROJECTS);
assert.strictEqual(dentro.foraDoMapa, false, 'id catalogado nao pode ser marcado como fora do mapa');
assert.ok(dentro.catalogado && dentro.catalogado.name, 'projeto catalogado traz nome e categoria junto');

// A divergência concreta que originou isto
assert.strictEqual(classificar('estoque-inteligente', PROJECTS).foraDoMapa, true,
  'pasta estoque-inteligente x catalogo estoque-ia: divergencia real, tem que aparecer marcada');

// Entradas defensivas: id vazio ou catálogo ausente não podem explodir —
// isto roda no caminho de render do painel.
assert.strictEqual(classificar('', PROJECTS).foraDoMapa, true, 'id vazio nao quebra');
assert.strictEqual(classificar('qualquer', []).foraDoMapa, true, 'catalogo vazio nao quebra');
assert.strictEqual(classificar('qualquer', null).foraDoMapa, true, 'catalogo nulo nao quebra');

console.log('fora-do-mapa: 8/8 ok');

// ── Aviso de projeto não catalogado ───────────────────────────────────
// Um projeto novo entra no store sozinho (o hook o descobre pelo cwd) e
// aparece na lista do painel na hora, mas fica fora de saúde e sinais até
// alguém rodar `node gerar-data.js --gravar`. Verificado empiricamente em
// 2026-09-23 criando um repo de teste: store e lista pegaram; catálogo não.
//
// É pra isso que classificar() serve. Quando o catálogo estava desatualizado
// ela marcava 100% dos projetos e não valia a tela; com o catálogo correto,
// marca exatamente os projetos novos — que é a informação acionável.
const naoCatalogados = (idsNoStore, projects) =>
  idsNoStore.filter(id => classificar(id, projects).foraDoMapa);

const catalogados = PROJECTS.map(p => p.id);

assert.deepStrictEqual(naoCatalogados(catalogados, PROJECTS), [],
  'com tudo catalogado, nao ha o que avisar — aviso que sempre aparece vira ruido');

assert.deepStrictEqual(
  naoCatalogados([...catalogados, 'projeto-novinho'], PROJECTS),
  ['projeto-novinho'],
  'projeto recem-criado precisa ser apontado, senao fica fora de saude e sinais em silencio');

assert.strictEqual(naoCatalogados([], PROJECTS).length, 0, 'store vazio nao avisa nada');

console.log('fora-do-mapa: aviso 3/3 ok');
