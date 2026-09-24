const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');
const URLS_PATH = path.join(os.homedir(), '.claude', 'simbionte-urls.json');

// progressoDoPlano vem do mesmo módulo que o hook usa — sem isso a extensão
// teria que reimplementar o parser de checkbox. Vem empacotado em lib/
// (prepare.js), então funciona mesmo antes de os hooks serem instalados.
let progressoDoPlano = () => null;
try {
  ({ progressoDoPlano } = require('./lib/store.js'));
} catch (e) { /* rodando do repo sem prepare.js — cai pro cache do hook */ }

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
// matcher -> arquivo do hook. Mesmo registro que o README pedia pra fazer à mão.
const HOOKS = [
  { matcher: 'TodoWrite', file: 'progress-hook.js' },
  { matcher: 'Edit|Write|Bash', file: 'activity-hook.js' },
];

function lerSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch (e) { return e.code === 'ENOENT' ? {} : null; } // null = JSON inválido, não sobrescrever
}

function hooksRegistrados(settings) {
  const cmds = JSON.stringify((settings && settings.hooks && settings.hooks.PostToolUse) || []);
  return HOOKS.every(h => cmds.includes(h.file));
}

// Copia hooks + store pra ~/.claude e registra em settings.json. Idempotente:
// rodar de novo só atualiza os arquivos (útil depois de atualizar a extensão).
async function instalarHooks(extensionUri) {
  const settings = lerSettings();
  if (settings === null) {
    return vscode.window.showErrorMessage(`Simbionte: ${SETTINGS_PATH} não é um JSON válido — corrija antes de instalar.`);
  }
  const ok = await vscode.window.showWarningMessage(
    `O Simbionte vai copiar 3 arquivos pra ${CLAUDE_DIR} e adicionar 2 hooks PostToolUse em settings.json (backup em settings.json.bak).`,
    { modal: true }, 'Instalar');
  if (ok !== 'Instalar') return;

  const lib = vscode.Uri.joinPath(extensionUri, 'lib').fsPath;
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  for (const h of HOOKS) fs.copyFileSync(path.join(lib, 'hooks', h.file), path.join(CLAUDE_DIR, h.file));
  // Os hooks fazem require('./simbionte-store') — o store vai como irmão.
  fs.copyFileSync(path.join(lib, 'store.js'), path.join(CLAUDE_DIR, 'simbionte-store.js'));

  if (!hooksRegistrados(settings)) {
    if (fs.existsSync(SETTINGS_PATH)) fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + '.bak');
    settings.hooks = settings.hooks || {};
    settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
    const atuais = JSON.stringify(settings.hooks.PostToolUse);
    for (const h of HOOKS) {
      if (atuais.includes(h.file)) continue;
      settings.hooks.PostToolUse.push({
        matcher: h.matcher,
        hooks: [{ type: 'command', command: `node "${path.join(CLAUDE_DIR, h.file)}"`, timeout: 3 }],
      });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  }
  vscode.window.showInformationMessage('Simbionte: hooks instalados. Vale nas próximas sessões do Claude Code.');
}

// Insights calculados AQUI, não buscados por HTTP: insights.js é puro —
// recebe o scan e devolve sinais, sem saber o que é servidor. O scan vem do
// disco (`_scan.<porta>.json`, escrito pelo servidor). Resultado: o painel
// mostra saúde e sinais mesmo com o servidor fora do ar; só envelhece.
//
// lib/ é populado pelo deploy.js a partir da raiz do repo — o vsce empacota
// só o que está sob vscode-extension/, então um require('../') quebraria na
// extensão instalada. Import defensivo pelo mesmo motivo do de cima.
let lerScan = () => null, computeSignals = null, synthesize = null, computeHealth = null,
    classificar = null, PROJECTS = [], RELATIONS = [];
try {
  ({ lerScan } = require('./lib/scan-store.js'));
  ({ computeSignals, synthesize, computeHealth, classificar } = require('./lib/insights.js'));
  ({ PROJECTS, RELATIONS } = require('./lib/data.js'));
} catch (e) { /* libs não empacotadas — painel segue sem o bloco de insights */ }

// Um projeto novo entra no store sozinho (o hook o descobre pelo cwd) e
// aparece na lista na hora, mas fica fora de saúde e sinais até alguém rodar
// `node gerar-data.js --gravar`. Sem este aviso, some em silêncio desses dois
// blocos e ninguém nota — a pergunta que originou isto foi exatamente "e se
// eu criar outro projeto, vai ser pego?".
function naoCatalogados(projetos) {
  if (!classificar || !PROJECTS.length) return [];
  return projetos
    .map(p => p.projectId)
    .filter(id => id && classificar(id, PROJECTS).foraDoMapa);
}

const PORTA_SERVIDOR = 4737;

// { id: nome legível } — montado uma vez, o catálogo não muda em runtime.
const NOMES_PROJETO = Object.fromEntries(PROJECTS.map(p => [p.id, p.name]));

function lerInsights() {
  if (!computeSignals || !lerScan) return null;
  const scan = lerScan(PORTA_SERVIDOR);
  if (!scan) return null; // servidor nunca rodou nesta máquina
  try {
    const signals = computeSignals(scan.data, PROJECTS, RELATIONS);
    return {
      synthesis: synthesize(signals),
      health: computeHealth(scan.data, PROJECTS, RELATIONS),
      scanAgeMs: Date.now() - scan.updatedAt,
    };
  } catch (e) {
    // Insight quebrado não pode derrubar o painel: o progresso e a atividade
    // são mais críticos e não dependem disto. Mesmo raciocínio do try/catch
    // separado em server.js:refresh().
    return null;
  }
}

// ponytail: tentei node-notifier pra notificação de SO de verdade (visível
// mesmo com o VS Code em segundo plano), mas o SnoreToast.exe que ele usa
// no Windows travou (nunca retorna) neste ambiente — sem confiança nisso,
// melhor usar só a API do VS Code, que já é confiável, do que arriscar
// processo zumbi. Upgrade: revisitar node-notifier (ou notificação nativa
// via PowerShell/WinRT) se essa notificação in-app se mostrar insuficiente.
function notificar(title, message) {
  vscode.window.showInformationMessage(`${title}: ${message}`);
}

function lerUrlProjeto(projectId) {
  try { return JSON.parse(fs.readFileSync(URLS_PATH, 'utf8'))[projectId] || null; }
  catch (e) { return null; }
}

// Sincronização entre máquinas: o progresso do plano já sincroniza sozinho
// via git (docs/superpowers/plans/*.md é versionado) — o que falta é o
// CACHE em ~/.claude/simbionte/*.json, que só é atualizado quando o hook
// dispara. Um "git pull" sozinho nunca re-dispara o hook, então o painel
// ficava preso no estado de antes do pull. Aqui, só pro projeto em foco
// (custo: 1 scan de diretório por enviar(), não vale pagar isso pra todo
// projeto listado), lê o `.md` de plano mais recente direto do disco e
// usa esse resultado se ele for mais novo que o cache.
function planoMaisRecente(projectPath) {
  if (!projectPath) return null;
  const dir = path.join(projectPath, 'docs', 'superpowers', 'plans');
  let arquivos;
  try { arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.md')); }
  catch (e) { return null; }
  let escolhido = null, maiorMtime = -1;
  for (const f of arquivos) {
    const p = path.join(dir, f);
    try {
      const mtime = fs.statSync(p).mtimeMs;
      if (mtime > maiorMtime) { maiorMtime = mtime; escolhido = p; }
    } catch (e) { /* sumiu entre o readdir e o stat, ignora */ }
  }
  return escolhido;
}

function comProgressoAoVivo(projeto, currentProject) {
  if (!projeto || (projeto.projectId !== currentProject && projeto.projectName !== currentProject)) return projeto;
  const plano = planoMaisRecente(projeto.projectPath);
  if (!plano) return projeto;
  const vivo = progressoDoPlano(plano);
  if (!vivo) return projeto;
  // updatedAt vira o mtime do arquivo, não Date.now() — senão a cada poll
  // de 5s o "progress" pareceria mais novo que qualquer atividade, e a
  // lógica de "atividade após conclusão" do build.html nunca disparava.
  try { vivo.updatedAt = fs.statSync(plano).mtimeMs; } catch (e) { /* arquivo sumiu no meio, usa Date.now() mesmo */ }
  return { ...projeto, progress: vivo };
}

// Arquivos de controle que dividem o diretório com os projetos. `_scan` é do
// servidor, `_heartbeat` dos hooks, `_aviso_uso_*` é de OUTRA ferramenta
// (um hook de aviso de uso) — o diretório não é exclusivo do Simbionte.
const INTERNOS_RE = /^_(heartbeat|scan\.\d+|aviso_uso_[^/\\]*)\.json$/i;

function lerTodosProjetos(currentProject) {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    // Achado 2026-09-23: o filtro era `!f.startsWith('_')`, e isso escondia
    // DOIS projetos reais — `_ferramentas` (o próprio Simbionte) e
    // `_workspace` — porque as pastas deles começam com underscore. O
    // painel ficava cego justamente pro repo em que se estava trabalhando.
    // Agora descarta por nome só o que é sabidamente interno, e confirma
    // pela FORMA do conteúdo: arquivo de projeto tem projectName, os de
    // controle não têm. Nome é convenção e quebra; forma é o contrato.
    .filter(f => f.endsWith('.json') && !INTERNOS_RE.test(f))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
      catch (e) { return null; }
    })
    .filter(p => p && p.projectName)
    .map(p => comProgressoAoVivo(p, currentProject));
}

// Notificação real de SO só na TRANSIÇÃO (plano bateu 100%, ou um checkbox
// foi fechado via Bash) — nunca a cada poll de 5s, senão vira spam. Guarda
// o último estado conhecido de cada projeto em memória.
const estadoConhecido = new Map();
function checarTransicoes(projetos) {
  for (const p of projetos) {
    const anterior = estadoConhecido.get(p.projectId) || {};
    const percentAtual = p.progress ? p.progress.percent : null;
    if (percentAtual === 100 && anterior.percent !== 100) {
      notificar('Simbionte', `Plano concluído: ${p.projectName}`);
    }
    const viaBashAtual = !!(p.progress && p.progress.viaBash);
    if (viaBashAtual && !anterior.viaBash) {
      notificar('Simbionte — REGRA DE OURO', `Checkbox editado via Bash em ${p.projectName} — Edit/Write manual recomendado`);
    }
    estadoConhecido.set(p.projectId, { percent: percentAtual, viaBash: viaBashAtual });
  }
}

const estadoTravamento = { travado: false };
let enviarAtual = null;

class SimbiontePainelProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this._html();

    const projetoAtual = () => {
      const pasta = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return pasta ? path.basename(pasta) : null;
    };
    const enviar = () => {
      const atual = projetoAtual();
      const projetos = lerTodosProjetos(atual);
      checarTransicoes(projetos);
      // Achado 2026-09-23: o banner lia `estadoTravamento.travado`, que só é
      // recalculado pelo timer de 60s — então ele continuava na tela por até
      // um minuto DEPOIS de os hooks voltarem a rodar. Aqui o estado é lido
      // do disco na hora, e o banner some no próximo ciclo de 5s.
      // O timer de 60s continua existindo, mas só para o popup do SO, que
      // não pode disparar a cada poll.
      webviewView.webview.postMessage({
        type: 'update', projetos, currentProject: atual, travado: hooksTravados(),
        insights: lerInsights(),
        // Os insights vêm com o id do catálogo ("MEU-APP-V4"); o nome
        // legível só existe no data.js, que é do lado da extensão.
        nomesProjeto: NOMES_PROJETO,
        naoCatalogados: naoCatalogados(projetos),
      });
    };
    enviarAtual = enviar;
    enviar();

    fs.mkdirSync(DIR, { recursive: true });
    // escreverAtomico grava um .tmp e depois renomeia — as duas operações
    // disparam esse watcher, então cada update real chama enviar() 2x sem
    // isso; filtrar o .tmp evita o re-render redundante.
    const watcher = fs.watch(DIR, { persistent: true }, (_evento, filename) => {
      if (!filename || !filename.endsWith('.tmp')) enviar();
    });
    // ponytail: fs.watch em diretório trava silenciosamente no Windows sob
    // carga (sem emitir 'error') — poll de reserva garante no máximo alguns
    // segundos de atraso mesmo se o watcher morrer. Upgrade se não bastar:
    // watcher.on('error', ...) recriando o watch.
    const pollFallback = setInterval(enviar, 5000);
    const msgListener = webviewView.webview.onDidReceiveMessage(msg => {
      if (!msg) return;
      if (msg.type === 'openApp') {
        const url = msg.projectId ? lerUrlProjeto(msg.projectId) : null;
        if (url && /^https?:\/\//i.test(url)) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        } else if (msg.path) {
          vscode.window.showTextDocument(vscode.Uri.file(msg.path))
            .then(undefined, () => vscode.window.showWarningMessage('Arquivo não encontrado: ' + msg.path));
        }
      } else if (msg.type === 'openProject' && msg.path) {
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), { forceNewWindow: true });
      }
    });
    webviewView.onDidDispose(() => {
      watcher.close();
      clearInterval(pollFallback);
      msgListener.dispose();
      if (enviarAtual === enviar) enviarAtual = null;
    });
  }

  _html() {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'build.html').fsPath;
    return fs.readFileSync(htmlPath, 'utf8');
  }
}

const LIMITE_TRAVADO_MS = 15 * 60 * 1000;

// Lê o heartbeat do disco na hora, em vez de devolver um estado calculado
// por um timer lento. Quem pergunta "está travado agora?" precisa da
// resposta de agora — o banner é um alarme, e alarme que demora a desligar
// treina a pessoa a ignorá-lo.
function hooksTravados() {
  let lastRun = 0;
  try {
    lastRun = JSON.parse(fs.readFileSync(path.join(DIR, '_heartbeat.json'), 'utf8')).lastRun || 0;
  } catch (e) { /* sem heartbeat ainda — ver abaixo */ }
  // Sem heartbeat nenhum não é "travado": é máquina onde nenhum hook rodou
  // ainda. Alarmar aí seria ruído na primeira execução.
  if (!lastRun) return false;
  return (Date.now() - lastRun) > LIMITE_TRAVADO_MS;
}

function iniciarAlertaTravamento() {
  let vistoFresco = false;
  let jaAlertou = false;
  const heartbeatPath = path.join(DIR, '_heartbeat.json');
  const timer = setInterval(() => {
    let lastRun = 0;
    try { lastRun = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')).lastRun || 0; } catch (e) { /* sem heartbeat ainda */ }
    const travadoAntes = estadoTravamento.travado;
    if (Date.now() - lastRun < LIMITE_TRAVADO_MS) {
      vistoFresco = true;
      jaAlertou = false;
      estadoTravamento.travado = false;
    } else if (vistoFresco) {
      estadoTravamento.travado = true;
      if (!jaAlertou) {
        jaAlertou = true;
        // já é showWarningMessage (não notificar()) — esse já tinha o botão
        // "Ver Simbionte", não precisa duplicar com outro popup genérico.
        vscode.window.showWarningMessage(
          'Simbionte: nenhum hook rodou nos últimos 15 min — Claude Code pode ter travado.',
          'Ver Simbionte'
        ).then(escolha => {
          if (escolha) vscode.commands.executeCommand('workbench.view.extension.simbionte');
        });
      }
    }
    if (estadoTravamento.travado !== travadoAntes && enviarAtual) enviarAtual();
  }, 60 * 1000);
  return timer;
}

function activate(context) {
  const provider = new SimbiontePainelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('simbionte.painel', provider)
  );
  const timer = iniciarAlertaTravamento();
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(
    vscode.commands.registerCommand('simbionte.instalarHooks', () => instalarHooks(context.extensionUri))
  );
  // Sem hooks o painel fica vazio pra sempre — avisa uma vez por sessão.
  if (!hooksRegistrados(lerSettings())) {
    vscode.window.showInformationMessage('Simbionte: os hooks do Claude Code ainda não estão instalados.', 'Instalar agora')
      .then(escolha => { if (escolha) instalarHooks(context.extensionUri); });
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
