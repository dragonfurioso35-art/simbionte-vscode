// Self-check da contagem "hoje" do F3 (mesma logica de simbionte-store.js)
const assert = require('assert');

function hojeLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function bumpHoje(atual, hoje) {
  if (atual.today?.date === hoje) return { date: hoje, count: atual.today.count + 1 };
  return { date: hoje, count: 1 };
}

// projeto sem "today" ainda -> comeca em 1
assert.deepStrictEqual(bumpHoje({}, '2026-08-27'), { date: '2026-08-27', count: 1 });

// mesma data -> incrementa
assert.deepStrictEqual(
  bumpHoje({ today: { date: '2026-08-27', count: 3 } }, '2026-08-27'),
  { date: '2026-08-27', count: 4 }
);

// virou o dia -> reseta pra 1, nao acumula do dia anterior
assert.deepStrictEqual(
  bumpHoje({ today: { date: '2026-08-26', count: 12 } }, '2026-08-27'),
  { date: '2026-08-27', count: 1 }
);

console.log('OK: contagem "hoje" (bump/reset por data)');
