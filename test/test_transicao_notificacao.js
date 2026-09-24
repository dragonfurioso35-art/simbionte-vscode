// Self-check: notificação de SO (plano concluído / violação da REGRA DE
// OURO) dispara só na TRANSIÇÃO (borda de subida), nunca a cada poll de 5s
// — senão vira spam. Mesma lógica de extension.js:checarTransicoes.
const assert = require('assert');

function checarTransicoes(projetos, estadoConhecido, notificar) {
  for (const p of projetos) {
    const anterior = estadoConhecido.get(p.projectId) || {};
    const percentAtual = p.progress ? p.progress.percent : null;
    if (percentAtual === 100 && anterior.percent !== 100) {
      notificar('concluido', p.projectName);
    }
    const viaBashAtual = !!(p.progress && p.progress.viaBash);
    if (viaBashAtual && !anterior.viaBash) {
      notificar('viaBash', p.projectName);
    }
    estadoConhecido.set(p.projectId, { percent: percentAtual, viaBash: viaBashAtual });
  }
}

const estado = new Map();
const chamadas = [];
const notificar = (tipo, nome) => chamadas.push(`${tipo}:${nome}`);

const projeto100 = { projectId: 'x', projectName: 'x', progress: { percent: 100 } };
checarTransicoes([projeto100], estado, notificar);
checarTransicoes([projeto100], estado, notificar); // poll de novo, mesmo estado
assert.deepStrictEqual(chamadas, ['concluido:x'], 'só deveria notificar uma vez, na transição pra 100%');

chamadas.length = 0;
const projetoBash = { projectId: 'y', projectName: 'y', progress: { percent: 40, viaBash: true } };
checarTransicoes([projetoBash], estado, notificar);
checarTransicoes([projetoBash], estado, notificar);
assert.deepStrictEqual(chamadas, ['viaBash:y'], 'só deveria alertar violação uma vez, na transição');

console.log('OK: notificações de transição (plano concluído / viaBash) disparam só uma vez');
