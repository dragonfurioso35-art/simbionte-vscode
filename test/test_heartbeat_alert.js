// Watchdog por estado (1.1.0): testa a função REAL (store.js:estadoDaSessao /
// resumoSessoes) e o estado-hook.js de ponta a ponta, num HOME temporário.
// Antes este teste copiava a lógica do extension.js — copiar lógica em teste
// deixa o teste verde enquanto o código de verdade muda.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { estadoDaSessao, resumoSessoes } = require('../store.js');

const min = m => m * 60 * 1000;
const LIMITE = min(15);
const AGORA = 10 * 60 * 60 * 1000;
const reg = (evento, atrasMin, extra) => ({ evento, ts: AGORA - min(atrasMin), ...extra });
const estado = r => (estadoDaSessao(r, AGORA, LIMITE) || {}).estado || null;

// Os três falsos alarmes da 1.0.x: silêncio longo, mas explicado.
assert.strictEqual(estado(reg('Stop', 40)), 'aguardando', 'Claude terminou e espera você: não é travamento');
assert.strictEqual(estado(reg('Notification', 40, { tipo: 'permission_prompt' })), 'aguardando');
assert.strictEqual(estado(reg('PreToolUse', 40, { comando: 'npm test' })), 'comando', 'build longo não é travamento');
assert.strictEqual(estadoDaSessao(reg('PreToolUse', 40, { comando: 'npm test' }), AGORA, LIMITE).comando, 'npm test');
assert.strictEqual(estado(reg('SessionEnd', 40)), 'encerrada');
// Único caso de alerta: estava trabalhando e parou de dar sinal.
assert.strictEqual(estado(reg('PostToolUse', 20)), 'travada');
assert.strictEqual(estado(reg('UserPromptSubmit', 20)), 'travada');
assert.strictEqual(estado(reg('PostToolUse', 5)), 'trabalhando');
// Limite configurável é respeitado.
assert.strictEqual(estadoDaSessao(reg('PostToolUse', 20), AGORA, min(30)).estado, 'trabalhando');
// Silêncio de horas: já alertou, sai do painel (não alarma no dia seguinte).
assert.strictEqual(estado(reg('PostToolUse', 60 * 4)), null);
assert.strictEqual(estadoDaSessao(null, AGORA, LIMITE), null, 'sem sessão = nunca travada');

// Várias sessões: a travada ganha; senão, a mais recente.
assert.strictEqual(resumoSessoes({ a: reg('Stop', 1), b: reg('PostToolUse', 20) }, AGORA, LIMITE).sessionId, 'b');
assert.strictEqual(resumoSessoes({ a: reg('Stop', 10), b: reg('PreToolUse', 2) }, AGORA, LIMITE).sessionId, 'b');
assert.strictEqual(resumoSessoes({}, AGORA, LIMITE), null);

// Ponta a ponta: o hook de verdade, alimentado por stdin, num HOME isolado.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'simbionte-hb-'));
const claude = path.join(home, '.claude');
fs.mkdirSync(claude, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'claude-hooks', 'estado-hook.js'), path.join(claude, 'estado-hook.js'));
fs.copyFileSync(path.join(__dirname, '..', 'store.js'), path.join(claude, 'simbionte-store.js'));
const rodar = payload => execFileSync(process.execPath, [path.join(claude, 'estado-hook.js')],
  { input: JSON.stringify(payload), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
const sessoes = () => JSON.parse(fs.readFileSync(path.join(claude, 'simbionte', '_heartbeat.json'), 'utf8')).sessoes;

assert.strictEqual(rodar({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'oi' }), '',
  'hook não pode escrever em stdout (vira contexto no UserPromptSubmit)');
rodar({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm run build' } });
assert.deepStrictEqual([sessoes().s1.evento, sessoes().s1.comando], ['PreToolUse', 'npm run build']);
rodar({ hook_event_name: 'PostToolUseFailure', session_id: 's1', tool_name: 'Bash' });
assert.strictEqual(sessoes().s1.evento, 'PostToolUse', 'falha de Bash fecha o comando');
rodar({ hook_event_name: 'Notification', session_id: 's2', notification_type: 'idle_prompt' });
assert.deepStrictEqual(Object.keys(sessoes()).sort(), ['s1', 's2'], 'uma sessão não apaga a outra');
assert.strictEqual(sessoes().s2.tipo, 'idle_prompt');
rodar({ hook_event_name: 'SessionEnd', session_id: 's1', reason: 'prompt_input_exit' });
assert.strictEqual(sessoes().s1.evento, 'SessionEnd');
fs.rmSync(home, { recursive: true, force: true });

console.log('OK: watchdog por estado (estadoDaSessao, resumoSessoes, estado-hook)');
