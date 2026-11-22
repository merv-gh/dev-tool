// Real browser verification against the real PG/Spring demo, including inline views.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function run(){
  const argv=process.argv.slice(2),extra={};for(const [flag,key]of [['--evaluation','evaluation'],['--mutation','mutation'],['--path-report','pathReport']]){const n=argv.indexOf(flag);if(n>=0){extra[key]=argv[n+1];argv.splice(n,2);}}const options={...require('./eval-person-mutations').options(argv),...extra};
  const d=process.env.DT_PERSON_DEMO_INFO?JSON.parse(fs.readFileSync(process.env.DT_PERSON_DEMO_INFO)):await require('../demo/person-investigation').start(options);
  const browser=await require('playwright').chromium.launch({headless:true}),dir=path.resolve('work/person-mutations/screenshots');fs.mkdirSync(dir,{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(d.url);await page.waitForFunction(()=>!document.getElementById('save').disabled&&document.getElementById('selection-results').textContent.includes('different'));
    const result=page.locator('#selection-results > details').first();assert.equal(await result.getAttribute('open')!==null,true);assert.match(await result.textContent(),/1011/);
    await result.locator('details').first().locator('summary').click();assert.match(await result.textContent(),/annulled/);
    await page.locator('#compare').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'person-mapping-before.png'),fullPage:true});
    const selections=JSON.parse(await page.locator('#selections').inputValue());assert.equal(selections.length,2);
    // Saving a human edit must preserve declarative selections, never erase them.
    await page.locator('#title').fill('Person selection · editable contract');await page.locator('#save').click();await page.waitForFunction(()=>!document.getElementById('save').disabled);assert.match(await page.locator('#notice').textContent(),/Saved person-name/);await page.reload();await page.waitForFunction(()=>!document.getElementById('save').disabled&&document.getElementById('name').value==='person-name');assert.deepEqual(JSON.parse(await page.locator('#selections').inputValue()),selections);
    await page.goto(d.before);await page.waitForFunction(()=>document.getElementById('md-selection-results').textContent.includes('different'));assert.match(await page.locator('#md-selection-results').textContent(),/1011/);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'person-mapping-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.setViewportSize({width:1440,height:1000});await page.goto(d.after);await page.waitForFunction(()=>document.getElementById('md-selection-results').textContent.includes('equal'));
    assert.equal(await page.locator('#md-selection-results > details').first().getAttribute('open'),null);await page.locator('#md-selection-results > details').first().locator('summary').first().click();await page.screenshot({path:path.join(dir,'person-mapping-after.png'),fullPage:true});
    assert.match(await page.locator('#md-selection-results').textContent(),/runtime|execution|Declared/);assert.deepEqual(errors,[]);
    if(d.paths){await page.goto(d.paths);await page.locator('#pt-result svg').first().waitFor();assert.match(await page.locator('body').textContent(),/before|after/i);await page.locator('#pt-context-title').click();await page.locator('#pt-context-kind').selectOption('changes');assert.match(await page.locator('#pt-context-body').textContent(),/annulled/);await page.screenshot({path:path.join(dir,'person-joern-paths.png'),fullPage:true});assert.deepEqual(errors,[]);}
    const report={passed:true,author:d.author,checked:d.checked,flows:['real-PG-Spring-before','exclusion-and-winner','human-save-retains-contract','reload','immutable-before-inline','repaired-after-inline','collapsed-passing-checks','mobile-no-overflow',...(d.paths?['actual-model-joern-before-after']:[])],screenshots:fs.readdirSync(dir)};fs.writeFileSync('work/person-mutations/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();await d.close?.();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
