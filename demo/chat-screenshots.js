// Open WebUI with dt embeds: asks the demo questions in a real chat and screenshots the answers.
// Needs the demo (sh demo/start.sh), demo/mock-llm.js and an Open WebUI using both (see demo/README.md).
//   NODE_PATH=<dir with playwright> node demo/chat-screenshots.js [http://127.0.0.1:3480]
const path = require('path');
const { chromium } = require('playwright');

const WEBUI = process.argv[2] || 'http://127.0.0.1:3480';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const QUESTIONS = [
  ['chat-usage', 'Who writes sales.orders?'],
  ['chat-overview', 'How is demo doing? Anything broken?'],
  ['chat-logs', 'Any errors in the last hour?'],
];

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1500 }, deviceScaleFactor: 2, colorScheme: 'light' });
  for (const [name, q] of QUESTIONS) {
    const p = await ctx.newPage();
    await p.goto(WEBUI, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#chat-input', { timeout: 60000 });
    await p.waitForTimeout(1500);
    await p.keyboard.press('Escape').catch(() => {});
    const input = p.locator('#chat-input');
    await input.click();
    await input.fill(q);
    await p.keyboard.press('Enter');
    // the tool result is embedded as an iframe; wait for it to size itself, then for the answer
    await p.waitForSelector('iframe', { timeout: 60000 });
    await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.getBoundingClientRect().height > 200), null, { timeout: 60000 });
    await p.waitForTimeout(5000);
    await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    console.log(`${name}.png`);
    await p.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
