const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.homedir(), '.claude', 'simbionte');
const URLS_PATH = path.join(os.homedir(), '.claude', 'simbionte-urls.json');

// progressoDoPlano vem do mesmo módulo que o hook usa — sem isso a extensão
// teria que reimplementar o parser de checkbox. Vem empacotado em lib/
// (prepare.js), então funciona mesmo antes de os hooks serem instalados.
let progressoDoPlano = () => null, resumoSessoes = () => null;
try {
  ({ progressoDoPlano, resumoSessoes } = require('./lib/store.js'));
} catch (e) { /* rodando do repo sem prepare.js — cai pro cache do hook */ }
const { ARQUIVOS, hooksFaltando, adicionarHooks, removerHooks } = require('./lib/hooks-settings.js');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
function lerSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch (e) { return e.code === 'ENOENT' ? {} : null; } // null = JSON inválido, não sobrescrever
}

// Copia hooks + store pra ~/.claude e registra em settings.json. Idempotente:
// rodar de novo só atualiza os arquivos e acrescenta o que faltar (quem veio
// da 1.0.x ganha os hooks de estado do watchdog sem duplicar os antigos).
async function instalarHooks(extensionUri) {
  const settings = lerSettings();
  if (settings === null) {
    return vscode.window.showErrorMessage(`Simbionte: ${SETTINGS_PATH} não é um JSON válido — corrija antes de instalar.`);
  }
  const faltando = hooksFaltando(settings);
  const eventos = [...new Set(faltando.map(h => h.evento))].join(', ');
  const ok = await vscode.window.showWarningMessage(
    `O Simbionte vai copiar ${ARQUIVOS.length} arquivos pra ${CLAUDE_DIR}`
    + (faltando.length ? ` e adicionar ${faltando.length} hooks em settings.json (${eventos}). Backup do original em settings.json.bak.` : '.'),
    { modal: true }, 'Instalar');
  if (ok !== 'Instalar') return;

  const lib = vscode.Uri.joinPath(extensionUri, 'lib').fsPath;
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  for (const f of ARQUIVOS) {
    // Os hooks fazem require('./simbionte-store') — o store vai como irmão.
    const origem = f === 'simbionte-store.js' ? path.join(lib, 'store.js') : path.join(lib, 'hooks', f);
    fs.copyFileSync(origem, path.join(CLAUDE_DIR, f));
  }

  if (faltando.length) {
    // .bak só na 1ª vez: guarda o settings de ANTES do Simbionte. Sobrescrever
    // a cada instalação trocaria o original por uma cópia já com os hooks.
    const bak = SETTINGS_PATH + '.bak';
    if (fs.existsSync(SETTINGS_PATH) && !fs.existsSync(bak)) fs.copyFileSync(SETTINGS_PATH, bak);
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(adicionarHooks(settings, CLAUDE_DIR), null, 2) + '\n');
  }
  vscode.window.showInformationMessage('Simbionte: hooks instalados. Vale nas próximas sessões do Claude Code.');
}

// Desfaz a instalação: tira do settings.json só as entradas do Simbionte
// (hooks de outras ferramentas ficam) e apaga os arquivos copiados. Não
// restaura o .bak de propósito — ele é de antes da instalação, e restaurar
// jogaria fora tudo que você mudou no settings.json depois disso.
async function removerHooksCmd() {
  const settings = lerSettings();
  if (settings === null) {
    return vscode.window.showErrorMessage(`Simbionte: ${SETTINGS_PATH} não é um JSON válido — corrija antes de remover.`);
  }
  const ok = await vscode.window.showWarningMessage(
    `O Simbionte vai tirar os hooks dele de settings.json e apagar ${ARQUIVOS.join(', ')} de ${CLAUDE_DIR}. Hooks de outras ferramentas não são tocados.`,
    { modal: true }, 'Remover');
  if (ok !== 'Remover') return;
  if (fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(removerHooks(settings), null, 2) + '\n');
  }
  for (const f of ARQUIVOS) {
    try { fs.unlinkSync(path.join(CLAUDE_DIR, f)); } catch (e) { /* já não existia */ }
  }
  vscode.window.showInformationMessage(`Simbionte: hooks removidos. Os dados do painel ficam em ${DIR} (pode apagar a pasta). Agora é só desinstalar a extensão.`);
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
      // Achado 2026-09-23: o banner lia um estado recalculado pelo timer de
      // 60s e ficava na tela até um minuto DEPOIS de os hooks voltarem.
      // Aqui o estado é lido do disco na hora (ciclo de 5s); o timer de 60s
      // é só pro popup, que não pode disparar a cada poll.
      webviewView.webview.postMessage({
        type: 'update', projetos, currentProject: atual, sessao: sessaoAtual(),
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

function limiteTravadoMs() {
  const min = Number(vscode.workspace.getConfiguration('simbionte').get('limiteTravadoMin', 15));
  return Math.max(1, min || 15) * 60 * 1000;
}

function lerSessoes() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, '_heartbeat.json'), 'utf8')).sessoes || {}; }
  catch (e) { return {}; }
}

// Lido do disco na hora, a cada envio: o banner é um alarme, e alarme que
// demora a desligar treina a pessoa a ignorá-lo. Sem sessão conhecida
// (hooks da 1.0.x, ou nenhum hook rodou ainda) = null, nunca "travada".
function sessaoAtual() {
  const limite = limiteTravadoMs();
  const s = resumoSessoes(lerSessoes(), Date.now(), limite);
  if (s) s.limiteMin = Math.round(limite / 60000);
  return s;
}

// Popup só na transição pra "travada", uma vez por episódio de cada sessão.
// O banner já mostra o estado; o popup é pra quem está em outra aba.
function iniciarAlertaTravamento() {
  const alertadas = new Set();
  return setInterval(() => {
    const s = sessaoAtual();
    const travada = s && s.estado === 'travada' ? s.sessionId : null;
    for (const id of alertadas) if (id !== travada) alertadas.delete(id);
    if (!travada || alertadas.has(travada)) return;
    alertadas.add(travada);
    vscode.window.showWarningMessage(
      `Simbionte: o Claude Code estava trabalhando e está sem sinal há mais de ${s.limiteMin} min — pode ter travado.`,
      'Ver Simbionte'
    ).then(escolha => {
      if (escolha) vscode.commands.executeCommand('workbench.view.extension.simbionte');
    });
  }, 60 * 1000);
}

function activate(context) {
  const provider = new SimbiontePainelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('simbionte.painel', provider)
  );
  const timer = iniciarAlertaTravamento();
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(
    vscode.commands.registerCommand('simbionte.instalarHooks', () => instalarHooks(context.extensionUri)),
    vscode.commands.registerCommand('simbionte.removerHooks', removerHooksCmd),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('simbionte.limiteTravadoMin') && enviarAtual) enviarAtual();
    })
  );
  // Sem hooks o painel fica vazio pra sempre; com hooks da 1.0.x o watchdog
  // não distingue "esperando você" de "travou". Avisa uma vez por sessão.
  const settings = lerSettings();
  const faltando = settings ? hooksFaltando(settings) : [];
  if (faltando.length) {
    const nenhum = faltando.length === hooksFaltando({}).length;
    vscode.window.showInformationMessage(
      nenhum ? 'Simbionte: os hooks do Claude Code ainda não estão instalados.'
        : 'Simbionte: há hooks novos (estado da sessão) — atualize pra parar os falsos alarmes de travamento.',
      nenhum ? 'Instalar agora' : 'Atualizar hooks')
      .then(escolha => { if (escolha) instalarHooks(context.extensionUri); });
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
