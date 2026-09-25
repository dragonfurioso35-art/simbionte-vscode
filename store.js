// ~/.claude/simbionte-store.js — leitura/escrita atômica do estado do
// Simbionte, compartilhado por progress-hook.js e activity-hook.js.
//
// Identificação de projeto é genérica (raiz git mais próxima do arquivo
// tocado) — sem lista curada, sem caminho hardcoded, funciona em qualquer
// máquina/pasta. Único desvio: convenção de worktree do superpowers
// (<projeto>/.worktrees/<branch>/...) sobe pro projeto real, senão cada
// worktree viraria um "projeto" separado no painel.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');

function encontrarRaizGit(caminho) {
  // Não depende do arquivo já existir no disco (um Write pode disparar o
  // hook antes de qualquer coisa tocar fs.statSync nele em certas ordens) —
  // só tenta checar se é diretório; se der erro (arquivo novo, permissão,
  // etc.), assume que é um arquivo comum e sobe a partir do dirname mesmo.
  let dir;
  try {
    dir = fs.statSync(caminho).isDirectory() ? caminho : path.dirname(caminho);
  } catch (e) {
    dir = path.dirname(caminho);
  }
  const raizFs = path.parse(dir).root;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === raizFs) return null;
    dir = path.dirname(dir);
  }
}

// Monorepo (ex: meu-monorepo com dezenas de addons): a raiz git sozinha
// rotula tudo com o mesmo nome do repo, escondendo em qual sub-projeto o
// trabalho realmente está. Se existir um marcador de sub-pacote (manifest)
// entre o arquivo tocado e a raiz git, usa o mais próximo do arquivo — sem
// hardcode de "addons/" ou qualquer coisa específica de um framework.
const MARCADORES_SUBPROJETO = ['__manifest__.py', 'package.json', 'pyproject.toml'];

function encontrarSubProjeto(caminho, raiz) {
  let dir;
  try {
    dir = fs.statSync(caminho).isDirectory() ? caminho : path.dirname(caminho);
  } catch (e) {
    dir = path.dirname(caminho);
  }
  while (dir.length > raiz.length && dir.startsWith(raiz)) {
    if (MARCADORES_SUBPROJETO.some(m => fs.existsSync(path.join(dir, m)))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

// Achado 2026-09-02: repo com 1 módulo só (ex. addons/<modulo>/__manifest__.py)
// e o plano em docs/superpowers/plans/ (fora de addons/) virava DOIS ids no
// Simbionte — o do módulo (toda a atividade de código, progress:null porque
// o plano nunca resolve pra dentro de addons/) e o da raiz (só as edições do
// plano, progress certo, quase nenhuma atividade) — dois cards desconectados
// pro mesmo trabalho. Só separa em sub-projeto quando o repo REALMENTE tem
// mais de 1 (monorepo de verdade, tipo meu-monorepo). Busca rasa
// (profundidade 3, para no 2º achado) — não pesa em repo grande.
const IGNORAR_DIR_BUSCA = new Set(['.git', '.worktrees', 'node_modules', '__pycache__']);

function temMaisDeUmSubProjeto(raiz) {
  let achados = 0;
  function visitar(dir, profundidade) {
    if (achados >= 2 || profundidade > 3) return;
    if (MARCADORES_SUBPROJETO.some(m => fs.existsSync(path.join(dir, m)))) achados++;
    if (achados >= 2) return;
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entrada of entradas) {
      if (achados >= 2) return;
      if (!entrada.isDirectory() || IGNORAR_DIR_BUSCA.has(entrada.name)) continue;
      visitar(path.join(dir, entrada.name), profundidade + 1);
    }
  }
  visitar(raiz, 0);
  return achados > 1;
}

function resolverProjeto(caminho) {
  if (!caminho) return null;
  caminho = path.resolve(caminho); // nunca deixa path relativo degenerar em "."
  let raiz = encontrarRaizGit(caminho);
  if (!raiz) return null;
  if (path.basename(path.dirname(raiz)) === '.worktrees') {
    raiz = path.dirname(path.dirname(raiz));
  }
  let dirFinal = encontrarSubProjeto(caminho, raiz);
  if (dirFinal && !temMaisDeUmSubProjeto(raiz)) dirFinal = null; // só 1 no repo -- não separa
  dirFinal = dirFinal || raiz;
  const id = path.basename(dirFinal);
  return { id, name: id, path: dirFinal };
}

// Lock de arquivo bem simples pra proteger o padrão ler->mesclar->escrever
// (atualizarProgresso/registrarAtividade) de dois hooks quase simultâneos
// pisando um no outro. ponytail: busy-wait curto (~5ms x20 = ~100ms teto),
// sem dependência nova; desiste e segue SEM lock depois disso — nunca trava
// o hook (que já tem timeout de 3s no settings.json). Se um processo morrer
// com o lock preso, autodestrava depois de 2s (mtime velho = órfão).
function adquirirLock(projectId) {
  fs.mkdirSync(DIR, { recursive: true });
  const lockPath = path.join(DIR, `.${projectId}.lock`);
  for (let i = 0; i < 20; i++) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'));
      return lockPath;
    } catch (e) {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 2000) fs.unlinkSync(lockPath);
      } catch (e2) { /* já sumiu, outro processo destravou primeiro */ }
      const fim = Date.now() + 5;
      while (Date.now() < fim) { /* espera curta síncrona */ }
    }
  }
  return null;
}

function liberarLock(lockPath) {
  if (!lockPath) return;
  try { fs.unlinkSync(lockPath); } catch (e) { /* já sumiu, tudo bem */ }
}

function lerProjeto(projectId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${projectId}.json`), 'utf8'));
  } catch (e) {
    return null;
  }
}

function escreverAtomico(projectId, dados) {
  fs.mkdirSync(DIR, { recursive: true });
  const alvo = path.join(DIR, `${projectId}.json`);
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dados));
  fs.renameSync(tmp, alvo); // rename é atômico no mesmo volume — nunca deixa
  // a extensão ler um arquivo pela metade, mesmo se o processo morrer entre
  // o writeFileSync e o rename (o .tmp fica órfão, o .json bom continua lá).
}

// origem ('edit'|'bash'): a REGRA DE OURO diz pra nunca fechar checkbox de
// plano via Bash — a trava técnica em activity-hook.js já resincroniza esse
// caso, mas antes fazia isso em silêncio. Marcar viaBash aqui deixa o
// painel avisar de verdade em vez de só corrigir os números por baixo.
// Achado 2026-09-23: qualquer Bash que só CITA o plano (git add/commit do
// arquivo) caía na trava e acendia o aviso, sem checkbox nenhum mudar — o
// painel ficou com ⚠ em todo projeto trabalhado. Bash só acende o aviso se
// o progresso mudou; sem mudança, mantém o aviso como estava. Edit apaga.
function viaBashNovo(anterior, progress, origem) {
  if (origem !== 'bash') return false;
  const mesmo = !!(anterior && progress && anterior.completed === progress.completed && anterior.total === progress.total);
  return mesmo ? !!anterior.viaBash : true;
}

function atualizarProgresso(projectId, projectName, progress, projectPath, origem) {
  const lock = adquirirLock(projectId);
  try {
    const atual = lerProjeto(projectId) || { projectId, projectName, progress: null, activity: [] };
    const comOrigem = progress ? { ...progress, viaBash: viaBashNovo(atual.progress, progress, origem) } : progress;
    escreverAtomico(projectId, { ...atual, projectId, projectName, progress: comOrigem, projectPath: projectPath || atual.projectPath });
  } finally { liberarLock(lock); }
}

// Extraído de activity-hook.js (2026-08-29) pra poder ser reusado também
// pela extensão (leitura ao vivo do plano pro projeto em foco, sem esperar
// o hook disparar de novo — cobre o caso de "git pull" trazer o plano
// fechado de outra máquina sem nenhuma edição local).
function progressoDoPlano(file) {
  if (!/docs[\\/]superpowers[\\/]plans[\\/].*\.md$/i.test(file)) return null;
  let texto;
  try { texto = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const linhas = texto.match(/^- \[[ x]\].*$/gim) || [];
  if (!linhas.length) return null;
  const total = linhas.length;
  const completed = linhas.filter(l => /^- \[x\]/i.test(l)).length;
  const proxima = linhas.find(l => /^- \[ \]/.test(l));
  return {
    percent: Math.round((completed / total) * 100), completed, total,
    activeLabel: proxima ? proxima.replace(/^- \[ \]\s*/, '').replace(/\*\*/g, '').slice(0, 80) : null,
    updatedAt: Date.now(),
  };
}

// Plano que atravessa repos (2026-09-23, ex: plano em app-backend,
// metade do trabalho em app-frontend): o reator segue o projeto
// tocado por último, que não tinha plano, e zerava no meio da tarefa. O plano
// declara os outros projetos numa linha `<!-- simbionte-projetos: a, b -->`;
// cada nome é uma pasta irmã da raiz git do plano.
function projetosExtrasDoPlano(file) {
  let texto;
  try { texto = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const m = texto.match(/<!--\s*simbionte-projetos:\s*([^>]*?)\s*-->/i);
  const raiz = m && encontrarRaizGit(path.resolve(file));
  if (!raiz) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean)
    .map(nome => ({ id: nome, name: nome, path: path.join(path.dirname(raiz), nome) }))
    .filter(p => fs.existsSync(p.path));
}

// Sinal de recência separado de `activity` (só arquivo Edit/Write de
// verdade) — Bash sem file_path (docker, scripts, etc.) não vira "arquivo
// tocado" fake, mas ainda precisa contar como "você tá ativo aqui" pra
// bolinha de status não ficar vermelha enquanto você trabalha só via Bash.
function registrarToque(projectId, projectName, projectPath) {
  const lock = adquirirLock(projectId);
  try {
    const atual = lerProjeto(projectId) || { projectId, projectName, progress: null, activity: [] };
    escreverAtomico(projectId, { ...atual, projectId, projectName, projectPath: projectPath || atual.projectPath, lastTouch: Date.now() });
  } finally { liberarLock(lock); }
}

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bumpHoje(atual) {
  const hoje = hojeLocal();
  if (atual.today?.date === hoje) return { date: hoje, count: atual.today.count + 1 };
  return { date: hoje, count: 1 };
}

function registrarAtividade(projectId, projectName, item, projectPath) {
  const lock = adquirirLock(projectId);
  try {
    const atual = lerProjeto(projectId) || { projectId, projectName, progress: null, activity: [] };
    const activity = [item, ...(atual.activity || [])].slice(0, 8);
    escreverAtomico(projectId, {
      ...atual, projectId, projectName, activity,
      projectPath: projectPath || atual.projectPath,
      today: bumpHoje(atual),
    });
  } finally { liberarLock(lock); }
}

// TodoWrite não referencia um arquivo (só o cwd da sessão) — num monorepo
// isso sempre resolve pra raiz, enquanto activity-hook.js (por arquivo)
// acha o sub-projeto certo. Prefere um sub-projeto (mesma raiz) tocado nos
// últimos 5 minutos, se existir, senão cai pro cwd normal. ponytail:
// heurística por janela de tempo, não é garantia — pode escolher errado se
// você TodoWrite logo depois de mexer num addon vizinho que não é o alvo;
// upgrade seria o hook receber o sub-projeto ativo explicitamente.
function resolverProjetoAtivo(cwd) {
  const base = resolverProjeto(cwd);
  if (!base) return null;
  try {
    const candidatos = fs.readdirSync(DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return null; } })
      .filter(p => p && p.projectPath && p.projectPath !== base.path
        && p.projectPath.startsWith(base.path + path.sep)
        && p.activity && p.activity[0] && p.activity[0].ts > Date.now() - 5 * 60 * 1000);
    if (candidatos.length) {
      candidatos.sort((a, b) => b.activity[0].ts - a.activity[0].ts);
      const c = candidatos[0];
      return { id: c.projectId, name: c.projectName, path: c.projectPath };
    }
  } catch (e) { /* sem pasta ainda, ou erro de leitura — cai pro base */ }
  return base;
}

// Heartbeat: grava toda vez que o hook RODA de verdade (independente de
// resolver projeto) — 2026-08-26, a pedido do autor depois de uma sessão de
// ~3h onde o processo do Claude Code reiniciou no meio e os hooks pararam de
// disparar sem nenhum sinal visível. Não é monitor automático, só um
// registro pra checar manualmente ("_heartbeat.json" na pasta simbionte) se
// o Simbionte parecer desatualizado de novo — comparar lastRun contra agora.
//
// 1.1.0: além do lastRun (mantido pra checagem manual), guarda o ÚLTIMO
// evento de cada sessão (`sessoes[session_id]`). "15 min sem hook" sozinho
// não diz nada — pode ser o Claude esperando você, um build longo ou a
// sessão encerrada. O último evento diz qual dos casos é (estadoDaSessao).
// Lock porque várias sessões abertas escrevem no mesmo arquivo.
const SESSAO_EXPIRA_MS = 24 * 60 * 60 * 1000;
function registrarHeartbeat(evento, data) {
  const agora = Date.now();
  const lock = adquirirLock('_heartbeat');
  try {
    let hb = {};
    try { hb = JSON.parse(fs.readFileSync(path.join(DIR, '_heartbeat.json'), 'utf8')); } catch (e) { /* 1ª vez */ }
    const sessoes = hb.sessoes || {};
    if (evento && data && data.session_id) {
      const reg = { evento, ts: agora };
      if (data.notification_type) reg.tipo = data.notification_type;
      if (evento === 'PreToolUse' && data.tool_input && data.tool_input.command) {
        reg.comando = String(data.tool_input.command).slice(0, 120);
      }
      sessoes[data.session_id] = reg;
    }
    for (const id of Object.keys(sessoes)) {
      if (agora - sessoes[id].ts > SESSAO_EXPIRA_MS) delete sessoes[id];
    }
    escreverAtomico('_heartbeat', { lastRun: agora, sessoes });
  } finally { liberarLock(lock); }
}

// Estado de UMA sessão a partir do último evento. Puro (sem disco) pra ser
// testável e usado igual pela extensão e pelos testes.
//  - Stop / Notification: Claude terminou a resposta ou pediu algo -> é a vez do usuário
//  - PreToolUse sem Post depois: comando rodando (build, testes, npm install)
//  - SessionEnd: acabou
//  - PostToolUse / PostToolUseFailure / UserPromptSubmit: Claude trabalhando;
//    só aqui silêncio longo é suspeito.
// ponytail: Esc (interrupção) não dispara Stop — o último evento fica como
// "trabalhando"/"comando" e pode virar alerta falso. Upgrade: ler o fim do
// transcript_path pra detectar "[Request interrupted by user]".
// ponytail: tool sem hook (Read, Grep, subagente só lendo) não gera evento;
// uma sessão que passa > limite só lendo cai em "possivelmente travada".
const ABANDONADA_MS = 3 * 60 * 60 * 1000; // silêncio > 3h: já alertou, sai do painel
function estadoDaSessao(reg, agora, limiteMs) {
  if (!reg) return null;
  const desde = agora - reg.ts;
  if (reg.evento === 'SessionEnd') return { estado: 'encerrada', desde };
  if (reg.evento === 'Stop' || reg.evento === 'Notification') {
    return { estado: 'aguardando', desde, tipo: reg.tipo || null };
  }
  if (desde > ABANDONADA_MS) return null;
  if (reg.evento === 'PreToolUse') return { estado: 'comando', desde, comando: reg.comando || '' };
  return { estado: desde > limiteMs ? 'travada' : 'trabalhando', desde };
}

// Sessão que representa o painel: a travada tem prioridade (é o alarme);
// senão, a com evento mais recente. null = nenhuma sessão conhecida.
function resumoSessoes(sessoes, agora, limiteMs) {
  const prioridade = e => (e.estado === 'travada' ? 0 : 1);
  let escolhida = null;
  for (const [id, reg] of Object.entries(sessoes || {})) {
    const e = estadoDaSessao(reg, agora, limiteMs);
    if (!e) continue;
    e.sessionId = id;
    if (!escolhida || prioridade(e) < prioridade(escolhida)
      || (prioridade(e) === prioridade(escolhida) && e.desde < escolhida.desde)) escolhida = e;
  }
  return escolhida;
}

module.exports = { resolverProjeto, resolverProjetoAtivo, lerProjeto, atualizarProgresso, registrarAtividade, registrarHeartbeat, estadoDaSessao, resumoSessoes, progressoDoPlano, projetosExtrasDoPlano, registrarToque, viaBashNovo };
