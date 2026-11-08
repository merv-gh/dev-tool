// Display retained real-Joern results through Open WebUI's actual inline transport.
// Does not parse, rerun a CPG query, call a model or edit a service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function run(home,output){
 process.env.DT_HOME=path.resolve(home);process.env.DT_LOG='quiet';process.env.DT_NO_DOCTOR='1';
 for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_WORK_DIR'])delete process.env[key];
 const report=JSON.parse(fs.readFileSync(path.join(home,'branch-flow-live-report.json'))),cfgFile=path.join(home,'config.json'),original=fs.readFileSync(cfgFile),cfg=JSON.parse(original);
 const server=require('../server').start({port:0,host:'127.0.0.1'});await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;cfg.server={...cfg.server,publicUrl:base};fs.writeFileSync(cfgFile,JSON.stringify(cfg));require('../lib/config').reload();
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true}),errors=[],checks=[];fs.mkdirSync(output,{recursive:true});
 try{
  const response=await fetch(base+'/oapi/semantic_query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'compare',job:report.fixed.job,max_output_bytes:4096})});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-disposition'),'inline');const body=await response.json();assert.equal(body[0],'embed');assert.equal(body[1].format,'compact');assert.ok(Buffer.byteLength(JSON.stringify(body[1]))<=4096);checks.push('Bounded model JSON and native embed headers');
  const url=new URL(response.headers.get('location'));assert.equal(url.origin,base);const html=await fetch(url);assert.match(html.headers.get('content-security-policy'),/sandbox/);checks.push('Retained full evidence served in sandbox');
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(url.toString());await page.locator('.inline-result').evaluate(el=>el.open=true);await page.locator('#sm-comparison').waitFor();
   assert.match(await page.locator('#sm-comparison').innerText(),/Before[\s\S]*After/);assert.match(await page.locator('#sm-results').innerText(),/gross[\s\S]*payable/);assert.match(await page.locator('#sm-meaning').innerText(),/does not prove/);assert.match(await page.locator('#sm-results').innerText(),/predicate operands/);
   assert.equal(await page.locator('#sm-gaps').evaluate(el=>el.open),false);checks.push(width+': before/after snapshots, expressions and conservative caveat');
   await page.locator('#sm-tree-items details details').first().evaluate(el=>el.open=true);await page.locator('[data-source]').first().click();assert.equal(await page.locator('.sm-node.on').count(),1);checks.push(width+': source hierarchy navigates to evidence');
   assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1));checks.push(width+': no horizontal overflow');
   const full=await page.getByRole('link',{name:'Open full view',exact:true}).getAttribute('href');await page.goto(full);assert.equal(await page.locator('.inline-result').count(),0);assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1));checks.push(width+': full view opens retained evidence without chat clipping');
   await page.screenshot({path:path.join(output,'joern-branch-comparison-'+width+'.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);const result={checks,passed:checks.length,errors,retainedRealJoern:true,parsesStarted:0,cpgQueriesRerun:false,modelCalls:0};fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));return result;
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(cfgFile,original);await require('../lib/isolate').stop();await require('../lib/state-store').close();}
}
module.exports={run};if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{console.error(e);process.exitCode=1;});
