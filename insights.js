// Camada de Padrões e Síntese do Simbionte — pura, sem I/O. Recebe o
// snapshot que git-scan.js já produziu (nunca roda `git` aqui) mais
// PROJECTS/RELATIONS de data.js, e devolve sinais/mensagens prontos.
// Ver docs/superpowers/specs/2026-08-30-cerebro-matrioska-design.md

const STALE_DAYS = 30; // mesmo threshold já usado em simbionte.html pro "parados há +30 dias"

function computeSignals(scanData, PROJECTS, RELATIONS) {
  const signals = [];
  const projectById = {};
  PROJECTS.forEach(p => { projectById[p.id] = p; });

  PROJECTS.forEach(p => {
    const s = scanData[p.id];
    if (!s || !s.exists || s.error) return; // sem dado confiável, sem sinal

    if (p.cat === 'ativo' && s.lastCommitTs) {
      const days = (Date.now() - s.lastCommitTs) / 86400000;
      if (days > STALE_DAYS) {
        signals.push({ projectId: p.id, code: 'stale', severity: 'atencao', detail: { days: Math.round(days) } });
      }
    }

    if (s.dirtyCount > 0) {
      signals.push({ projectId: p.id, code: 'dirty-now', severity: 'info', detail: { count: s.dirtyCount } });
    }

    if (s.behind > 0) {
      signals.push({ projectId: p.id, code: 'behind', severity: 'atencao', detail: { count: s.behind } });
    }

    if (s.ci && s.ci.conclusion === 'failure') {
      signals.push({ projectId: p.id, code: 'ci-failing', severity: 'alerta', detail: {} });
    }
  });

  RELATIONS.forEach(r => {
    if (r.type !== 'usado-por') return;
    const from = projectById[r.from];
    const to = projectById[r.to];
    if (!from || !to) return; // id renomeado/removido — ignora silenciosamente, igual drawRelations() em simbionte.html
    if (from.cat === 'morto' && to.cat === 'ativo') {
      signals.push({ projectId: from.id, code: 'dead-dependency', severity: 'alerta', detail: { usedBy: to.id, usedByName: to.name } });
    }
  });

  return signals;
}

const SEVERITY_ORDER = { alerta: 0, atencao: 1, info: 2 };

const MESSAGES = {
  stale: d => `sem commit há ${d.days} dias, mas está marcado ativo`,
  'dirty-now': d => `tem ${d.count} arquivo(s) com mudança não commitada`,
  behind: d => `está ${d.count} commit(s) atrás do remote`,
  'ci-failing': () => 'a última execução de CI falhou',
  'dead-dependency': d => `está morto mas ainda é usado por ${d.usedByName}, que está ativo`,
};

function synthesize(signals) {
  return signals
    .map(s => ({ projectId: s.projectId, severity: s.severity, message: MESSAGES[s.code](s.detail) }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// ---------- saúde: nota composta por projeto ativo ----------
// Achado real (2026-09-09): a lista de atividade recente (arquivos
// tocados) não servia pra nada segundo o usuário — o que ele queria ver
// era justamente o que os SINAIS já calculavam (app parado, auth morto
// mas usado) só que enterrado numa lista de cards igual a qualquer outra.
// `computeHealth` empacota os mesmos sinais numa nota (0-100 + letra
// A-D) por projeto, pra virar um ranking acionável em vez de texto solto.
// Só pontua projetos `ativo` — nota de saúde não faz sentido pra algo
// pausado/morto de propósito.
const HEALTH_BANDS = [
  { min: 85, grade: 'A' },
  { min: 70, grade: 'B' },
  { min: 50, grade: 'C' },
  { min: 0, grade: 'D' },
];
function gradeFor(score) {
  return HEALTH_BANDS.find(b => score >= b.min).grade;
}

function computeHealth(scanData, PROJECTS, RELATIONS) {
  const projectById = {};
  PROJECTS.forEach(p => { projectById[p.id] = p; });
  const health = {};

  PROJECTS.forEach(p => {
    if (p.cat !== 'ativo') return;
    const s = scanData[p.id];
    if (!s || !s.exists || s.error) return;

    let score = 100;
    const reasons = []; // { label, delta } — ordenado do pior motivo pro melhor

    let daysSinceCommit = null;
    if (s.lastCommitTs) {
      daysSinceCommit = Math.round((Date.now() - s.lastCommitTs) / 86400000);
      if (daysSinceCommit > STALE_DAYS) {
        // -30 ao cruzar o limiar, mais -5 a cada 15 dias extra, até -40
        const delta = -Math.min(40, 30 + Math.floor((daysSinceCommit - STALE_DAYS) / 15) * 5);
        score += delta;
        reasons.push({ label: `${daysSinceCommit} dias sem commit`, delta });
      }
    }

    RELATIONS.forEach(r => {
      if (r.type !== 'usado-por' || r.to !== p.id) return;
      const dep = projectById[r.from];
      if (dep && dep.cat === 'morto') {
        score -= 15;
        reasons.push({ label: `depende de ${dep.name} (morto)`, delta: -15 });
      }
    });

    if (s.dirtyCount > 0) {
      const delta = -Math.min(8, s.dirtyCount);
      score += delta;
      reasons.push({ label: `${s.dirtyCount} arquivo(s) com mudança não commitada`, delta });
    }

    if (s.behind > 0) {
      const delta = -Math.min(10, s.behind * 2);
      score += delta;
      reasons.push({ label: `${s.behind} commit(s) atrás do remote`, delta });
    }

    if (s.ci && s.ci.conclusion === 'failure') {
      score -= 20;
      reasons.push({ label: 'última execução de CI falhou', delta: -20 });
    }

    score = Math.max(0, Math.min(100, score));
    reasons.sort((a, b) => a.delta - b.delta);
    health[p.id] = { score, grade: gradeFor(score), reasons, daysSinceCommit };
  });

  return health;
}

// Um id vindo do store pode não existir no data.js — o store descobre
// projeto pelo cwd (qualquer raiz git serve), o data.js é curado à mão.
// Divergência real hoje: a pasta é "tatame-app" e o catálogo diz
// "tatame-app-real"; "estoque-inteligente" contra "estoque-ia". Antes da
// fusão a geração A mostrava esses projetos sem contexto nenhum e a B não
// os via — dois jeitos diferentes de errar em silêncio. Marcar é melhor:
// quem vê "fora do mapa" sabe que falta uma entrada no catálogo.
//
// Mora aqui, e não na extensão, porque extension.js faz require('vscode') e
// qualquer teste que o importe quebra na primeira linha. insights.js já é o
// módulo puro de interpretação e já recebe PROJECTS.
function classificar(projectId, projects) {
  const catalogado = (projects || []).find(p => p.id === projectId) || null;
  return { projectId, catalogado, foraDoMapa: catalogado === null };
}

module.exports = { computeSignals, synthesize, computeHealth, classificar };
