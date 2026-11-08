// Opt-in browser verification of the isolated UX fixture. No real services are contacted.
// NODE_PATH=<playwright modules> PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chromium> \
//   node dev/check-ux-browser.js [work/ux-pass/demo.json] [work/ux-pass/screenshots]
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function run(manifestFile = 'work/ux-pass/demo.json', out = 'work/ux-pass/screenshots') {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const base = new URL(manifest.base).origin;
  const apiBase = new URL(manifest.apiBase || 'http://127.0.0.1:4065').origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || !['127.0.0.1', 'localhost'].includes(new URL(apiBase).hostname) || !path.basename(manifest.home || '').startsWith('dt-ux-review-')) throw Error('Use the isolated local UX fixture, never a real environment');
  fs.mkdirSync(out, { recursive: true });
  // Keep every prior capture before canonical names are reused by a confirmation run.
  const previousFiles = fs.readdirSync(out).filter(name => fs.statSync(path.join(out, name)).isFile());
  if (previousFiles.length) { const archive = path.join(out, 'archive-' + new Date().toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(archive); for (const name of previousFiles) fs.copyFileSync(path.join(out, name), path.join(archive, name)); }
  const report = { at: new Date().toISOString(), manifest: path.resolve(manifestFile), viewports: [1440, 390], checks: [], defects: [], pageErrors: [], captures: [], inventory: [], snapshotRequests: [], fixture: { syntheticInfrastructure: true, retainedSemanticProjection: true, joernParserExecuted: false } };
  let browser;
  const file = name => path.join(out, name.replace(/[^a-z0-9_.-]/gi, '-') + '.png');
  const request = async (name, args = {}) => {
    const r = await fetch(base + '/api/tool/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dt-story': 'default' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (!r.ok || j.error) throw Error(j.error || 'HTTP ' + r.status);
    return j.result;
  };
  const attempt = async (name, fn, page) => {
    try { const evidence = await fn(); report.checks.push({ name, ok: true, ...(evidence === undefined ? {} : { evidence }) }); }
    catch (e) {
      const defect = { name, message: e.message, url: page?.url() };
      if (page && !page.isClosed()) { try { const target = file('failure-' + name); await page.screenshot({ path: target, fullPage: false, timeout: 3000 }); defect.screenshot = target; } catch {} }
      report.defects.push(defect); report.checks.push({ name, ok: false }); console.error('FAIL ' + name + ': ' + e.message.split('\n')[0]);
    }
  };
  const capture = async (page, name, selector) => {
    if (selector && await page.locator(selector).count()) await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
    const target = file(name); await page.screenshot({ path: target, fullPage: false }); report.captures.push(target);
  };
  const expandPreview = async (page, selector) => {
    const disclosure = page.frameLocator(selector).locator('details.inline-result');
    // A result can set the same frame src twice while its saved record is read.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await disclosure.waitFor({ state: 'attached' }); await disclosure.evaluate(el => { el.open = true; }); return; }
      catch (error) { if (attempt || !/context was destroyed|navigation|detached/i.test(error.message)) throw error; }
    }
  };
  const attach = page => { page.setDefaultTimeout(4500); page.setDefaultNavigationTimeout(15000); page.on('pageerror', e => report.pageErrors.push({ url: page.url(), message: e.message })); page.on('dialog', d => d.accept()); };
  const ready = async (page, url) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.locator('body').waitFor(); await page.locator('details.inline-result').evaluateAll(es => es.forEach(e => e.open = true)); await page.waitForTimeout(120); };
  const metrics = async (page, name, width) => {
    const result = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, title: document.title, headings: [...document.querySelectorAll('h1,h2')].map(e => e.textContent.trim()).slice(0, 8) }));
    report.inventory.push({ name, width, ...result }); if (result.documentWidth > width + 2) report.defects.push({ name: 'overflow-' + name + '-' + width, message: 'Document width ' + result.documentWidth + ' exceeds viewport ' + width, url: page.url() });
  };
  try {
    const boot = await fetch(manifest.admin, { signal: AbortSignal.timeout(5000) }); if (!boot.ok) throw Error('BOOT BLOCKER: Admin returned ' + boot.status);
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => { try { sessionStorage.setItem('dt-admin-story', 'default'); } catch {} });
    const page = await context.newPage(); attach(page);
    const areas = ['workbench', 'index', 'explore', 'passports', 'map', 'context', 'scripts', 'sites', 'api', 'views', 'history', 'runtime', 'architecture', 'semantic', 'jobs', 'config', 'handbook'];
    await attempt('admin-boot', async () => { await ready(page, manifest.admin); await page.locator('#tabs [data-tab=map]').waitFor(); assert.deepEqual((await page.locator('#tabs [data-tab]').evaluateAll(elements => elements.map(e => e.dataset.tab))).sort(), [...areas].sort()); }, page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const area of areas) await attempt('admin-' + area + '-' + width, async () => {
        await page.locator('#tabs [data-tab=' + area + ']').click(); await page.locator('#tab-' + area).waitFor({ state: 'visible' }); await page.waitForTimeout(120); await metrics(page, 'admin-' + area, width); await capture(page, 'admin-' + area + '-' + width);
      }, page);
      for (const target of [{ name: 'passport', url: manifest.passport }, { name: 'map', url: manifest.map }, { name: 'dossier', url: manifest.dossier }, { name: 'api', url: base + '/api-client' }]) await attempt(target.name + '-' + width, async () => {
        await ready(page, target.url); if (target.name === 'passport') await page.locator('#sec-ports').waitFor(); if (target.name === 'map') await page.waitForFunction(() => window.dtMapCanvas); if (target.name === 'dossier') await page.waitForFunction(() => window.__architecture?.ready); if (target.name === 'api') { await page.locator('#apiBaseUrl').waitFor(); await page.locator('#apiRoutes button').first().waitFor(); } await metrics(page, target.name, width); await capture(page, target.name + '-' + width);
      }, page);
      await ready(page, manifest.admin);
    }
    // Snapshot pages run in a separate context. Any attempted write is intercepted and aborted.
    const snapshots = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await snapshots.route('**/*', route => { const r = route.request(); if (!['GET', 'HEAD'].includes(r.method())) { report.snapshotRequests.push({ method: r.method(), url: r.url() }); return route.abort(); } return route.continue(); });
    const samplePage = await snapshots.newPage(); attach(samplePage);
    for (const width of [1440, 390]) {
      await samplePage.setViewportSize({ width, height: 1000 });
      for (const sample of manifest.samples) await attempt('sample-' + sample.name + '-' + width, async () => {
        await ready(samplePage, sample.url); await metrics(samplePage, 'sample-' + sample.name, width); await capture(samplePage, 'sample-' + sample.name + '-' + width);
        if (sample.name === 'passport-ports') { assert.equal(await samplePage.locator('[data-p-save], [data-port-add], #portsGraphEdit').count(), 0, 'saved snapshot must not expose executable editor'); }
      }, samplePage);
    }
    for (const [name, selector] of [['knowledge-map', '#entity-list button'], ['reproduction', '#sources button'], ['collection-report', '#cr-cases button'], ['scenario-run', '#scenario-tabs button']]) await attempt('keyboard-focus-' + name, async () => {
      await ready(samplePage, manifest.samples.find(s => s.name === name).url); const first = samplePage.locator(selector).first(); await first.focus(); await samplePage.keyboard.press('Enter'); const active = await samplePage.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent.slice(0, 100) })); assert.notEqual(active.tag, 'BODY', 'selection must preserve keyboard focus'); return active;
    }, samplePage);
    await attempt('snapshots-no-write-attempts', () => assert.deepEqual(report.snapshotRequests, []), samplePage);
    await snapshots.close();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await attempt('admin-navigation-keyboard', async () => {
      await ready(page, manifest.admin); const nav = page.locator('#tabs [aria-selected=true]'); const before = await nav.getAttribute('data-tab'); await nav.focus(); await page.keyboard.press('ArrowDown'); const after = await page.locator('#tabs [aria-selected=true]').getAttribute('data-tab'); assert.notEqual(after, before); assert.equal(await page.locator('#tabs [aria-selected=true]').evaluate(e => e === document.activeElement), true); return { before, after };
    }, page);

    await attempt('context-navigation-and-native-run', async () => {
      await ready(page, manifest.admin + '#context'); await page.locator('#cxList .cx-item').first().click(); await page.locator('#cxWorking').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#cxWorkspaceModes [role=tab]').count(), 3);
      await page.locator('[data-workspace-mode=files]').click(); assert.equal(await page.locator('[data-context-panel=files]').isVisible(), true);
      await page.locator('[data-workspace-mode=tools]').click(); await page.locator('#cxTool').selectOption('show');
      const form = page.locator('#cxStructuredArgs'); const more = form.locator('details'); if (await more.count()) await more.evaluateAll(es => es.forEach(e => e.open = true));
      await form.getByLabel('view', { exact: true }).fill('json'); await form.getByLabel('data', { exact: true }).fill('browser evidence');
      await page.locator('#cxRun').click(); await page.locator('#cxRun:not([disabled])').waitFor(); await page.locator('#cxNativeResult').waitFor({ state: 'visible' });
      await expandPreview(page, '#cxNativeResult'); await page.frameLocator('#cxNativeResult').locator('#tree').waitFor(); assert.match(await page.frameLocator('#cxNativeResult').locator('body').innerText(), /browser evidence/); report.checks.push({ name: 'context-native-result-run', ok: true });
      await capture(page, 'context-tools-1440', '#cxWorkspaceModes'); await page.locator('[data-workspace-mode=results]').click(); await page.locator('#cxSavedResults button').first().click(); await page.locator('#cxSavedNative').waitFor({ state: 'visible' }); await expandPreview(page, '#cxSavedNative');
      await capture(page, 'context-results-1440', '#cxWorkspaceModes'); await page.setViewportSize({ width: 390, height: 1000 }); await capture(page, 'context-results-390', '#cxWorkspaceModes'); await page.locator('[data-workspace-mode=files]').click(); await capture(page, 'context-files-390', '#cxWorkspaceModes'); return { preview: await page.locator('#cxNativeResult').getAttribute('src'), saved: await page.locator('#cxSavedResults button').count() };
    }, page);

    // This check needs service/engine metadata; model previews intentionally omit it.
    const retained = await request('semantic_index', { versions: true, format: 'full' }); const analysis = retained.analyses.find(a => a.service === 'fixture-orders' || a.engine?.image === 'synthetic-ui-fixture');
    let semanticIdentity;
    await attempt('joern-hash-initial-scope', async () => {
      assert.ok(analysis, 'retained fixture-orders analysis required'); semanticIdentity = { service: 'fixture-orders', env: 'dev', repo: analysis.repo, revision: analysis.sha, analysis: analysis.id };
      await ready(page, manifest.admin + '#semantic?' + new URLSearchParams(semanticIdentity)); await page.locator('#smStructuredArgs input').first().waitFor();
      assert.equal(await page.locator('#smService').inputValue(), semanticIdentity.service); assert.equal(await page.locator('#smRepository').inputValue(), semanticIdentity.repo); const args = JSON.parse(await page.locator('#smArgs').inputValue()); assert.equal(args.service, semanticIdentity.service); assert.equal(args.repo, semanticIdentity.repo); assert.equal(args.analysis, semanticIdentity.analysis); return args;
    }, page);
    await attempt('joern-retained-symbol-pickers', async () => {
      assert.ok(semanticIdentity); await page.locator('[data-semantic-task=calls]').click(); await page.locator('#smSymbol-from').fill('create'); await page.locator('#smSymbols-from button').first().waitFor(); await page.locator('#smSymbols-from button').first().click(); await page.locator('#smSymbol-to').fill('save'); await page.locator('#smSymbols-to button').first().waitFor(); await page.locator('#smSymbols-to button').first().click(); const args = JSON.parse(await page.locator('#smArgs').inputValue()); assert.ok(args.from?.id && args.to?.id); await page.locator('#smRun').click(); await page.locator('#smRun:not([disabled])').waitFor(); assert.equal((await page.locator('#smAdminMessage').innerText()).includes('unknown'), false);
      await page.locator('#smAdminView').waitFor(); await page.frameLocator('#smAdminView').locator('.sm-path').first().waitFor(); for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await capture(page, 'joern-symbols-' + width, '#smSymbolPickers'); } return { from: args.from, to: args.to };
    }, page);

    // Port changes are revisioned declarations in the disposable fixture, with no service/network mutation.
    const passportResponse = await fetch(base + '/api/passport/checkout?t=' + new URL(manifest.passport).searchParams.get('t')); const passport = await passportResponse.json();
    const identity = { service: 'checkout', env: 'dev', repo: passport.repo.project + '/' + passport.repo.repo, revision: passport.repo.sha };
    let portRoot, manualId, detectedId;
    await attempt('ports-open-graph', async () => { await ready(page, manifest.admin + '#semantic?' + new URLSearchParams(identity)); await page.locator('[data-semantic-task=ports]').click(); await page.locator('#smGraphPorts .ports-graph [data-port-id]').first().waitFor(); portRoot = page.locator('#smGraphPorts'); return { nodes: await portRoot.locator('.ports-graph [data-port-id]').count() }; }, page);
    await attempt('ports-add-requires-reason', async () => { assert.ok(portRoot); await portRoot.locator('[data-port-add]').click(); await portRoot.locator('[data-p-boundary=path]').fill('/ux-browser/orders'); await portRoot.locator('[data-p-handler=signature]').fill('UxBrowser#orders()'); await portRoot.locator('[data-p-save]').click(); assert.match(await portRoot.locator('.ports-notice').innerText(), /reason/i); assert.equal(await portRoot.locator('[data-p-boundary=path]').inputValue(), '/ux-browser/orders'); }, page);
    await attempt('ports-add-manual', async () => { await portRoot.locator('[data-p-reason]').fill('Disposable UI browser test: declare a missing route'); await portRoot.locator('[data-p-save]').click(); await page.waitForFunction(() => document.querySelector('#smGraphPorts .ports-notice')?.textContent.startsWith('Saved.')); const current = await request('passport_adjustments', identity); manualId = current.ports.find(p => p.boundary?.path === '/ux-browser/orders')?.id; detectedId = current.detected.find(p => p.type === 'http-ingress')?.id; assert.ok(manualId); assert.ok(detectedId); return { manualId, detectedId }; }, page);
    await attempt('ports-correct-manual', async () => { assert.ok(manualId); await portRoot.locator('.ports-list [data-port-id="' + manualId + '"]').click(); await portRoot.locator('[data-p-boundary=path]').fill('/ux-browser/orders-v2'); await portRoot.locator('[data-p-reason]').fill('Disposable browser test: correct the route'); await portRoot.locator('[data-p-save]').click(); await page.waitForFunction(() => document.querySelector('#smGraphPorts .ports-notice')?.textContent.startsWith('Saved.')); assert.equal((await request('passport_adjustments', identity)).ports.find(p => p.id === manualId).boundary.path, '/ux-browser/orders-v2'); }, page);
    await attempt('ports-cas-preserves-draft', async () => { assert.ok(manualId); await portRoot.locator('.ports-list [data-port-id="' + manualId + '"]').click(); await portRoot.locator('[data-p-boundary=path]').fill('/ux-browser/stale-draft'); await portRoot.locator('[data-p-reason]').fill('Unsaved browser draft must survive revision conflict'); const current = await request('passport_adjustments', identity); await request('passport_adjust', { ...identity, expected_revision: current.revision, reason: 'Concurrent disposable browser update', operations: [{ action: 'correct', port_id: manualId, port: { type: 'http-ingress', handler: { signature: 'UxBrowser#orders()' }, boundary: { method: 'GET', path: '/ux-browser/concurrent' }, mappings: [] } }] }); await portRoot.locator('[data-p-save]').click(); await page.waitForFunction(() => /preserved/i.test(document.querySelector('#smGraphPorts .ports-notice')?.textContent)); assert.equal(await portRoot.locator('[data-p-boundary=path]').inputValue(), '/ux-browser/stale-draft'); assert.match(await portRoot.locator('.ports-notice').innerText(), /revision|changed|conflict/i); await capture(page, 'ports-conflict-390', '#smGraphPorts'); await portRoot.locator('[data-port-reload]').click(); await page.waitForFunction(() => /source gaps/.test(document.querySelector('#smGraphPorts .ports-notice')?.textContent)); }, page);
    await attempt('ports-hide-detected', async () => { assert.ok(detectedId); await portRoot.locator('.ports-list [data-port-id="' + detectedId + '"]').click(); await portRoot.locator('[data-p-reason]').fill('Disposable browser test: hide false detection'); await portRoot.locator('[data-p-hide]').click(); await page.waitForFunction(() => document.querySelector('#smGraphPorts .ports-notice')?.textContent.startsWith('Saved.')); assert.ok((await request('passport_adjustments', identity)).disabled.some(p => p.id === detectedId)); }, page);
    await attempt('ports-restore-detected', async () => { await portRoot.locator('[data-port-hidden]').check(); await portRoot.locator('.ports-list [data-port-id="' + detectedId + '"]').click(); assert.match(await portRoot.locator('[data-p-hide]').innerText(), /Restore/); await portRoot.locator('[data-p-reason]').fill('Disposable browser test: restore detected source'); await portRoot.locator('[data-p-hide]').click(); await page.waitForFunction(() => document.querySelector('#smGraphPorts .ports-notice')?.textContent.startsWith('Saved.')); assert.ok((await request('passport_adjustments', identity)).ports.some(p => p.id === detectedId)); }, page);
    await attempt('ports-remove-manual', async () => { assert.ok(manualId); await portRoot.locator('.ports-list [data-port-id="' + manualId + '"]').click(); assert.match(await portRoot.locator('[data-p-hide]').innerText(), /Delete/); await portRoot.locator('[data-p-reason]').fill('Disposable browser test cleanup: remove manual declaration'); await portRoot.locator('[data-p-hide]').click(); await page.waitForFunction(() => document.querySelector('#smGraphPorts .ports-notice')?.textContent.startsWith('Saved.')); assert.ok(!(await request('passport_adjustments', identity)).ports.some(p => p.id === manualId)); }, page);
    await attempt('ports-draft-navigation-and-captures', async () => { await portRoot.locator('.ports-list [data-port-id="' + detectedId + '"]').click(); await portRoot.locator('[data-p-handler=signature]').fill('Unsubmitted keyboard draft'); page.removeAllListeners('dialog'); page.once('dialog', d => d.dismiss()); await page.locator('#tabs [data-tab=explore]').click(); assert.equal(await portRoot.locator('[data-p-handler=signature]').inputValue(), 'Unsubmitted keyboard draft'); assert.equal(await page.locator('#tab-semantic').isVisible(), true); page.on('dialog', d => d.accept()); for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await capture(page, 'ports-graph-' + width, '#smGraphPorts'); } await portRoot.locator('[data-p-cancel]').click(); }, page);

    await attempt('authenticated-passport-graph', async () => { await ready(page, manifest.passport); await page.locator('#portsGraphEdit').waitFor({ state: 'visible' }); await page.locator('#portsGraphEdit').click(); await page.locator('#passportPorts .ports-graph [data-port-id]').first().waitFor(); await page.locator('#passportPorts .ports-list [data-port-id]').first().click(); assert.equal(await page.locator('#passportPorts [data-p-save]').isEnabled(), true); for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await capture(page, 'passport-editable-ports-' + width, '#passportPortWorkspace'); } }, page);
    await attempt('admin-api-open-request', async () => { await ready(page, manifest.admin + '#api'); await page.locator('#routes a').first().waitFor(); const link = page.locator('#routes a').first(); assert.match(await link.innerText(), /Open request/i); const href = await link.getAttribute('href'); assert.match(href, /api-client\?/); return { href }; }, page);
    await attempt('api-typed-parameters-auto-bearer-and-no-auth', async () => {
      const endpointBase = apiBase; await ready(page, base + '/api-client?' + new URLSearchParams({ method: 'GET', path: '/api/orders/{{orderId}}', base: endpointBase, service: 'fixture-orders' })); await page.locator('#apiParameterFields input').waitFor(); await page.locator('#apiParameterFields input').fill('42'); await page.waitForFunction(() => document.querySelector('#apiAuthProfile')?.value === 'demo'); assert.equal(await page.locator('#apiBaseUrl').inputValue(), endpointBase);
      const send = async () => { const response = page.waitForResponse(r => r.url().endsWith('/api/tool/api_request_replay')); await page.locator('#send').click(); const r = await (await response).json(); await page.locator('#send:not([disabled])').waitFor(); assert.ok(r.result, JSON.stringify(r)); return r.result; };
      const authed = await send(); assert.equal(authed.response.body.value.bearerApplied, true); assert.equal(authed.response.body.value.id, 42); assert.match(authed.response.body.value.path, /\/api\/orders\/42/); report.checks.push({ name: 'api-named-bearer-send', ok: true, evidence: { bearerApplied: authed.response.body.value.bearerApplied, path: authed.response.body.value.path } }); await page.locator('#apiAuthProfile').selectOption(''); const unauth = await send(); assert.equal(unauth.response.body.value.bearerApplied, false);
      for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.locator('#url').scrollIntoViewIfNeeded(); await capture(page, 'api-explorer-' + width); } return { bearerProfile: 'demo', authorized: true, noAuth: true, requestPath: unauth.response.body.value.path };
    }, page);
    await attempt('api-tabs-keyboard', async () => { const tabs = page.locator('[role=tablist][aria-label="Request editor"]'); await tabs.locator('[data-tab=body]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await tabs.locator('[aria-selected=true]').getAttribute('data-tab'), 'headers'); assert.equal(await tabs.locator('[data-tab=headers]').evaluate(e => e === document.activeElement), true); }, page);

    // Measure primary control contrast using the actual dark-theme computed colors.
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const target of [{ name: 'dark-admin', url: manifest.admin }, { name: 'dark-api', url: base + '/api-client' }, { name: 'dark-ports', url: manifest.passport }]) await attempt(target.name + '-contrast', async () => {
      await ready(page, target.url); if (target.name === 'dark-ports') { await page.locator('#portsGraphEdit').click(); await page.locator('#passportPorts [data-port-add]').click(); }
      const measured = await page.locator('button.primary,button.port-primary,button#send').evaluateAll(es => es.filter(e => e.getClientRects().length).map(e => { const c = getComputedStyle(e); const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); const lum = s => { const a = rgb(s); return a[0] * .2126 + a[1] * .7152 + a[2] * .0722; }; const a = lum(c.color), b = lum(c.backgroundColor); return { text: e.textContent.trim(), color: c.color, background: c.backgroundColor, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }; })); assert.ok(measured.length); for (const item of measured) assert.ok(item.ratio >= 4.5, item.text + ': ' + item.ratio.toFixed(2)); await capture(page, target.name + '-390'); return measured;
    }, page);
    await attempt('tab-panel-contracts', async () => {
      await ready(page, manifest.admin); for (const tab of await page.locator('#tabs [role=tab]').all()) { const target = await tab.getAttribute('aria-controls'); assert.ok(target); assert.equal(await page.locator('#' + target).getAttribute('role'), 'tabpanel'); assert.equal(await page.locator('#' + target).getAttribute('aria-labelledby'), await tab.getAttribute('id')); }
      await ready(page, base + '/api-client'); for (const tab of await page.locator('[role=tab]').all()) { const target = await tab.getAttribute('aria-controls'); assert.ok(target, 'API tab needs aria-controls'); assert.equal(await page.locator('#' + target).getAttribute('role'), 'tabpanel'); }
    }, page);
    await attempt('passport-port-deep-link', async () => { assert.ok(detectedId); const url = new URL(manifest.passport); url.searchParams.set('port', detectedId); await ready(page, url.href); const selected = page.locator('#passportPorts .ports-list [aria-pressed=true]'); await selected.waitFor(); assert.equal(await selected.getAttribute('data-port-id'), detectedId); }, page);
    await attempt('api-query-string-preserved', async () => { await ready(page, base + '/api-client?' + new URLSearchParams({ method: 'GET', url: apiBase + '/api/orders/42?expand=items&tenant=demo' })); await page.locator('#apiBaseUrl').waitFor(); assert.match(await page.locator('#url').inputValue(), /\?expand=items&tenant=demo$/); }, page);
    await context.close();
  } catch (e) { report.defects.push({ name: 'runner', message: e.message }); console.error(e.message); }
  finally {
    await browser?.close(); report.summary = { checks: report.checks.length, passed: report.checks.filter(c => c.ok).length, defects: report.defects.length, pageErrors: report.pageErrors.length, inventoryVisits: report.inventory.length, snapshotWriteAttempts: report.snapshotRequests.length };
    const prior = path.join(out, 'browser-report.json'); if (fs.existsSync(prior)) fs.copyFileSync(prior, path.join(out, 'browser-report.previous.json')); fs.writeFileSync(prior, JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(out, 'browser-report.md'), '# UX browser verification\n\n' + JSON.stringify(report.summary, null, 2) + '\n\n' + report.defects.map(d => '- **' + d.name + '**: ' + d.message.split('\n')[0] + (d.screenshot ? ' (' + d.screenshot + ')' : '')).join('\n') + '\n');
    console.log(JSON.stringify({ ...report.summary, report: path.join(out, 'browser-report.json') }));
  }
  return report;
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3]).then(r => { if (r.defects.length || r.pageErrors.length) process.exitCode = 1; }).catch(e => { console.error(e); process.exitCode = 1; });
