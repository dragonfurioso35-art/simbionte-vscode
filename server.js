const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { scanAll, resolvePath } = require('./git-scan');
const { computeSignals, synthesize, computeHealth } = require('./insights');
const { PROJECTS, RELATIONS } = require('./data.js');
const { escreverScan } = require('./scan-store');

const ROOT = __dirname;
// Override só pra teste automatizado rodar isolado, sem mexer na instância
// real (que continua sempre na 4737 por padrão).
//
// Por quê 4737 e não 4500: achado real (2026-09-09) — 4500 colide com o
// Logging Emulator do Firebase Emulator Suite (porta padrão dele). Sempre
// que `firebase emulators:...` sobe em QUALQUER projeto desta máquina, ele
// rouba a porta 4500 silenciosamente (Windows deixa um bind em 127.0.0.1
// coexistir com o bind em 0.0.0.0 do Simbionte) e todo fetch do painel
// passa a bater no emulador em vez do server.js — sem erro visível, só
// parece "travado". 4737 fica fora de toda a faixa que Firebase/Vite/CRA/
// Next/Postgres costumam usar.
const PORT = process.env.SIMBIONTE_PORT ? parseInt(process.env.SIMBIONTE_PORT, 10) : 4737;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const REFRESH_MS = 60 * 1000;
const ACTIVITY_LIMIT = 8; // quantos itens cada resposta devolve (visão global OU já filtrada por projeto)
const ACTIVITY_KEEP = 60; // quanto fica em memória — precisa ser bem maior que ACTIVITY_LIMIT pra sobrar
                           // atividade suficiente de CADA projeto depois de filtrar por cwd (ver /api/activity abaixo)
const ACTIVITY_LOG_PATH = path.join(ROOT, 'activity.log.jsonl');
// Suffixado por PORT (igual ao raciocínio do override de PORT acima) — sem
// isso, `npm test`/test.js (que sobe uma instância isolada em 4577) leria e
// sobrescreveria o estado de progresso da instância REAL rodando em 4737,
// travando o anel público num valor de teste (ex: 42%) até o próximo POST
// de verdade. `activity.log.jsonl` já é append-only e comum às duas
// instâncias de propósito (não faz mal um teste aparecer 1x no histórico).
const PROGRESS_STATE_PATH = path.join(ROOT, `progress.state.${PORT}.json`);
const PROJECT_IDS = new Set(PROJECTS.map(p => p.id));

const ids = PROJECTS.map(p => p.id);
let cache = { updatedAt: 0, data: {} };
let insightsCache = { updatedAt: 0, signals: [], synthesis: [], health: {} };

// Achado real (2026-09-07): tanto `progress` quanto `activity` só viviam em
// memória — qualquer restart do processo (ex: pra recarregar data.js depois
// de catalogar um projeto novo) zerava o anel de progresso e esvaziava o
// painel de atividade recente, mesmo com trabalho real em andamento.
// `activity` já tinha um log em disco (ACTIVITY_LOG_PATH) mas nunca era
// relido no boot; `progress` não tinha persistência nenhuma. Os dois agora
// recarregam o último estado conhecido ao subir, e persistem a cada update.
//
// Achado real (2026-09-09): `progress` era UM valor global só — com N
// sessões do Claude Code abertas em projetos diferentes, o TodoWrite de
// uma sessão sobrescrevia o % da outra, e não tinha como saber "de qual
// sessão" era o número na tela. Agora é um mapa por projeto (chave = id
// em data.js, resolvido a partir do `cwd` que todo hook PostToolUse já
// manda), e cada painel do VS Code só vê o progresso da SUA própria pasta
// (ver `?cwd=` em /api/progress). Uma sessão cujo cwd não bate com nenhum
// projeto catalogado cai em '_unscoped' (ex: rodando fora de data.js).
const PROGRESS_EMPTY = { percent: 0, completed: 0, total: 0, activeLabel: null, updatedAt: 0 };
let progressByProject = {};
try {
  const salvo = JSON.parse(fs.readFileSync(PROGRESS_STATE_PATH, 'utf8'));
  if (salvo && typeof salvo.percent === 'number') {
    // Formato antigo (valor único, de antes da porta 4737) — melhor
    // esforço: guarda como '_unscoped' em vez de descartar, mesmo que
    // quase certamente já esteja expirado pelo PROGRESSO_EXPIRA_MS do
    // lado do cliente.
    progressByProject = { _unscoped: salvo };
  } else if (salvo && typeof salvo === 'object') {
    progressByProject = salvo;
  }
} catch (e) { /* sem estado salvo ainda (1a execução) ou arquivo corrompido — comeca do zero */ }

function persistProgress() {
  fs.writeFile(PROGRESS_STATE_PATH, JSON.stringify(progressByProject), err => {
    if (err) console.error('[progress-state] falhou:', err.message);
  });
}

let activity = []; // últimos arquivos tocados: { file, projectId, projectName, tool, ts }
try {
  const linhas = fs.readFileSync(ACTIVITY_LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
  activity = linhas.slice(-ACTIVITY_KEEP).reverse().map(l => JSON.parse(l));
} catch (e) { /* sem log ainda (1a execução) */ }

// Os dois lados passam pela mesma normalização: antes só o caminho recebido
// virava '\', e fora do Windows resolvePath() devolve '/' — nada batia.
const normCaminho = s => String(s).replace(/[\\/]+/g, '/').toLowerCase().replace(/\/+$/, '');

function findProjectForFile(filePath) {
  const norm = normCaminho(filePath);
  for (const p of PROJECTS) {
    const dir = normCaminho(resolvePath(p.id));
    if (norm.startsWith(dir + '/') || norm === dir) return p;
  }
  return null;
}

// Chave usada tanto no mapa progressByProject quanto no escopo de SSE
// quando o cwd não bate com nenhum projeto catalogado — precisa ser a
// MESMA string nos dois lugares, senão um POST guarda num balde que o
// GET/SSE nunca olha (achado real, 2026-09-10: SSE usava uma string
// diferente do POST/GET pra esse caso, e a atualização instantânea nunca
// chegava pra sessão rodando numa pasta ainda não catalogada).
const NO_PROJECT_SCOPE = '_unscoped';

// Mesma lógica de findProjectForFile, mas comparando o cwd inteiro (não
// um arquivo dentro dele) — cwd pode ser a própria raiz do projeto ou uma
// subpasta (ex: worktree, monorepo aberto num subdiretório).
function findProjectForCwd(cwd) {
  if (!cwd) return null;
  const norm = normCaminho(cwd);
  for (const p of PROJECTS) {
    const dir = normCaminho(resolvePath(p.id));
    if (norm === dir || norm.startsWith(dir + '/')) return p;
  }
  return null;
}

// extension.js manda TODAS as pastas do workspace (não só a primeira),
// separadas por '|' — achado real: workspace multi-raiz onde o projeto
// catalogado não é a 1ª pasta nunca resolvia. Tenta cada uma, usa a
// primeira que bate com algo em data.js.
function findProjectForCwdParam(cwdParam) {
  if (!cwdParam) return null;
  for (const candidate of String(cwdParam).split('|')) {
    const proj = findProjectForCwd(candidate);
    if (proj) return proj;
  }
  return null;
}

// ---------- ao vivo: Server-Sent Events ----------
// Achado real (2026-09-09): a tela inteira era poll (30s pro grafo, 2s pro
// painel) — um arquivo sendo editado agora só aparecia até 2s depois, e o
// grafo cheio nem mostrava toque de arquivo nenhum, só estado agregado do
// projeto. SSE empurra o evento no INSTANTE em que o hook chega no
// servidor — poll continua existindo como rede de segurança (reconexão,
// primeira carga da página), mas deixa de ser o que dá a sensação de vivo.
//
// `scopeId`: null = quer ver TUDO (o mapa cheio, simbionte.html); um id de
// projeto = só quer eventos DAQUELE projeto (painel do VS Code, já
// escopado por cwd — mesma lógica de /api/progress?cwd=).
const sseClients = new Set();

function broadcast(event, data, projectId) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    if (c.scopeId === null || !projectId || c.scopeId === projectId) {
      try { c.res.write(payload); } catch (e) { /* conexão morta — req.on('close') já vai limpar */ }
    }
  }
}

async function refresh() {
  try {
    const data = await scanAll(ids);
    cache = { updatedAt: Date.now(), data };
    console.log(`[git-scan] atualizado em ${new Date().toLocaleTimeString('pt-BR')}`);
    broadcast('status', { updatedAt: cache.updatedAt });

    // Espelha o scan em disco pra extensão não depender deste processo estar
    // vivo. Try/catch próprio: disco cheio ou permissão negada não pode
    // derrubar o refresh, que ainda serve o cache em memória via HTTP.
    try { escreverScan(PORT, data); } catch (e) { console.error('[scan-store] falhou:', e.message); }

    // Try/catch próprio, separado do scan acima — se a camada de Padrões/
    // Síntese quebrar por algum motivo, não pode derrubar o cache de dados
    // crus, que é mais crítico.
    try {
      const signals = computeSignals(data, PROJECTS, RELATIONS);
      const synthesis = synthesize(signals);
      const health = computeHealth(data, PROJECTS, RELATIONS);
      insightsCache = { updatedAt: Date.now(), signals, synthesis, health };
      broadcast('insights', { updatedAt: insightsCache.updatedAt });
    } catch (e) {
      console.error('[insights] falhou:', e.message);
    }
  } catch (e) {
    console.error('[git-scan] falhou:', e.message);
  }
}
refresh();
setInterval(refresh, REFRESH_MS);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { req.destroy(); return; }
      chunks.push(c);
    });
    // Concatena os Buffers e só decodifica UTF-8 no final — decodificar
    // cada chunk isolado (ex: `body += c`) corrompe caracteres multi-byte
    // (acentos) que caem exatamente na borda entre dois chunks.
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  // Sem isso, o fetch() de health-check do painel do VS Code (origem
  // vscode-webview://...) é bloqueado por CORS contra este servidor
  // (origem http://localhost:4737) — servidor local, sem dado sensível,
  // wildcard é seguro aqui.
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url.startsWith('/api/events') && req.method === 'GET') {
    const { searchParams } = new URL(req.url, 'http://localhost');
    // Sem ?cwd= (mapa cheio, simbionte.html): scopeId null = "me manda
    // tudo". Com ?cwd= (painel do VS Code, já escopado por projeto): só
    // eventos DAQUELE projeto — mesma regra de /api/progress?cwd=, pro
    // painel de uma janela nunca ver toque de arquivo de outro projeto
    // aberto em N outras janelas. cwd presente mas fora do catálogo
    // (pasta que não está em data.js) usa um id que nunca bate com
    // projectId nenhum — essa conexão só recebe 'status'/'insights'
    // (que não têm projectId, chegam pra todo mundo de propósito).
    let scopeId = null;
    if (searchParams.has('cwd')) {
      const proj = findProjectForCwdParam(searchParams.get('cwd'));
      scopeId = proj ? proj.id : NO_PROJECT_SCOPE;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':conectado\n\n'); // primeiro byte logo de cara — alguns proxies/browsers seguram o evento 'open' até chegar algo
    const client = { res, scopeId };
    sseClients.add(client);
    req.on('close', () => sseClients.delete(client));
    return; // conexão fica aberta — nunca chama res.end() aqui
  }

  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(cache));
  }

  if (req.url === '/api/insights') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(insightsCache));
  }

  if (req.url.startsWith('/api/progress') && req.method === 'GET') {
    const { searchParams } = new URL(req.url, 'http://localhost');
    const cwd = searchParams.get('cwd');
    let body;
    if (cwd) {
      // Painel de UMA janela do VS Code — só o progresso DAQUELE projeto,
      // resolvido a partir da(s) pasta(s) aberta(s) nessa janela. cwd que
      // não bate com nada catalogado cai em NO_PROJECT_SCOPE (mesma chave
      // que POST usa nesse caso) em vez de vazar progresso de outro
      // projeto. Sem `activity` aqui de propósito: build.html não mostra
      // mais essa lista (virou "saúde dos ativos") e isto é reconsultado
      // a cada 2s por painel aberto — computar/mandar um array que
      // ninguém lê era trabalho jogado fora (achado real, 2026-09-10).
      const proj = findProjectForCwdParam(cwd);
      const key = proj ? proj.id : NO_PROJECT_SCOPE;
      body = {
        progress: progressByProject[key] || PROGRESS_EMPTY,
        projectName: proj ? proj.name : null,
      };
    } else {
      // Sem cwd (ex: aberto direto no navegador, fora da extensão) — visão
      // "global": progresso mais recente entre todos os projetos + os
      // últimos itens de atividade de qualquer um deles. Só pra uso manual/
      // debug; o painel real da extensão sempre manda ?cwd=.
      const maisRecente = Object.values(progressByProject)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || PROGRESS_EMPTY;
      body = { progress: maisRecente, activity: activity.slice(0, ACTIVITY_LIMIT), projectName: null };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(body));
  }

  if (req.url === '/api/progress' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const proj = findProjectForCwdParam(body.cwd);
      const key = proj ? proj.id : NO_PROJECT_SCOPE;
      progressByProject[key] = {
        percent: Math.max(0, Math.min(100, Math.round(body.percent ?? 0))),
        completed: body.completed ?? 0,
        total: body.total ?? 0,
        activeLabel: body.activeLabel ?? null,
        updatedAt: Date.now(),
      };
      // Persiste pra sobreviver a um restart do processo (ver comentário
      // acima de PROGRESS_STATE_PATH) — fire-and-forget, mesmo padrão do
      // append em ACTIVITY_LOG_PATH logo abaixo.
      persistProgress();
      broadcast('progress', { projectId: key, ...progressByProject[key] }, key);
    } catch (e) { /* payload inválido, ignora */ }
    res.writeHead(204); return res.end();
  }

  if (req.url === '/api/activity' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const proj = findProjectForFile(body.file || '');
      if (proj) {
        const entry = {
          file: path.basename(body.file || '?'),
          projectId: proj.id,
          projectName: proj.name,
          tool: body.tool || '?',
          ts: Date.now(),
        };
        activity.unshift(entry);
        activity = activity.slice(0, ACTIVITY_KEEP);
        // Log append-only em disco — `activity` em memória só guarda os
        // últimos ACTIVITY_KEEP e some no restart; isto aqui persiste
        // histórico de verdade (o que foi tocado, quando) entre sessões.
        fs.appendFile(ACTIVITY_LOG_PATH, JSON.stringify(entry) + '\n', err => {
          if (err) console.error('[activity-log] falhou:', err.message);
        });
        broadcast('activity', entry, proj.id);
      }
    } catch (e) { /* payload inválido, ignora */ }
    res.writeHead(204); return res.end();
  }

  if (req.url === '/api/open' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const id = body.id;
      if (!PROJECT_IDS.has(id)) { res.writeHead(400); return res.end('id desconhecido'); }
      const dir = resolvePath(id);
      if (!fs.existsSync(dir)) { res.writeHead(404); return res.end('pasta nao existe'); }
      execFile('code', [dir], err => {
        if (err) console.error('[api/open] falhou abrir', id, '-', err.message);
      });
    } catch (e) { /* payload inválido, ignora */ }
    res.writeHead(204); return res.end();
  }

  // Tira a query string antes de tratar a URL como caminho de arquivo —
  // sem isso, `/simbionte.html?cwd=...` virava um 404, porque o `?cwd=...`
  // inteiro era tratado como parte do nome do arquivo (achado real,
  // 2026-09-09, quando o painel ainda era um iframe de /build.html).
  const urlPath = req.url.split('?')[0];
  let filePath;
  try {
    filePath = path.join(ROOT, decodeURIComponent(urlPath === '/' ? '/simbionte.html' : urlPath));
  } catch (e) {
    // URL com % mal-formado (ex: "/%zz") faz decodeURIComponent lançar —
    // sem isso aqui, essa rejeição de Promise não tratada derrubava o
    // processo inteiro (http.createServer(async ...)).
    res.writeHead(400); return res.end('bad request');
  }
  // path.relative cobre o caso que `filePath.startsWith(ROOT)` deixa passar:
  // um diretório IRMÃO cujo nome começa com o mesmo prefixo de ROOT também
  // "startsWith", mesmo estando fora da pasta servida.
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    // Sem isso, nada impedia o navegador/webview de guardar uma cópia
    // antiga de simbionte.html/build.html em cache e nunca buscar a
    // versão nova mesmo depois de "Reload Window" — não tínhamos
    // confirmação de que era a causa real do "recarreguei e continua
    // igual" (2026-09-10), mas também não custa nada eliminar a dúvida.
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

// Só loopback, nos dois protocolos: sem auth + CORS "*", escutar em todas as
// interfaces expunha tudo pra rede (Wi-Fi público). Os dois porque "localhost"
// pode resolver pra ::1 ou 127.0.0.1 dependendo do cliente.
for (const host of ['127.0.0.1', '::1']) {
  http.createServer(handler)
    .on('error', (err) => {
      console.error(`Erro no servidor em ${host} (${err.code}) — encerrando pra o loop de reinício tentar de novo.`);
      process.exit(1);
    })
    .listen(PORT, host, () => console.log(`Simbionte — vivo em http://localhost:${PORT} (${host})`));
}
