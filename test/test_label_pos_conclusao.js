// Self-check: um plano fechado não pode travar o anel/glow/label pra
// sempre em "concluído" quando rola atividade nova (script/spec/worktree)
// depois dele fechar (mesma lógica de media/build.html:render).
const assert = require('assert');

function progressEfetivo(progressBruto, atividades) {
  const temAtividade = !!atividades.length;
  const atividadeAposConclusao = temAtividade && progressBruto && !progressBruto.activeLabel
    && atividades[0].ts > (progressBruto.updatedAt || 0);
  return atividadeAposConclusao ? null : progressBruto;
}

function labelDestaque(progress, atividades) {
  const temAtividade = !!atividades.length;
  if (progress && progress.activeLabel) return `construindo: ${progress.activeLabel}`;
  if (progress && progress.total) return 'tarefa concluída';
  if (temAtividade) return `ativo: ${atividades[0].file}`;
  return 'sistema em espera';
}

// plano fechado, sem atividade depois -> continua "concluída" (anel cheio)
{
  const progress = progressEfetivo({ total: 27, completed: 27, updatedAt: 5000 }, [{ file: 'y.py', ts: 1000 }]);
  assert.ok(progress, 'plano deveria continuar valendo sem atividade mais nova');
  assert.strictEqual(labelDestaque(progress, [{ file: 'y.py', ts: 1000 }]), 'tarefa concluída');
}
// plano fechado, atividade NOVA (ts maior que updatedAt) -> anula o progress
// inteiro (não só o texto), então anel/glow caem no fallback de atividade
{
  const atividades = [{ file: 'x.py', ts: 2000 }];
  const progress = progressEfetivo({ total: 27, completed: 27, updatedAt: 1000 }, atividades);
  assert.strictEqual(progress, null, 'atividade mais nova deveria anular o progress bruto, não só o label');
  assert.strictEqual(labelDestaque(progress, atividades), 'ativo: x.py');
}
// activeLabel (plano em andamento) vence sempre, mesmo com atividade "após" —
// não anula, porque o plano ainda está rodando, não fechado
{
  const atividades = [{ file: 'x.py', ts: 999999 }];
  const progress = progressEfetivo({ total: 27, activeLabel: 'foo', updatedAt: 1 }, atividades);
  assert.ok(progress, 'plano com activeLabel não deveria ser anulado');
  assert.strictEqual(labelDestaque(progress, atividades), 'construindo: foo');
}
// sem progress, com atividade -> ativo
assert.strictEqual(labelDestaque(progressEfetivo(null, [{ file: 'z.py', ts: 1 }]), [{ file: 'z.py', ts: 1 }]), 'ativo: z.py');
// sem progress, sem atividade -> espera
assert.strictEqual(labelDestaque(progressEfetivo(null, []), []), 'sistema em espera');

console.log('OK: plano fechado não trava anel/label quando há atividade após ele');
