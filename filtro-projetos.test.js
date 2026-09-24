// Self-check do filtro que separa PROJETO de arquivo de controle em
// ~/.claude/simbionte/.
//
// Achado real 2026-09-23: o filtro era `!f.startsWith('_')` e escondia dois
// projetos legítimos — `_ferramentas` (o próprio Simbionte) e `_workspace`
// — porque as pastas começam com underscore. O painel ficava cego pro repo
// em que se estava trabalhando, que é exatamente onde ele mais importa.
//
// O diretório é COMPARTILHADO: `_aviso_uso_<uuid>.json` é de outra
// ferramenta (usage-warn-hook), não do Simbionte. Por isso o filtro não pode
// simplesmente aceitar tudo.
const assert = require('assert');

// Mesma regra de extension.js — se mudar lá, tem que mudar aqui e o teste
// avisa, porque os casos abaixo vêm de nomes reais vistos no diretório.
const INTERNOS_RE = /^_(heartbeat|scan\.\d+|aviso_uso_[^/\\]*)\.json$/i;
const ehProjeto = (nome, conteudo) =>
  nome.endsWith('.json') && !INTERNOS_RE.test(nome) && !!(conteudo && conteudo.projectName);

const projeto = { projectName: 'algum', progress: null, activity: [] };

// Projetos com underscore no nome — o bug que originou este teste
assert.ok(ehProjeto('_ferramentas.json', { ...projeto, projectName: '_ferramentas' }),
  '_ferramentas e um projeto real (o proprio Simbionte), nao pode sumir do painel');
assert.ok(ehProjeto('_workspace.json', { ...projeto, projectName: '_workspace' }),
  '_workspace e um projeto real, nao pode sumir do painel');

// Projetos comuns
assert.ok(ehProjeto('meu-monorepo.json', projeto));
assert.ok(ehProjeto('modulo_chamados.json', projeto));

// Arquivos de controle — descartados pelo nome
assert.ok(!ehProjeto('_heartbeat.json', { ts: 1 }), 'heartbeat nao e projeto');
assert.ok(!ehProjeto('_scan.4737.json', { updatedAt: 1, data: {} }), 'scan nao e projeto');
assert.ok(!ehProjeto('_scan.4577.json', { updatedAt: 1, data: {} }), 'scan de teste nao e projeto');
assert.ok(!ehProjeto('_aviso_uso_05ed6053-6b87-43fb-ba82-cdbc28c26da5.json', { x: 1 }),
  'aviso de uso e de outra ferramenta, nao e projeto');

// Segunda linha de defesa: mesmo passando pelo nome, sem projectName não é
// projeto. Cobre arquivo de controle novo que ninguém previu aqui.
assert.ok(!ehProjeto('_alguma_coisa_nova.json', { qualquer: 'coisa' }),
  'arquivo sem projectName nao vira projeto fantasma');
assert.ok(!ehProjeto('lixo.json', null), 'JSON ilegivel nao vira projeto');

// Não-JSON
assert.ok(!ehProjeto('_ferramentas.json.tmp', projeto), 'temporario de escrita atomica e ignorado');

console.log('filtro-projetos: 11/11 ok');
