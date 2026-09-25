// Verificação visual do painel (não faz parte do .vsix) — carrega o
// build.html num browser real, injeta acquireVsCodeApi + dados de exemplo
// (via postMessage, mesmo contrato que extension.js usa) e screenshota em
// 3 larguras pra checar o comportamento de container query (sidebar
// primária estreita/larga, secondary side bar).
// Requer `npm install playwright` local (não é dependência do pacote,
// não entra no package.json -- só ferramenta de verificação).
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

// O painel mora sob vscode-extension/ desde a fusao das duas geracoes.
// Este caminho apontava pra '../media/build.html', que nunca existiu neste
// repo — o teste estava quebrado por caminho, alem de faltar playwright.
const HTML = path.join(__dirname, '..', 'vscode-extension', 'media', 'build.html');
const OUT = path.join(os.tmpdir(), 'simbionte-visual');

const AGORA = Date.now();
const PROJETOS = [
  {
    projectId: 'loja-web', projectName: 'loja-web',
    progress: { percent: 62, completed: 8, total: 13, activeLabel: 'biblioteca de técnicas de venda', updatedAt: AGORA - 20000, viaBash: false },
    activity: [{ file: 'biblioteca_vendas.py', ts: AGORA - 20000 }],
    lastTouch: AGORA - 20000, today: { date: new Date().toISOString().slice(0, 10), count: 16 },
  },
  {
    projectId: 'meu-monorepo', projectName: 'meu-monorepo',
    progress: { percent: 100, completed: 5, total: 5, activeLabel: null, updatedAt: AGORA - 8 * 60000, viaBash: true },
    activity: [{ file: 'estoque_ia_venda_diaria.py', ts: AGORA - 8 * 60000 }],
    lastTouch: AGORA - 8 * 60000, today: { date: new Date().toISOString().slice(0, 10), count: 4 },
  },
  {
    projectId: 'painel-admin', projectName: 'painel-admin',
    progress: null, activity: [{ file: 'main.gs', ts: AGORA - 40 * 60000 }],
    lastTouch: AGORA - 40 * 60000, today: null,
  },
];

(async () => {
  const browser = await chromium.launch();
  const larguras = [180, 260, 420];
  for (const largura of larguras) {
    const page = await browser.newPage({ viewport: { width: largura, height: 640 } });
    await page.addInitScript(() => {
      window.acquireVsCodeApi = () => ({ postMessage: () => {} });
    });
    await page.goto('file://' + HTML.replace(/\\/g, '/'));
    await page.evaluate((projetos) => {
      window.postMessage({ type: 'update', projetos, currentProject: 'loja-web', sessao: null }, '*');
    }, PROJETOS);
    await page.waitForTimeout(300);
    const fs = require('fs');
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `w${largura}.png`) });
    await page.close();
  }
  // pulso da sinapse: 1º update estabelece "visto", 2º update com timestamp
  // mais novo pra "painel-admin" precisa disparar o pulso satélite->núcleo.
  {
    const page = await browser.newPage({ viewport: { width: 300, height: 640 } });
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: () => {} }); });
    await page.goto('file://' + HTML.replace(/\\/g, '/'));
    await page.evaluate((projetos) => {
      window.postMessage({ type: 'update', projetos, currentProject: 'loja-web', sessao: null }, '*');
    }, PROJETOS);
    await page.waitForTimeout(200);
    const atualizados = PROJETOS.map(p => p.projectId === 'painel-admin'
      ? { ...p, lastTouch: Date.now(), activity: [{ file: 'novo.gs', ts: Date.now() }] }
      : p);
    await page.evaluate((projetos) => {
      window.postMessage({ type: 'update', projetos, currentProject: 'loja-web', sessao: null }, '*');
    }, atualizados);
    await page.waitForTimeout(350); // meio da animação de 900ms
    const fs = require('fs');
    fs.mkdirSync(OUT, { recursive: true });
    const temPulso = await page.evaluate(() => !!document.querySelector('.syn-pulso'));
    console.log('pulso presente a meio da animação:', temPulso);
    await page.screenshot({ path: path.join(OUT, 'pulso.png') });
    await page.close();
  }

  // estado travado (banner) + vazio, na largura média
  const page = await browser.newPage({ viewport: { width: 260, height: 640 } });
  await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: () => {} }); });
  await page.goto('file://' + HTML.replace(/\\/g, '/'));
  await page.evaluate(() => {
    window.postMessage({ type: 'update', projetos: [], currentProject: null, sessao: { estado: 'travada', limiteMin: 15, desde: 1200000 } }, '*');
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'vazio-travado.png') });
  await page.close();
  await browser.close();
  console.log('Screenshots em', OUT);
})();
