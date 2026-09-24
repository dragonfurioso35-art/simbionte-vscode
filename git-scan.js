const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);

const PROJECTS_ROOT = process.env.SIMBIONTE_PROJECTS_ROOT || path.join(os.homedir(), 'Projects');

// Exceções: id do projeto -> caminho real (quando não é Projects/<id>)
// Nesta máquina todos os 17 projetos vivem direto em Projects/<id>, sem exceções.
// Projetos que não moram em ~/Projects/<id> — módulos dentro de outro repo,
// sobretudo. Vem do data.js, que é gerado por gerar-data.js a partir dos
// caminhos reais do store; antes disto era um objeto vazio aqui e qualquer
// projeto fora do padrão aparecia como ausente no painel.
const { PATH_OVERRIDES = {} } = require('./data.js');

// \x1f (unit separator) como delimitador do git log — %s (assunto do commit)
// pode conter "|" sem problema nenhum, então um separador visível quebra o
// parse (o nome do autor grudava no fim da mensagem exibida). \x1f nunca
// aparece em texto normal.
const LOG_FORMAT = '%ct\x1f%s\x1f%an';

function resolvePath(id) {
  return PATH_OVERRIDES[id] || path.join(PROJECTS_ROOT, id);
}

// ahead/behind vêm do cache local do último `git fetch`/push/pull que VOCÊ
// já fez — de propósito não roda `git fetch` aqui (evita tráfego de rede
// periódico e travamento por rede ruim a cada scan). Pode ficar desatualizado
// se fizer muito tempo que não sincroniza, igual o Explorer do VS Code.
async function readAheadBehind(dir, opts) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], opts);
    const [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
    return { ahead, behind };
  } catch (e) {
    return { ahead: null, behind: null }; // sem upstream configurado, ou sem @{u} ainda resolvido
  }
}

// Status do último workflow do GitHub Actions, via `gh` CLI — silenciosamente
// null se: não tiver remote do GitHub, `gh` não estiver instalado/autenticado,
// ou o repo não tiver nenhum workflow rodado. Nunca derruba o resto do scan.
async function readCiStatus(dir, opts) {
  try {
    const { stdout: remoteUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], opts);
    const m = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!m) return null;
    const repo = `${m[1]}/${m[2]}`;
    const { stdout } = await execFileAsync('gh', ['run', 'list', '--repo', repo, '--limit', '1', '--json', 'conclusion,status'], { timeout: 4000 });
    const runs = JSON.parse(stdout);
    if (!runs.length) return null;
    return { repo, conclusion: runs[0].conclusion || null, status: runs[0].status || null };
  } catch (e) {
    return null;
  }
}

// Achado 2026-09-23: exigir `.git` DENTRO do diretório reprovava todo
// módulo que mora dentro de outro repo — `meu-monorepo/addons/modulo_estoque`
// e companhia. Eram 11 dos 26 projetos (42%) aparecendo como ausentes no
// painel, existindo no disco o tempo todo. Um subdiretório de repo é um
// alvo de scan perfeitamente válido: o git responde de qualquer lugar da
// árvore. Subir até achar o `.git` é o que distingue "não é repo" de "é
// pasta dentro de um repo".
function dentroDeRepoGit(dir) {
  let atual = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(atual, '.git'))) return true;
    const pai = path.dirname(atual);
    if (pai === atual) return false; // chegou na raiz do volume
    atual = pai;
  }
}

async function scanOne(id) {
  const dir = resolvePath(id);
  if (!fs.existsSync(dir) || !dentroDeRepoGit(dir)) {
    return { exists: false };
  }
  try {
    const opts = { cwd: dir, encoding: 'utf8', timeout: 4000 };
    // `-- .` limita o log ao diretório escaneado. Na raiz de um repo é
    // equivalente a `git log` puro; num módulo, é a diferença entre "último
    // commit deste módulo" e "último commit do repo inteiro" — sem isto,
    // todo módulo de um mesmo repo mostraria a mesma data, sempre.
    const [{ stdout: logOut }, { stdout: branchOut }, { stdout: statusOut }] = await Promise.all([
      execFileAsync('git', ['log', '-1', '--format=' + LOG_FORMAT, '--', '.'], opts),
      execFileAsync('git', ['branch', '--show-current'], opts),
      execFileAsync('git', ['status', '--porcelain', '.'], opts),
    ]);
    const [tsStr, msg] = logOut.trim().split('\x1f');
    const branch = branchOut.trim() || 'HEAD';
    const status = statusOut.trim();
    const dirtyCount = status ? status.split('\n').filter(Boolean).length : 0;

    // Ahead/behind e CI falham independente (repo sem upstream, sem gh, sem
    // remote do GitHub) — não podem derrubar o resultado principal do scan,
    // por isso ficam fora do Promise.all de cima e com seu próprio catch.
    const [aheadBehind, ci] = await Promise.all([
      readAheadBehind(dir, opts),
      readCiStatus(dir, opts),
    ]);

    return {
      exists: true,
      lastCommitTs: tsStr ? parseInt(tsStr, 10) * 1000 : null,
      lastCommitMsg: msg || null,
      branch,
      dirtyCount,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      ci,
    };
  } catch (e) {
    return { exists: true, error: true };
  }
}

async function scanAll(ids) {
  const entries = await Promise.all(ids.map(async id => [id, await scanOne(id)]));
  return Object.fromEntries(entries);
}

module.exports = { scanAll, resolvePath };
