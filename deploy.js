#!/usr/bin/env node
// Empacota + instala a extensão do VS Code e sincroniza os hooks do Claude
// Code a partir da fonte deste repo — os dois passos manuais que já
// causaram uma deriva real hoje (extensão instalada ficou desatualizada em
// relação ao que estava testado, sem ninguém perceber). `node deploy.js`
// faz os dois de uma vez, sempre na mesma ordem, sem depender de lembrar.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const EXT_DIR = path.join(ROOT, 'vscode-extension');
const HOOKS_SRC = path.join(ROOT, 'claude-hooks');
const HOOKS_DEST = path.join(os.homedir(), '.claude');
const LOCK_FILE = path.join(ROOT, '.supervisor.lock'); // mesmo caminho que supervisor.js usa
const PORT_PADRAO = 4737;

function passo(nome, fn) {
  process.stdout.write(`==> ${nome}... `);
  try {
    fn();
    console.log('ok');
  } catch (e) {
    console.log('FALHOU');
    console.error(e.message);
    process.exit(1);
  }
}

// No Windows, npx/npm/code são .cmd (wrappers de batch) — execFileSync sem
// shell:true não resolve isso (spawnSync ENOENT), precisa passar pelo shell.
const win = process.platform === 'win32';

// As libs da raiz vão pra vscode-extension/lib/ pelo vscode:prepublish
// (prepare.js), que o próprio `vsce package` dispara.

passo('empacotando extensão (vsce)', () => {
  execFileSync('npx', ['--yes', '@vscode/vsce', 'package', '--allow-missing-repository'], {
    cwd: EXT_DIR, stdio: 'inherit', shell: win,
  });
});

passo('instalando extensão no VS Code', () => {
  const vsix = fs.readdirSync(EXT_DIR).find(f => f.endsWith('.vsix'));
  if (!vsix) throw new Error('nenhum .vsix encontrado depois do empacotamento');
  execFileSync('code', ['--install-extension', path.join(EXT_DIR, vsix)], { stdio: 'inherit', shell: win });
});

passo('sincronizando hooks pra ~/.claude', () => {
  for (const f of fs.readdirSync(HOOKS_SRC)) {
    if (!f.endsWith('.js')) continue;
    fs.copyFileSync(path.join(HOOKS_SRC, f), path.join(HOOKS_DEST, f));
    console.log(`\n    ${f} -> ${HOOKS_DEST}`);
  }

  // store.js mora na raiz (o servidor e a extensão também o usam), mas os
  // hooks o requerem como irmão — `require('./simbionte-store')`. Vai com o
  // nome antigo de propósito: é como a cópia instalada sempre se chamou, e
  // test_lock_race.js monta esse caminho em runtime pra testar o lock em
  // dois processos. Renomear quebraria aquele teste sem ganhar nada.
  //
  // Achado 2026-09-23: a cópia instalada chegou a ficar MAIS NOVA que a
  // fonte (tinha o fix de sub-projeto de 2026-09-02 que o repo não tinha).
  // Com o store versionado aqui, o deploy é o único caminho de escrita e
  // essa divergência deixa de ser possível.
  fs.copyFileSync(path.join(ROOT, 'store.js'), path.join(HOOKS_DEST, 'simbionte-store.js'));
  console.log(`\n    store.js -> ${path.join(HOOKS_DEST, 'simbionte-store.js')}`);
});

// Gerado aqui (não copiado de um .vbs versionado) pra embutir o caminho real
// deste clone — assim funciona em qualquer máquina/pasta onde o repo estiver.
const STARTUP_VBS = win && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'simbionte-server.vbs');

if (win) {
  passo('registrando autostart no Startup do Windows', () => {
    const cmd = path.join(ROOT, 'run-server.cmd');
    fs.writeFileSync(STARTUP_VBS,
      'Set WshShell = CreateObject("WScript.Shell")\r\n' +
      `WshShell.Run """${cmd}""", 0, False\r\n`);
    console.log(`\n    ${STARTUP_VBS}`);
  });

  // Seguro rodar sempre: o supervisor sai sozinho se já houver um vivo (lock).
  // Achado 2026-09-23: este passo dizia "ok" sem nunca ter substituído nada.
  // O supervisor tem trava de instância única por PID, então o novo saía com
  // "Já tem um supervisor rodando" e o ANTIGO seguia no ar — com o código
  // que ele carregou na partida, às vezes de horas antes. Um deploy que
  // altera server.js parecia ter funcionado e não tinha: os testes passavam
  // (sobem instância própria na 4577) enquanto a 4737 servia código velho.
  // Derrubar a instância anterior é o que torna o "ok" verdadeiro.
  passo('derrubando a instância anterior (se houver)', () => {
    if (!fs.existsSync(LOCK_FILE)) return console.log(' nenhuma rodando');
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (!pid) return console.log(' lock ilegível, seguindo');
    try {
      // Mata a árvore: o supervisor respawna o server.js se só o filho morrer.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      console.log(` supervisor ${pid} derrubado`);
    } catch (e) {
      console.log(` PID ${pid} já estava morto`);
    }
    try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* já foi */ }
  });

  passo('subindo o servidor agora', () => {
    execFileSync('wscript', [STARTUP_VBS], { stdio: 'inherit' });
  });

  // Confirmação pós-deploy real: o passo acima é fire-and-forget (wscript
  // volta na hora), então sem isto o deploy termina anunciando sucesso sem
  // nenhuma evidência de que o servidor subiu.
  passo('confirmando que o servidor respondeu', () => {
    const limite = Date.now() + 30000;
    for (;;) {
      try {
        execFileSync('curl', ['-sf', '-m', '3', '-o', os.devNull,
          `http://127.0.0.1:${PORT_PADRAO}/api/status`], { stdio: 'ignore' });
        return console.log(` HTTP 200 na ${PORT_PADRAO}`);
      } catch (e) {
        if (Date.now() > limite) throw new Error(`servidor não respondeu na ${PORT_PADRAO} em 30s`);
        execFileSync('node', ['-e', 'setTimeout(()=>{},1000)']); // espera 1s sem dependência nova
      }
    }
  });
}

console.log('\nDeploy completo. Reload Window no VS Code pra pegar a extensão nova.');
