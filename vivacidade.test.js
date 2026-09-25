// Self-check das duas regras de "está vivo agora?" do painel.
//
// Achado real 2026-09-23, visto em uso real: o reator zerava
// e o banner de hook travado não sumia, os dois enquanto havia trabalho
// acontecendo. Mesma causa de fundo nos dois — um relógio só, que não
// refletia o trabalho real:
//
//  - o reator expirava pelo `progress.updatedAt`, que só avança quando um
//    CHECKBOX DE PLANO muda. Editar código por 20 minutos não mexe nele, e o
//    anel ia a 0% justamente durante o trabalho mais intenso;
//  - o banner lia um estado recalculado por um timer de 60s, então ficava na
//    tela por até um minuto depois de os hooks voltarem.
const assert = require('assert');

const EXPIRA_MS = 15 * 60 * 1000;
const min = m => m * 60 * 1000;

// ── Reator ────────────────────────────────────────────────────────────
// Mesmas regras de build.html.
const ultimaAtividade = p => Math.max(
  (p.progress && p.progress.updatedAt) || 0,
  (p.activity && p.activity[0] && p.activity[0].ts) || 0,
  p.lastTouch || 0);

function expirado(p, agora) {
  const progress = p.progress;
  const vivo = (agora - ultimaAtividade(p)) < EXPIRA_MS;
  return !progress || !progress.updatedAt
    || (!vivo && (agora - progress.updatedAt) > EXPIRA_MS);
}

const AGORA = Date.now();

// O caso visto em uso: plano parado há 19 min, mas arquivo tocado há 20s.
assert.strictEqual(
  expirado({ progress: { updatedAt: AGORA - min(19), percent: 50 }, activity: [{ ts: AGORA - 20000 }], lastTouch: AGORA - 20000 }, AGORA),
  false,
  'plano parado mas com atividade recente: reator continua mostrando o progresso');

// Projeto de fato abandonado: nada aconteceu, esquecer é o certo.
assert.strictEqual(
  expirado({ progress: { updatedAt: AGORA - min(40), percent: 50 }, activity: [{ ts: AGORA - min(40) }], lastTouch: AGORA - min(40) }, AGORA),
  true,
  'sem plano nem atividade recente: progresso velho nao pode ficar preso na tela');

// Trabalho normal: tudo recente.
assert.strictEqual(
  expirado({ progress: { updatedAt: AGORA - min(2), percent: 30 }, activity: [{ ts: AGORA - min(1) }], lastTouch: AGORA - min(1) }, AGORA),
  false, 'trabalho recente nao expira');

// Sem progresso nenhum.
assert.strictEqual(expirado({ progress: null, activity: [], lastTouch: 0 }, AGORA), true,
  'projeto sem plano nao tem o que mostrar no anel');

// Borda: atividade exatamente no limite conta como morta, não viva.
assert.strictEqual(
  expirado({ progress: { updatedAt: AGORA - min(30), percent: 50 }, activity: [{ ts: AGORA - EXPIRA_MS }], lastTouch: 0 }, AGORA),
  true, 'atividade exatamente no limite nao segura o progresso');

// ── Qual projeto o reator mostra ──────────────────────────────────────
// Mesma regra de renderReator (build.html). Achado 2026-09-23: janela do VS
// Code em projeto parado travava o reator nele com o trabalho em outro repo.
function escolherAlvo(projetos, currentProject, agora) {
  const foco = projetos.find(p => p.projectId === currentProject);
  const recente = [...projetos].sort((a, b) => (ultimaAtividade(b) || 0) - (ultimaAtividade(a) || 0))[0];
  const focoVivo = foco && (agora - ultimaAtividade(foco)) < EXPIRA_MS;
  return focoVivo ? foco : (recente || foco);
}
const parado = { projectId: 'loja-web', progress: { updatedAt: AGORA - min(150), percent: 100 }, activity: [{ ts: AGORA - min(150) }], lastTouch: AGORA - min(150) };
const ativo  = { projectId: 'app-backend', progress: { updatedAt: AGORA - min(1), percent: 26 }, activity: [{ ts: AGORA - 5000 }], lastTouch: AGORA - 5000 };
assert.strictEqual(escolherAlvo([parado, ativo], 'loja-web', AGORA).projectId, 'app-backend',
  'janela em projeto parado: reator segue o projeto com trabalho acontecendo');
const focoAtivo = Object.assign({}, parado, { activity: [{ ts: AGORA - min(2) }], lastTouch: AGORA - min(2) });
assert.strictEqual(escolherAlvo([focoAtivo, ativo], 'loja-web', AGORA).projectId, 'loja-web',
  'projeto da janela vivo continua tendo prioridade');
assert.strictEqual(escolherAlvo([parado, ativo], 'usuario', AGORA).projectId, 'app-backend',
  'janela fora do catálogo: mais recente');
assert.strictEqual(escolherAlvo([parado], 'loja-web', AGORA).projectId, 'loja-web',
  'só o projeto da janela existe: mostra ele (expirado fica a cargo de expirado())');

// ── Banner de sessão travada ──────────────────────────────────────────
// Desde a 1.1.0 a regra vive em store.js:estadoDaSessao (testada a fundo em
// test/test_heartbeat_alert.js). Aqui só o caso que originou este arquivo.
const { estadoDaSessao } = require('./store.js');
assert.strictEqual(estadoDaSessao({ evento: 'PostToolUse', ts: AGORA - 23000 }, AGORA, EXPIRA_MS).estado, 'trabalhando',
  'hook rodou ha 23s: banner tem que estar oculto, sem esperar o timer de 60s');

console.log('vivacidade: 6/6 ok');
