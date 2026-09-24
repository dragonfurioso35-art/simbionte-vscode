#!/usr/bin/env node
// Teste mínimo, sem dependência nenhuma (só http/assert/child_process do
// próprio Node) — cobre os endpoints principais dos 6 endpoints do
// server.js. Sobe uma instância isolada numa porta própria (SIMBIONTE_PORT),
// não toca na instância real que já está rodando em produção na 4737.
//
// Não é suite completa — é o mínimo pra pegar regressão óbvia na próxima
// feature. `/api/open` só testa a rejeição de id inválido: o caminho feliz
// spawna o VS Code de verdade (efeito colateral visível), não dá pra
// automatizar sem mockar child_process, fora de escopo pro "mínimo" de hoje.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4577;

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    // Passa `path` como campo de options em vez de montar uma URL-string e
    // deixar `http.request` fazer `new URL(...)` nela — o parser de URL do
    // WHATWG normaliza ".." igual um navegador faria, o que mascarava um
    // teste de path traversal de verdade (testava a normalização do
    // cliente, não a guarda do servidor).
    const r = http.request({
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* corpo não é JSON, tudo bem pra alguns endpoints */ }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// 120 tentativas x 300ms = 36s de teto. Medido em 2026-09-22: o scan dos 18
// projetos leva de 6 a 9s em disco frio nesta máquina, e o teto anterior (30
// x 300ms = 9s) ficava exatamente na fronteira — a suíte falhava na primeira
// execução e passava na segunda, com o cache do git quente. Teto generoso não
// custa nada: waitReady retorna assim que o dado chega.
async function waitReady(tentativas) {
  for (let i = 0; i < tentativas; i++) {
    try {
      // Não basta HTTP 200 — o scan é assíncrono (de propósito, pra não
      // travar o servidor), então logo depois do listen() a resposta pode
      // vir com `data: {}` vazio até o primeiro scanAll() terminar.
      const r = await req('GET', '/api/status');
      if (r.status === 200 && r.json.data && Object.keys(r.json.data).length > 0) return;
    } catch (e) { /* ainda subindo */ }
    await new Promise(res => setTimeout(res, 300));
  }
  throw new Error('servidor de teste não respondeu com dados a tempo');
}

const testes = [];
function teste(nome, fn) { testes.push({ nome, fn }); }

teste('GET /api/status retorna todos os projetos com CORS liberado', async () => {
  const r = await req('GET', '/api/status');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.data && Object.keys(r.json.data).length > 0, 'deveria ter pelo menos 1 projeto');
  for (const s of Object.values(r.json.data)) assert.ok('exists' in s, 'cada entrada precisa ter "exists"');
});

teste('POST /api/progress + GET reflete o valor', async () => {
  const post = await req('POST', '/api/progress', { percent: 42, completed: 3, total: 7, activeLabel: 'teste automatizado' });
  assert.strictEqual(post.status, 204);
  const get = await req('GET', '/api/progress');
  assert.strictEqual(get.json.progress.percent, 42);
  assert.strictEqual(get.json.progress.activeLabel, 'teste automatizado');
});

teste('POST /api/progress com payload inválido não derruba o servidor', async () => {
  const r = await req('POST', '/api/progress', { percent: 'não é número', total: null });
  assert.strictEqual(r.status, 204); // ignora silenciosamente, não é erro 500
  const stillUp = await req('GET', '/api/status');
  assert.strictEqual(stillUp.status, 200);
});

teste('POST /api/activity atribui arquivo ao projeto certo', async () => {
  await req('POST', '/api/activity', { file: path.join(cwdDe(FIX_A.id), 'algum', 'arquivo.js'), tool: 'Edit' });
  const r = await req('GET', '/api/progress');
  assert.strictEqual(r.json.activity[0].projectId, FIX_A.id);
});

teste('POST /api/open com id desconhecido retorna 400', async () => {
  const r = await req('POST', '/api/open', { id: 'projeto-que-nao-existe-123' });
  assert.strictEqual(r.status, 400);
});

teste('URL malformada retorna 400 e não derruba o servidor', async () => {
  const r = await req('GET', '/%zz');
  assert.strictEqual(r.status, 400);
  const stillUp = await req('GET', '/api/status');
  assert.strictEqual(stillUp.status, 200);
});

teste('path traversal fora da pasta é bloqueado (403)', async () => {
  // http.request não normaliza ".." como um navegador/curl fariam — chega
  // no servidor exatamente como escrito aqui.
  const r = await req('GET', '/../../../../Windows/win.ini');
  assert.strictEqual(r.status, 403);
});

teste('GET /api/insights retorna sinais e síntese calculados', async () => {
  const r = await req('GET', '/api/insights');
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json.signals), 'signals deveria ser array');
  assert.ok(Array.isArray(r.json.synthesis), 'synthesis deveria ser array');
  assert.ok(typeof r.json.updatedAt === 'number', 'updatedAt deveria ser timestamp');
  if (r.json.synthesis.length > 0) {
    const first = r.json.synthesis[0];
    assert.ok('projectId' in first && 'severity' in first && 'message' in first, 'item de synthesis com formato incompleto');
  }
});

teste('arquivo estático dentro da pasta continua servindo normal', async () => {
  const r = await req('GET', '/data.js');
  assert.strictEqual(r.status, 200);
});

// Os 4 testes abaixo cobrem a sessão de 2026-09-09/10: progresso por
// projeto (não mais 1 valor global), resolução de workspace multi-raiz,
// nota de saúde, e o canal SSE — nenhum tinha teste até agora.

teste('progresso é isolado por projeto (cwd) — POST num não vaza pro GET do outro', async () => {
  await req('POST', '/api/progress', {
    percent: 25, completed: 1, total: 4, activeLabel: 'sessão A',
    cwd: cwdDe(FIX_A.id),
  });
  await req('POST', '/api/progress', {
    percent: 80, completed: 4, total: 5, activeLabel: 'sessão B',
    cwd: cwdDe(FIX_B.id),
  });
  const primeiro = await req('GET', '/api/progress?cwd=' + encodeURIComponent(cwdDe(FIX_A.id)));
  const fin = await req('GET', '/api/progress?cwd=' + encodeURIComponent(cwdDe(FIX_B.id)));
  assert.strictEqual(primeiro.json.progress.percent, 25, 'primeiro projeto deveria continuar em 25%, não pegar o valor do outro');
  assert.strictEqual(fin.json.progress.percent, 80, 'segundo projeto deveria continuar em 80%, não pegar o valor do outro');
  assert.strictEqual(primeiro.json.projectName, FIX_A.name);
  assert.strictEqual(fin.json.projectName, FIX_B.name);
});

teste('workspace multi-raiz: resolve pelo 1º folder catalogado, não só o 1º da lista', async () => {
  // simula extension.js mandando várias pastas separadas por '|' — a 1ª
  // não existe em data.js, só a 2ª bate (achado real, 2026-09-10: só a
  // pasta [0] era considerada antes desse fix).
  const cwd = 'C:\\pasta\\fora\\do\\catalogo|' + cwdDe(FIX_A.id);
  await req('POST', '/api/progress', { percent: 60, completed: 3, total: 5, activeLabel: 'multi-root', cwd });
  const r = await req('GET', '/api/progress?cwd=' + encodeURIComponent(cwd));
  assert.strictEqual(r.json.projectName, FIX_A.name);
  assert.strictEqual(r.json.progress.percent, 60);
});

teste('GET /api/insights inclui nota de saúde (health) pros projetos ativos', async () => {
  const r = await req('GET', '/api/insights');
  assert.ok(r.json.health && typeof r.json.health === 'object', 'health deveria vir no payload');
  const algumAtivo = Object.keys(r.json.health)[0];
  if (algumAtivo) {
    const h = r.json.health[algumAtivo];
    assert.ok(typeof h.score === 'number' && h.score >= 0 && h.score <= 100, 'score deveria ser 0-100');
    assert.ok(['A', 'B', 'C', 'D'].includes(h.grade), 'grade deveria ser A-D');
    assert.ok(Array.isArray(h.reasons), 'reasons deveria ser array');
  }
});

teste('GET /api/events abre um stream SSE e manda o comentário inicial', async () => {
  await new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: PORT, path: '/api/events', method: 'GET' }, res => {
      assert.strictEqual(res.headers['content-type'], 'text/event-stream; charset=utf-8');
      res.once('data', chunk => {
        assert.ok(chunk.toString('utf8').startsWith(':'), 'primeiro byte deveria ser o comentário ":conectado"');
        res.destroy(); // SSE nunca fecha sozinho — sem isso o teste trava pra sempre esperando 'end'
        resolve();
      });
    });
    r.on('error', reject);
    r.end();
    setTimeout(() => reject(new Error('SSE não mandou nada em 3s')), 3000);
  });
});

function getNoHost(host) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host, port: PORT, path: '/api/status', method: 'GET', timeout: 2000 }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end();
  });
}

teste('responde em loopback IPv4 e IPv6 (localhost pode resolver pra qualquer um)', async () => {
  assert.strictEqual(await getNoHost('127.0.0.1'), 200);
  assert.strictEqual(await getNoHost('::1'), 200);
});

// Sem auth + CORS "*": aberto na rede, qualquer um no mesmo Wi-Fi lê os
// projetos e dispara /api/open. Só loopback é aceitável.
teste('recusa conexão pelo IP de rede da máquina (não fica exposto no Wi-Fi)', async () => {
  const ipRede = Object.values(require('os').networkInterfaces()).flat()
    .find(a => a.family === 'IPv4' && !a.internal);
  if (!ipRede) return console.log('    (sem interface de rede ativa — pulado)');
  await assert.rejects(getNoHost(ipRede.address), `servidor aceitou conexão em ${ipRede.address}`);
});

teste('servidor persiste o scan em disco pra extensão ler sem HTTP', async () => {
  const { lerScan } = require('./scan-store');
  const salvo = lerScan(PORT);
  assert.ok(salvo, 'esperava _scan.<porta>.json escrito pelo refresh inicial');
  assert.ok(Object.keys(salvo.data).length > 0, 'scan salvo deveria ter projetos');
  const viaHttp = await req('GET', '/api/status');
  assert.deepStrictEqual(Object.keys(salvo.data).sort(), Object.keys(viaHttp.json.data).sort(),
    'scan em disco e /api/status precisam cobrir os mesmos projetos');
});

function spawnServer() {
  return spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, SIMBIONTE_PORT: String(PORT) },
    stdio: 'ignore',
  });
}

// Fixtures tiradas do catalogo REAL, nao de ids escritos a mao. Antes eram
// 'MEU-APP-V4' e 'meu-financeiro-web' fixos, e a suite inteira quebrou
// quando o data.js foi regenerado em 2026-09-23 — o catalogo antigo nao
// descrevia mais nenhum projeto de verdade. Derivar daqui faz o teste
// acompanhar o catalogo sozinho.
const os = require('os');
const { PROJECTS: CATALOGO, PATH_OVERRIDES: OVERRIDES = {} } = require('./data.js');
const [FIX_A, FIX_B] = CATALOGO;
// Respeita PATH_OVERRIDES: 14 dos 26 projetos são módulos dentro de outro
// repo e NÃO moram em ~/Projects/<id>. Montar o caminho pela convenção
// deixava o servidor sem reconhecer o projeto, e o POST era descartado em
// silêncio — três testes falhavam por isso, todos parecendo bugs do servidor.
const cwdDe = id => OVERRIDES[id] || path.join(os.homedir(), 'Projects', id);

const PROGRESS_STATE_PATH = path.join(__dirname, `progress.state.${PORT}.json`);

(async () => {
  let child = spawnServer();

  let falhas = 0;
  try {
    await waitReady(120);
    for (const { nome, fn } of testes) {
      try {
        await fn();
        console.log('  ok -', nome);
      } catch (e) {
        falhas++;
        console.log('  FALHOU -', nome);
        console.log('    ', e.message);
      }
    }

    // Progresso/atividade sobrevivem a um restart do processo (achado real
    // 2026-09-07: os dois só viviam em memória, um restart zerava o anel
    // público mesmo com trabalho em andamento — ver comentário em
    // server.js acima de PROGRESS_STATE_PATH). Roda fora do array `testes`
    // porque precisa derrubar e resubir o servidor no meio do teste, não só
    // bater nos endpoints de uma instância já de pé.
    try {
      await req('POST', '/api/progress', { percent: 77, completed: 5, total: 9, activeLabel: 'antes do restart' });
      await new Promise(res => setTimeout(res, 250)); // dá tempo do fs.writeFile assíncrono flushar antes do kill
      child.kill();
      await new Promise(res => setTimeout(res, 500));

      child = spawnServer();
      await waitReady(120);
      const r = await req('GET', '/api/progress');
      assert.strictEqual(r.json.progress.percent, 77, 'progresso deveria sobreviver ao restart, não voltar a 0');
      assert.strictEqual(r.json.progress.activeLabel, 'antes do restart');
      console.log('  ok - progresso sobrevive a um restart do processo (persistido em disco)');
    } catch (e) {
      falhas++;
      console.log('  FALHOU - progresso sobrevive a um restart do processo');
      console.log('    ', e.message);
    }
  } finally {
    child.kill();
    try { fs.unlinkSync(PROGRESS_STATE_PATH); } catch (e) { /* já não existe, tudo bem */ }
  }

  // +1 no denominador: o teste de sobrevivência a restart acima roda fora
  // do array `testes` (precisa derrubar/resubir o processo no meio),
  // mas conta pro resumo igual os outros.
  const total = testes.length + 1;
  console.log(`\n${total - falhas}/${total} passaram.`);
  process.exit(falhas > 0 ? 1 : 0);
})();
