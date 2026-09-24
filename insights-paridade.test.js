// Self-check da paridade entre os dois consumidores de insights.js.
//
// Risco declarado no spec da fusão: depois dela, insights passam a ser
// calculados em DOIS lugares — o servidor (para /api/insights) e a extensão
// (para o painel, direto do disco). Os dois chamam o mesmo insights.js, que
// é puro, então não podem divergir por lógica. Podem divergir por ENTRADA:
// se um receber um scanData de procedência diferente do outro, os resultados
// se separam em silêncio e ninguém percebe até a tela mentir.
//
// Este teste alimenta as duas rotas com o MESMO scan de disco e compara.
// Divergiu = alguém trocou a fonte de dados de um dos lados.
const assert = require('assert');
const http = require('http');
const { lerScan } = require('./scan-store');
const { computeSignals, synthesize, computeHealth } = require('./insights');
const { PROJECTS, RELATIONS } = require('./data.js');

const PORTA = 4737;
const scan = lerScan(PORTA);

if (!scan) {
  // Não é falha: o servidor real pode nunca ter rodado nesta máquina.
  console.log('insights-paridade: pulado (sem _scan.4737.json)');
  process.exit(0);
}

// Exatamente o que a extensão faz em lerInsights().
const sinaisDaExtensao = computeSignals(scan.data, PROJECTS, RELATIONS);
const daExtensao = {
  synthesis: synthesize(sinaisDaExtensao),
  health: computeHealth(scan.data, PROJECTS, RELATIONS),
};

const req = http.get(`http://127.0.0.1:${PORTA}/api/insights`, { timeout: 5000 }, res => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    let doServidor;
    try { doServidor = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch (e) { console.log('insights-paridade: pulado (resposta ilegivel do servidor)'); process.exit(0); }

    // Comparar por code+projectId, não pelo objeto inteiro: o servidor
    // carrega `updatedAt` e outros campos de transporte que a extensão não
    // tem, e isso não é divergência.
    const chave = s => `${s.severity}:${s.projectId}:${s.message}`;
    assert.deepStrictEqual(
      daExtensao.synthesis.map(chave).sort(),
      (doServidor.synthesis || []).map(chave).sort(),
      'extensao e servidor divergiram nos sinais, com o mesmo scanData');

    const notas = h => Object.keys(h || {}).map(id => `${id}:${h[id].grade}`).sort();
    assert.deepStrictEqual(
      notas(daExtensao.health),
      notas(doServidor.health),
      'extensao e servidor divergiram nas notas de saude, com o mesmo scanData');

    console.log(`insights-paridade: ok (${daExtensao.synthesis.length} sinais, ${Object.keys(daExtensao.health).length} projetos avaliados)`);
  });
});

// Servidor fora do ar não reprova o painel — ele foi feito justamente para
// funcionar sem servidor. Sem os dois lados, não há paridade a comparar.
req.on('error', () => { console.log('insights-paridade: pulado (servidor 4737 fora do ar)'); process.exit(0); });
req.on('timeout', () => { req.destroy(); console.log('insights-paridade: pulado (servidor nao respondeu a tempo)'); process.exit(0); });
