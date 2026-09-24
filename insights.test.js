#!/usr/bin/env node
// Testes de insights.js — módulo puro, sem I/O, roda sem servidor e sem git real.
const assert = require('assert');
const { computeSignals } = require('./insights');

const testes = [];
function teste(nome, fn) { testes.push({ nome, fn }); }

const PROJECTS = [
  { id: 'proj-ativo', name: 'Ativo', cat: 'ativo' },
  { id: 'proj-morto-usado', name: 'Morto Usado', cat: 'morto' },
  { id: 'proj-morto-livre', name: 'Morto Livre', cat: 'morto' },
];
const RELATIONS = [
  { from: 'proj-morto-usado', to: 'proj-ativo', type: 'usado-por' },
  { from: 'proj-morto-livre', to: 'proj-ativo', type: 'mesmo-cliente-de' },
];

teste('marca "stale" projeto ativo sem commit há mais de 30 dias', () => {
  const scanData = { 'proj-ativo': { exists: true, lastCommitTs: Date.now() - 45 * 86400000, dirtyCount: 0, ahead: 0, behind: 0, ci: null } };
  const signals = computeSignals(scanData, PROJECTS, []);
  const s = signals.find(x => x.code === 'stale');
  assert.ok(s, 'deveria gerar sinal "stale"');
  assert.strictEqual(s.projectId, 'proj-ativo');
  assert.strictEqual(s.severity, 'atencao');
  assert.strictEqual(s.detail.days, 45);
});

teste('não marca "stale" se o commit for recente', () => {
  const scanData = { 'proj-ativo': { exists: true, lastCommitTs: Date.now() - 2 * 86400000, dirtyCount: 0, ahead: 0, behind: 0, ci: null } };
  const signals = computeSignals(scanData, PROJECTS, []);
  assert.ok(!signals.find(x => x.code === 'stale'));
});

teste('marca "dirty-now" quando dirtyCount > 0', () => {
  const scanData = { 'proj-ativo': { exists: true, lastCommitTs: Date.now(), dirtyCount: 3, ahead: 0, behind: 0, ci: null } };
  const signals = computeSignals(scanData, PROJECTS, []);
  const s = signals.find(x => x.code === 'dirty-now');
  assert.ok(s);
  assert.strictEqual(s.severity, 'info');
  assert.strictEqual(s.detail.count, 3);
});

teste('marca "behind" quando behind > 0', () => {
  const scanData = { 'proj-ativo': { exists: true, lastCommitTs: Date.now(), dirtyCount: 0, ahead: 0, behind: 2, ci: null } };
  const signals = computeSignals(scanData, PROJECTS, []);
  const s = signals.find(x => x.code === 'behind');
  assert.ok(s);
  assert.strictEqual(s.severity, 'atencao');
  assert.strictEqual(s.detail.count, 2);
});

teste('marca "ci-failing" quando a última run do CI falhou', () => {
  const scanData = { 'proj-ativo': { exists: true, lastCommitTs: Date.now(), dirtyCount: 0, ahead: 0, behind: 0, ci: { conclusion: 'failure' } } };
  const signals = computeSignals(scanData, PROJECTS, []);
  const s = signals.find(x => x.code === 'ci-failing');
  assert.ok(s);
  assert.strictEqual(s.severity, 'alerta');
});

teste('marca "dead-dependency" só quando a relação é "usado-por" e o alvo está ativo', () => {
  const scanData = {
    'proj-ativo': { exists: true, lastCommitTs: Date.now(), dirtyCount: 0, ahead: 0, behind: 0, ci: null },
    'proj-morto-usado': { exists: true, lastCommitTs: Date.now(), dirtyCount: 0, ahead: 0, behind: 0, ci: null },
    'proj-morto-livre': { exists: true, lastCommitTs: Date.now(), dirtyCount: 0, ahead: 0, behind: 0, ci: null },
  };
  const signals = computeSignals(scanData, PROJECTS, RELATIONS);
  const dead = signals.filter(x => x.code === 'dead-dependency');
  assert.strictEqual(dead.length, 1, 'só "proj-morto-usado" deveria disparar o sinal');
  assert.strictEqual(dead[0].projectId, 'proj-morto-usado');
  assert.strictEqual(dead[0].severity, 'alerta');
  assert.strictEqual(dead[0].detail.usedBy, 'proj-ativo');
});

teste('projeto sem dado confiável (exists:false ou error:true) não gera sinal derivado do scan', () => {
  const scanData = {
    'proj-ativo': { exists: false },
    'proj-morto-usado': { exists: true, error: true },
  };
  const signals = computeSignals(scanData, PROJECTS, RELATIONS);
  // proj-ativo só poderia gerar sinais vindos do scan (stale/dirty-now/behind/ci-failing) — sem dado, nenhum.
  assert.strictEqual(signals.filter(s => s.projectId === 'proj-ativo').length, 0);
  // dead-dependency é derivado só de PROJECTS/RELATIONS (categoria), não do scan — continua valendo
  // mesmo se o scan do projeto morto falhou (ele pode nem existir mais no disco e a relação ainda importa).
  const dead = signals.find(s => s.projectId === 'proj-morto-usado' && s.code === 'dead-dependency');
  assert.ok(dead, 'dead-dependency não deveria depender do scan ter funcionado');
});

const { synthesize } = require('./insights');

teste('synthesize monta mensagem legível pra cada code conhecido', () => {
  const out = synthesize([
    { projectId: 'a', code: 'stale', severity: 'atencao', detail: { days: 45 } },
    { projectId: 'b', code: 'dirty-now', severity: 'info', detail: { count: 3 } },
    { projectId: 'c', code: 'behind', severity: 'atencao', detail: { count: 2 } },
    { projectId: 'd', code: 'ci-failing', severity: 'alerta', detail: {} },
    { projectId: 'e', code: 'dead-dependency', severity: 'alerta', detail: { usedBy: 'x', usedByName: 'Projeto X' } },
  ]);
  assert.strictEqual(out.find(o => o.projectId === 'a').message, 'sem commit há 45 dias, mas está marcado ativo');
  assert.strictEqual(out.find(o => o.projectId === 'b').message, 'tem 3 arquivo(s) com mudança não commitada');
  assert.strictEqual(out.find(o => o.projectId === 'c').message, 'está 2 commit(s) atrás do remote');
  assert.strictEqual(out.find(o => o.projectId === 'd').message, 'a última execução de CI falhou');
  assert.strictEqual(out.find(o => o.projectId === 'e').message, 'está morto mas ainda é usado por Projeto X, que está ativo');
});

teste('synthesize ordena por severidade: alerta antes de atencao antes de info', () => {
  const out = synthesize([
    { projectId: 'a', code: 'dirty-now', severity: 'info', detail: { count: 1 } },
    { projectId: 'b', code: 'stale', severity: 'atencao', detail: { days: 40 } },
    { projectId: 'c', code: 'ci-failing', severity: 'alerta', detail: {} },
  ]);
  assert.deepStrictEqual(out.map(o => o.severity), ['alerta', 'atencao', 'info']);
});

teste('synthesize com lista vazia devolve lista vazia', () => {
  assert.deepStrictEqual(synthesize([]), []);
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of testes) {
    try { await fn(); console.log('  ok -', nome); }
    catch (e) { falhas++; console.log('  FALHOU -', nome); console.log('    ', e.message); }
  }
  console.log(`\n${testes.length - falhas}/${testes.length} passaram.`);
  process.exit(falhas > 0 ? 1 : 0);
})();
