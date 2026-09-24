#!/usr/bin/env node
// Substitui o antigo run-server.cmd (`:loop` / `goto loop` sem guarda
// nenhuma). Problema real encontrado em 2026-08-30: aquele loop batch
// reiniciava o server.js pra sempre, a cada 2s, sem nenhum limite — se
// duas instâncias fossem iniciadas (autostart + início manual, por
// exemplo), viravam DOIS supervisores brigando pela mesma porta pra
// sempre, silenciosamente, sem nenhum log ou aviso. Rodou assim, invisível,
// por dias.
//
// Este supervisor corrige as duas causas:
// 1. Trava de instância única (lock file com PID) — se já tem um vivo,
//    este processo novo desiste em vez de duplicar.
// 2. Freio de crash-loop — se o server.js morrer rápido demais (< 3s)
//    muitas vezes seguidas, PARA de reiniciar e grava um log de erro, em
//    vez de martelar reinício pra sempre sem ninguém perceber.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LOCK_FILE = path.join(DIR, '.supervisor.lock');
const CRASH_LOG = path.join(DIR, '.supervisor-crash.log');
const MAX_CRASHES_RAPIDOS = 5; // reinícios com < 3s de vida, seguidos
const JANELA_CRASH_RAPIDO_MS = 3000;
const PAUSA_ENTRE_REINICIOS_MS = 2000;

function pidVivo(pid) {
  try {
    process.kill(pid, 0); // sinal 0: só testa existência, não mata
    return true;
  } catch {
    return false;
  }
}

function adquirirTrava() {
  if (fs.existsSync(LOCK_FILE)) {
    const pidAntigo = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (pidAntigo && pidVivo(pidAntigo)) {
      console.log(`Já tem um supervisor rodando (PID ${pidAntigo}). Saindo sem duplicar.`);
      process.exit(0);
    }
    console.log(`Lock file de PID ${pidAntigo} morto encontrado — assumindo.`);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

// Achado real (2026-09-09/10): isto apagava o lock incondicionalmente. Se
// dois supervisores chegassem a coexistir por um instante (ex: um restart
// manual cruzando com o autostart), o PERDEDOR da corrida pela porta
// (que crash-brakeia rápido, já que `server.js` não consegue bindar)
// apagava o lock do VENCEDOR ao sair — o servidor bom ficava rodando
// órfão, sem trava nenhuma, vulnerável à próxima colisão. Log de crash
// mostrou isso acontecendo de verdade duas vezes na mesma sessão. Agora
// só apaga se o lock ainda for O MEU pid — o vencedor nunca perde a trava
// por causa da saída de outro processo.
function liberarTrava() {
  try {
    const pidNoArquivo = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    if (pidNoArquivo === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {}
}

adquirirTrava();
process.on('exit', liberarTrava);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

let crashesRapidosSeguidos = 0;

function iniciar() {
  const t0 = Date.now();
  const filho = spawn('node', ['server.js'], { cwd: DIR, stdio: 'inherit' });

  filho.on('exit', (code) => {
    const vidaMs = Date.now() - t0;
    if (vidaMs < JANELA_CRASH_RAPIDO_MS) {
      crashesRapidosSeguidos++;
      if (crashesRapidosSeguidos >= MAX_CRASHES_RAPIDOS) {
        const msg = `[${new Date().toISOString()}] Parando: ${MAX_CRASHES_RAPIDOS} crashes rápidos seguidos (última vida: ${vidaMs}ms, código ${code}).\n`;
        fs.appendFileSync(CRASH_LOG, msg);
        console.error(msg.trim());
        process.exit(1);
      }
    } else {
      crashesRapidosSeguidos = 0; // rodou tempo suficiente, reseta o contador
    }
    setTimeout(iniciar, PAUSA_ENTRE_REINICIOS_MS);
  });
}

iniciar();
