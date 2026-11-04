// Opt-in end-to-end Admin check against a local synthetic DT_HOME.
// NODE_PATH=<playwright modules> node dev/check-runtime-browser.js http://127.0.0.1:4497 work/runtime-proof
const { chromium } = require('playwright'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
async function run(base, out, { token = process.env.DT_BROWSER_TOKEN || '', screenshots = true } = {}) {
  const endpoint = new URL(base); if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw Error('Use a local synthetic fixture server');
  fs.mkdirSync(out, { recursive: true });
  const story = 'runtime-browser-' + Date.now().toString(36), headers = { 'content-type': 'application/json', 'x-dt-story': story, ...(token ? { authorization: 'Bearer ' + token } : {}) };
  const request = async (route, body) => { const response = await fetch(base + route, { headers, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) }), value = await response.json(); if (!response.ok) throw Error(value.error || 'HTTP ' + response.status); return value; };
  const call = async (name, args) => (await request('/api/tool/' + name, args)).result;
  const seed = await call('code_start', { title: 'Parallel browser verification', code: 'const r = await Promise.all([tools.find({q:"browser verification alpha"}), tools.find({q:"browser verification beta"})]); text({sources:r.length}); return {sources:r.length};' });
  let settled = await call('code_wait', { id: seed.id, waitMs: 3000 });
  for (let i = 0; i < 5 && !['done', 'failed', 'cancelled'].includes(settled.state); i++) settled = await call('code_wait', { id: seed.id, waitMs: 1000 });
  assert.equal(settled.state, 'done', JSON.stringify(settled));
  const browser = await chromium.launch({ headless: true }), errors = []; let checks = 1, activePage;
  try {
    const context = await browser.newContext({ ...(token ? { extraHTTPHeaders: { authorization: 'Bearer ' + token } } : {}) });
    await context.addInitScript(story => { try { sessionStorage.setItem('dt-admin-story', story); } catch {} }, story);
    const page = activePage = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/admin#runtime'); await page.locator('#rtUpdated').filter({ hasText: 'Updated' }).waitFor();
    assert.equal(await page.locator('#rtStory').inputValue(), story); checks++;
    await page.locator(`[data-rt-execution="${seed.executionId}"]`).click(); await page.locator('#rtExecution').filter({ hasText: seed.executionId }).waitFor();
    assert.match(await page.locator('#rtExecution').innerText(), /Chat \/ task/); await page.locator('#rtTraceLoad').click(); await page.locator('#rtTrace').filter({ hasText: /Trace/ }).waitFor(); checks += 2;
    await page.locator('#rtMetadataKind').selectOption('executions'); await page.locator('#rtMetadataRefresh').click();
    await page.locator(`[data-rt-record="${seed.executionId}"]`).click(); await page.locator('#rtMetadataNotes').fill('A useful result from the browser verification.'); await page.locator('#rtMetadataSave').click();
    await page.locator('#rtMetadataMessage').filter({ hasText: 'Notes saved.' }).waitFor(); checks++;
    // Another client changes the same record; the editor keeps the stale draft.
    const response = await request('/api/admin/metadata/executions/' + seed.executionId), current = response.record || response;
    await request('/api/admin/metadata/executions/' + seed.executionId, { expected_revision: current.revision, patch: { notes: 'Another client updated this record.' } });
    await page.locator('#rtMetadataNotes').fill('Keep this stale draft.'); await page.locator('#rtMetadataSave').click(); await page.locator('#rtMetadataMessage').filter({ hasText: 'draft is preserved' }).waitFor(); assert.equal(await page.locator('#rtMetadataNotes').inputValue(), 'Keep this stale draft.'); checks++;
    page.once('dialog', dialog => dialog.accept()); await page.locator('#rtMetadataReload').click(); await page.waitForFunction(() => document.getElementById('rtMetadataNotes').value === 'Another client updated this record.');
    await page.locator('#rtCodePanel').evaluate(element => element.open = true); await page.locator('#rtCodeTool').selectOption('code_start');
    await page.locator('#rtCodeArgs').fill(JSON.stringify({ code: 'text("Browser cell output"); return {count:7};', title: 'Browser scratchpad cell' })); await page.locator('#rtCodeRun').click();
    await page.locator('#rtCodeOutput').getByRole('button', { name: 'Prepare code_wait', exact: true }).waitFor(); await page.locator('#rtCodeOutput').getByRole('button', { name: 'Prepare code_wait', exact: true }).click();
    assert.ok(JSON.parse(await page.locator('#rtCodeArgs').inputValue()).id); await page.locator('#rtCodeRun').click();
    for (let i = 0; i < 5; i++) { await page.locator('#rtCodeRun:not([disabled])').waitFor(); if ((await page.locator('#rtCodeStatus').innerText()).startsWith('Cell done')) break; await page.locator('#rtCodeOutput').getByRole('button', { name: 'Prepare code_wait', exact: true }).click(); await page.locator('#rtCodeRun').click(); }
    await page.locator('#rtCodeStatus').filter({ hasText: 'Cell done' }).waitFor();
    await page.frameLocator('#rtCodeView').locator('#cc-result').waitFor({state:'attached'}); await page.frameLocator('#rtCodeView').locator('.inline-result > summary').waitFor(); assert.equal(await page.frameLocator('#rtCodeView').locator('.inline-result').evaluate(element => element.open), false); checks += 3;
    // Cancellation must settle the actual owned code execution.
    const cancellable = await call('code_start', { title: 'Cancel browser verification', code: 'await new Promise(resolve=>setTimeout(resolve,30000)); text("unexpected late output");' });
    await page.locator('#rtRefresh').click(); await page.locator(`[data-rt-execution="${cancellable.executionId}"]`).click(); await page.locator('#rtExecutionCancel').click();
    await page.locator('#rtExecution .state').filter({ hasText: /cancelled|cancelling|draining/ }).waitFor();
    const cancelled = await call('code_wait', { id: cancellable.id, waitMs: 3000 }); assert.ok(['cancelled', 'draining'].includes(cancelled.state), JSON.stringify(cancelled)); checks++;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 }); await page.locator('#rtRefresh').click();
      assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth + 1));
      await page.locator('#rtCodeView').scrollIntoViewIfNeeded();
      if (screenshots) await page.screenshot({ path: path.join(out, `runtime-${width}.png`), fullPage: true }); checks++;
    }
    // Returning to another story must remove all prior output and rows.
    await page.locator('#rtStory').fill(story + '-other'); await page.locator('#rtScopeApply').click();
    await page.locator('#rtMessage').filter({ hasText: 'Scope applied.' }).waitFor(); assert.equal(await page.locator(`[data-rt-execution="${seed.executionId}"]`).count(), 0); assert.equal(await page.locator('#rtCodeOutput').innerText(), ''); checks += 2;
    assert.deepEqual(errors, []); const report = { checks, errors, story, executionId: seed.executionId, screenshots: out };
    fs.rmSync(path.join(out, 'browser-failure.json'), { force: true });
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); return report;
  } catch (error) { if (activePage) fs.writeFileSync(path.join(out, 'browser-failure.json'), JSON.stringify({ checks, errors, message: error.message, text: (await activePage.locator('body').innerText()).slice(0, 30000) }, null, 2)); throw error; }
  finally { await browser.close(); }
}
module.exports = { run }; if (require.main === module) run(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
