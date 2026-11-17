// Real offline browser exercise with synthetic local Git data. No live integrations or builds.
// node demo/check-editor.js [absolute screenshot directory]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
async function run({ output = path.join(os.tmpdir(), 'dt-editor-review') } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-editor-browser-'));
  process.env.DT_HOME = home; process.env.DT_GIT_DIR = path.join(home, 'git'); process.env.DT_NO_DOCTOR = '1'; process.env.DT_LOG = 'quiet'; process.env.DT_RATE_PER_SEC = '0';
  for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_TOOLS']) delete process.env[key];
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
  const demo = await require('./seed-editor').seed();
  const { chromium } = require('playwright'), browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
  const server = require('../server').start({ port: 0, host: '127.0.0.1' }); await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port, checks = [], errors = [], failed = [], requests = [];
  fs.mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message)); page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText })); page.on('request', request => requests.push(request.url()));
    await page.goto(url + demo.editor); await page.locator('.CodeMirror').waitFor({ state: 'visible' }); await page.waitForFunction(() => document.getElementById('dirty').textContent === 'Saved');
    checks.push('desktop: locally bundled source editor loads Unicode Java file');
    assert.equal(await page.locator('#encoding').textContent(), 'UTF-8 · LF');
    await page.locator('.CodeMirror').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n// Проверка редактора\n'); await page.locator('#save').click(); await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved '));
    const E = require('../lib/workspace-editor'), javaPath = 'payments-core/src/main/java/demo/Платёж.java';
    const file = E.read(demo.workspace, javaPath); assert.match(file.content, /Проверка редактора/); checks.push('desktop: real Unicode edit saved through revision-CAS tool');
    E.save(demo.workspace, javaPath, file.content + '// external change\n', file.revision);
    await page.locator('.CodeMirror').click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('// browser draft\n'); await page.locator('#save').click(); await page.waitForFunction(() => document.getElementById('status').textContent.includes('draft is preserved'));
    assert.ok(await page.locator('.CodeMirror').evaluate(el => el.CodeMirror.getValue().includes('browser draft'))); checks.push('desktop: external edit blocks save and browser draft stays intact');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#reload').click(); await page.waitForFunction(() => document.getElementById('dirty').textContent === 'Saved');
    await page.locator('#command').fill('git status'); await page.locator('#run').click(); await page.waitForFunction(() => document.getElementById('output').textContent.includes('[exit 0]'));
    assert.match(await page.locator('#output').textContent(), /Платёж|\\[0-9]{3}/); checks.push('desktop: terminal runs real git inspection and returns exit evidence');
    await page.locator('#dependencies').click(); await page.locator('#inventoryRevision').selectOption(demo.revision); await page.getByRole('button', { name: /^com\.fasterxml\.jackson\.core:jackson-databind/ }).first().click(); await page.locator('#newVersion').fill('2.17.2'); await page.locator('#planBump').click(); await page.waitForFunction(() => !document.getElementById('applyBump').disabled);
    assert.match(await page.locator('#plan').textContent(), /jackson-annotations/); await page.locator('#applyBump').click(); await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Applied changes to 1 file'));
    assert.match(E.read(demo.workspace, 'gradle/libs.versions.toml').content, /jackson = "2.17.2"/); checks.push('desktop: shared catalog upgrade previews affected consumers and applies guarded workspace change');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'editor-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#closeInventory').click(); await page.locator('#toggleExplorer').click(); await page.locator('#command').fill('git diff --stat'); await page.locator('#run').click(); await page.waitForFunction(() => document.getElementById('output').textContent.includes('$ git diff --stat') && document.getElementById('output').textContent.includes('[exit 0]'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); checks.push('mobile 390px: source, toolbar and terminal usable without horizontal page overflow');
    await page.screenshot({ path: path.join(output, 'editor-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.ok(requests.every(request => request.startsWith(url))); checks.push('all editor assets/tool calls same origin; no page errors or failed requests');
    const result = { synthetic: true, checks, screenshots: ['editor-desktop.png', 'editor-mobile.png'].map(name => path.join(output, name)), errors, failed, requests: requests.length };
    fs.writeFileSync(path.join(output, 'editor-checks.json'), JSON.stringify(result, null, 2)); return result;
  } finally {
    await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true });
  }
}
if (require.main === module) run({ output: process.argv[2] ? path.resolve(process.argv[2]) : undefined }).then(result => { console.log(JSON.stringify(result, null, 2)); process.exit(0); }, error => { console.error(error); process.exit(1); });
module.exports = { run };
