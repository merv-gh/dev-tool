#!/usr/bin/env node
// Browser verification of the isolated proposal. No production app or model calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const base = new URL(process.argv[2] || 'http://127.0.0.1:4100');
if (base.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(base.hostname)) throw Error('Use the local read-only review server.');
const out = path.join(__dirname,'screenshots/interactive/proposal');
const work = path.resolve('work/admin-intent-review/browser');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(work,{recursive:true});
const report = {protocol:'dt.admin-proposal-browser/v1',baseline:'5a8ba08',scope:'Real browser gestures against the synthetic proposal; no production integration claim',scenarios:[],captures:[],errors:[],externalRequests:[],checks:[]};
let browser;
const safe = value => value.replace(/[^a-z0-9-]/gi,'-').toLowerCase();
async function capture(page,id,device){
  const file='screenshots/interactive/proposal/'+safe(id)+'-'+device+'.jpg';
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}));
  await page.screenshot({path:path.join(__dirname,file),type:'jpeg',quality:82,fullPage:false});
  report.captures.push({id,label:'Verified proposal · '+id.replaceAll('-',' ')+' · '+device,file,category:'proposed-interactive',capture:'viewport',...metrics});
  assert.equal(metrics.scrollWidth,metrics.width,'Page overflow: '+id);
}
async function active(page,scene){await page.getByRole('tab',{name:scene,exact:true}).click();await page.locator('[role=tab][aria-selected=true]').filter({hasText:scene}).waitFor();}
async function chooseTask(page,id){
  const picker=page.locator('#taskPicker');
  if(await picker.isVisible()&&await picker.getAttribute('aria-expanded')!=='true')await picker.click();
  await page.locator('[data-task="'+id+'"]').click();
  await page.locator('.breadcrumbs').filter({hasText:id}).waitFor();
}
async function runComparison(page){await page.locator('#replay').click();await page.locator('#cancelRun').waitFor();await page.waitForFunction(()=>!document.getElementById('replay')?.disabled);}
async function check(name,fn){await fn();report.checks.push({name,passed:true});}
async function scenario(name,device,fn,options={}){
  const started=Date.now(),context=await browser.newContext({viewport:device==='phone'?{width:390,height:844}:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce',...options});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({scenario:name,message:e.message}));
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base.origin||['blob:','data:'].includes(url.protocol))return route.continue();report.externalRequests.push({scenario:name,url:url.origin+url.pathname});return route.abort();});
  try{await fn(page,context);report.scenarios.push({name,device,passed:true,durationMs:Date.now()-started});}
  catch(e){report.scenarios.push({name,device,passed:false,error:e.message,durationMs:Date.now()-started});try{await capture(page,'failure-'+name,device);}catch{};fs.writeFileSync(path.join(work,safe(name)+'-'+device+'.txt'),e.stack||e.message);}
  finally{await context.close();}
}
async function personJourney(page,context,device){
  await page.goto(new URL('/demo.html?task=PERS-218&scene=start',base).href);
  await page.getByRole('button',{name:'Investigate a wrong API response',exact:false}).click();
  await check(device+': initial transport success is separate from failed contract',async()=>{
    assert.match(await page.locator('#taskPanel').innerText(),/HTTP succeeded.*assertion failed/s);
    assert.match(await page.locator('.compare-fields').innerText(),/Sidorova.*Petrova/s);
  });
  await capture(page,'person-original-failure',device);
  await check(device+': cancellation preserves retained observation',async()=>{
    await page.locator('#replay').click();await page.locator('#cancelRun').click();
    assert.equal(await page.locator('#replay').isEnabled(),true);
    assert.match(await page.locator('#taskPanel').innerText(),/Sidorova/);
    assert.match(await page.locator('#taskPanel').innerText(),/Local run cancelled/);
    assert.doesNotMatch(await page.locator('#taskPanel').innerText(),/interrupted by reload/);
  });
  await capture(page,'comparison-cancelled',device);
  await check(device+': reload interruption is distinct from user cancellation',async()=>{
    await page.reload();
    await page.getByText('Local run cancelled.',{exact:false}).waitFor();
    await page.locator('#replay').click();await page.locator('#cancelRun').waitFor();await page.reload();
    await page.getByText('Local run interrupted by reload.',{exact:false}).waitFor();
    assert.equal(await page.locator('#replay').isEnabled(),true);
    assert.match(await page.locator('#taskPanel').innerText(),/Sidorova/);
  });
  await capture(page,'comparison-interrupted-by-reload',device);
  for(const [value,expected] of [['error','Simulated connection failure'],['partial','Inconclusive'],['empty','Whole-name contract passes']]){
    await page.locator('#scenario').selectOption(value);
    assert.match(await page.locator('#taskPanel').innerText(),/Comparison prepared/);
    await runComparison(page);
    await page.getByText(expected,{exact:false}).first().waitFor();
    if(value==='error')assert.equal(await page.locator('.result-summary').count(),0);
    if(value==='partial')assert.equal(await page.locator('.data-table tbody tr').count(),1);
    if(value==='empty')assert.match(await page.locator('.data-table').innerText(),/No documents/);
    report.checks.push({name:device+': '+value+' observation and verdict',passed:true});
    await capture(page,'comparison-'+value,device);
  }
  await page.locator('#scenario').selectOption('ready');await runComparison(page);
  await active(page,'Source & paths');
  const source=[];
  for(const id of ['entry','query','selection','mapping','exit']){await page.locator('[data-node="'+id+'"]').click();source.push(await page.locator('#taskPanel .code-block').first().innerText());}
  assert.equal(new Set(source).size,5);report.checks.push({name:device+': every source node has its own evidence',passed:true});
  await page.locator('[data-node="selection"]').click();
  await page.locator('#reason').fill('PERS-218: preserve this edited reason across conflict and reload.');
  await page.locator('#correctionScope').selectOption('review');
  await page.locator('#guard').fill('unsupported guard');
  await page.locator('#simulateConflict').click();
  assert.equal(await page.locator('#guard').inputValue(),'unsupported guard');
  assert.match(await page.locator('#reason').inputValue(),/preserve this edited reason/);
  await capture(page,'correction-conflict-preserves-draft',device);
  await page.locator('#rebaseDraft').click();await page.locator('#saveCorrection').click();
  await page.getByRole('status').filter({hasText:'Arbitrary guards'}).waitFor();
  await page.locator('#guard').fill('active & valid & !annulled');await page.locator('#saveCorrection').click();
  await page.getByText('Saved local review proposal.',{exact:false}).waitFor();
  assert.match(await page.locator('#taskPanel .code-block').first().innerText(),/Missing: exclude annulled/);
  report.checks.push({name:device+': explicit revision recovery, guard validation and immutable original',passed:true});
  await page.reload();assert.match(await page.locator('#reason').inputValue(),/preserve this edited reason/);
  assert.equal(await page.locator('#correctionScope').inputValue(),'review');
  await capture(page,'correction-saved-not-applied',device);
  await active(page,'Request & data');assert.match(await page.locator('.compare-fields').innerText(),/Sidorova/);
  await page.locator('#replayPolicy').selectOption('proposal');await runComparison(page);
  await page.getByText('Whole-name contract passes',{exact:false}).waitFor();
  await capture(page,'explicit-corrected-comparison',device);
  await active(page,'Checks');assert.equal(await page.locator('.check-row .pass').count(),0);
  await page.locator('#checkPolicy').selectOption('proposal');await page.locator('#runChecks').click();
  await page.waitForFunction(()=>!document.getElementById('runChecks')?.disabled);
  assert.equal(await page.locator('.check-row .fail').count(),0);
  assert.match(await page.locator('#taskPanel').innerText(),/Real integration.*Not run|Not run.*Real integration/s);
  await page.locator('#prepareTests').click();await page.locator('#testPlan').waitFor({state:'visible'});
  report.checks.push({name:device+': offline check success keeps actual integration unrun',passed:true});
  await capture(page,'offline-passed-real-integration-unrun',device);
  await active(page,'Handoff');
  await page.locator('#shareName').fill('PERS-218/repro-reviewed');await page.locator('#handoffNote').fill('Person task only: compare the annulled row and preserve exact observation.');
  await page.locator('#recipePolicy').selectOption('proposal');
  const downloadEvent=page.waitForEvent('download');await page.locator('#exportRecipe').click();const download=await downloadEvent;
  const recipeFile=path.join(work,'person-'+device+'.json');await download.saveAs(recipeFile);
  const recipe=JSON.parse(fs.readFileSync(recipeFile,'utf8'));assert.equal(recipe.taskId,'PERS-218');assert.equal(recipe.name,'PERS-218/repro-reviewed');
  const replay=spawnSync(process.execPath,[path.join(__dirname,'replay.js'),recipeFile],{encoding:'utf8'});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).passed,true);
  await page.locator('#shareLink').click();const reviewUrl=await page.locator('#reviewUrl').inputValue();
  const review=await context.newPage();await review.goto(reviewUrl);assert.equal(await review.locator('#handoffNote').isDisabled(),true);
  await review.getByRole('tab',{name:'Source & paths',exact:true}).click();assert.equal(await review.locator('#saveCorrection').isDisabled(),true);
  await review.getByRole('tab',{name:'Request & data',exact:true}).click();assert.equal(await review.locator('#replay').isDisabled(),true);
  await capture(review,'share-snapshot-readonly',device);await review.close();
  report.checks.push({name:device+': downloaded recipe replays and shared snapshot cannot execute',passed:true});
  await chooseTask(page,'SHOP-142');await active(page,'Checkpoint');
  await page.locator('#showNotes').click();await page.getByText('Gap: real unavailable source',{exact:false}).waitFor();
  await page.locator('#retryDocs').click();await page.locator('#confirmDocsRetry').waitFor();
  await capture(page,'overnight-retry-prepared',device);
  await page.locator('#confirmDocsRetry').click();await page.locator('#pauseTask').click();
  await page.getByText('Simulation paused',{exact:false}).first().waitFor();
  await capture(page,'overnight-paused-by-user',device);
  await page.locator('#pauseTask').click();await page.waitForFunction(()=>document.getElementById('confirmDocsRetry')===null&&document.querySelector('.task-top')?.textContent.includes('Simulation complete'));
  assert.match(await page.locator('#taskPanel').innerText(),/real source remains uncollected/);
  await page.locator('#stopWorker').click();await capture(page,'overnight-stopped-retains-results',device);
  await active(page,'Source & paths');assert.match(await page.locator('#taskPanel').innerText(),/RefundController/);assert.doesNotMatch(await page.locator('#taskPanel').innerText(),/PersonController/);
  await active(page,'Handoff');await page.locator('#handoffNote').fill('Checkout task only. Missing documentation remains unresolved.');
  const checkoutEvent=page.waitForEvent('download');await page.locator('#exportRecipe').click();const checkout=await checkoutEvent,checkoutFile=path.join(work,'checkout-'+device+'.json');await checkout.saveAs(checkoutFile);
  const checkpoint=JSON.parse(fs.readFileSync(checkoutFile,'utf8'));assert.equal(checkpoint.taskId,'SHOP-142');assert.equal(checkpoint.kind,'checkout-checkpoint');assert.equal(checkpoint.params,undefined);
  const checkpointReplay=spawnSync(process.execPath,[path.join(__dirname,'replay.js'),checkoutFile],{encoding:'utf8'});assert.equal(checkpointReplay.status,0,checkpointReplay.stderr);
  await capture(page,'checkout-handoff-isolated',device);
  await chooseTask(page,'PERS-218');await active(page,'Handoff');assert.equal(await page.locator('#shareName').inputValue(),'PERS-218/repro-reviewed');assert.match(await page.locator('#handoffNote').inputValue(),/Person task only/);
  await page.reload();assert.match(await page.locator('#handoffNote').inputValue(),/Person task only/);
  report.checks.push({name:device+': overnight recovery and exports retain task isolation across reload',passed:true});
  await page.getByRole('button',{name:'Operations',exact:true}).click();await page.getByRole('button',{name:'Configuration and indices',exact:false}).click();
  await page.locator('#configDraft').fill('{ "draft": "must survive re-selection" }');await page.locator('#sameSection').click();assert.match(await page.locator('#configDraft').inputValue(),/must survive/);
  await page.reload();assert.match(await page.locator('#configDraft').inputValue(),/must survive/);
  report.checks.push({name:device+': proposed configuration draft survives same-section and reload',passed:true});
}
async function galleryJourney(page){
  await page.goto(base.href);await page.locator('#galleryItems .capture').first().waitFor();
  const count=await page.locator('#galleryItems .capture').count();assert.ok(count>=136);
  await page.locator('[data-category="renderer"]').click();assert.equal(await page.locator('#galleryItems .capture').count(),37);
  await page.locator('#filter').fill('semantic-path');assert.equal(await page.locator('#galleryItems .capture').count(),1);
  await page.locator('#filter').fill('no-matching-fixture');assert.match(await page.locator('#galleryCount').innerText(),/0 captures shown/);
  await page.getByRole('link',{name:'State coverage',exact:true}).click();
  await page.locator('#stateRows tr').first().waitFor();assert.equal(await page.locator('#stateRows tr').count(),239);
  await page.locator('#stateFilter').fill('conflict');assert.ok(await page.locator('#stateRows tr').count()>0);
  await page.locator('#stateStatus').selectOption('uncaptured');assert.ok(await page.locator('#stateRows tr').count()>0);
  report.checks.push({name:'gallery and ledger filter actual captures and missing evidence',passed:true});
  await capture(page,'state-ledger-filter','desktop');
}
async function keyboardAndTheme(page,device){
  await page.goto(new URL('/demo.html?task=PERS-218&scene=findings',base).href);
  await page.getByRole('tab',{name:'Findings',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(),'Request & data');
  assert.equal(await page.locator('[role=tab][aria-selected=true]').evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('End');assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(),'Handoff');
  const unlabeled=await page.locator('input,select,textarea').evaluateAll(es=>es.filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>e.id));assert.deepEqual(unlabeled,[]);
  await page.getByRole('tab',{name:'Source & paths',exact:true}).click();
  await capture(page,'dark-source-focus',device);
  if(device==='phone'){await page.locator('#taskPicker').click();assert.equal(await page.locator('#taskSearch').isVisible(),true);await capture(page,'phone-task-picker-expanded',device);}
  report.checks.push({name:device+': keyboard tabs, explicit field names and dark/reduced-motion layout',passed:true});
}
async function main(){
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  try{
    for(const device of ['desktop','phone'])await scenario('person-and-overnight-journeys',device,(p,c)=>personJourney(p,c,device));
    await scenario('gallery-and-state-ledger','desktop',galleryJourney);
    for(const device of ['desktop','phone'])await scenario('keyboard-dark-reduced-motion',device,p=>keyboardAndTheme(p,device),{colorScheme:'dark'});
  }finally{await browser.close();}
  report.passed=report.scenarios.every(s=>s.passed)&&report.errors.length===0&&report.externalRequests.length===0;
  fs.writeFileSync(path.join(__dirname,'prototype-browser-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,scenarios:report.scenarios,checks:report.checks.length,captures:report.captures.length,pageErrors:report.errors,externalRequests:report.externalRequests},null,2));
  if(!report.passed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
