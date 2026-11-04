// Opt-in browser integration. Requires playwright; use a running synthetic map-fixture server.
// node dev/check-map-browser.js http://127.0.0.1:4497 /tmp/map-evidence
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
async function run(base,out){
 const endpoint=new URL(base);if(!['127.0.0.1','localhost'].includes(endpoint.hostname))throw Error('Use a local synthetic fixture server');fs.mkdirSync(out,{recursive:true});
 const call=async(name,args)=>{const response=await fetch(base+'/api/tool/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)}),value=await response.json();if(!response.ok)throw Error(value.error);return value.result;};
 const map=await call('map',{env:'test'}),publicOrigin=new URL(map.view).origin,browser=await chromium.launch({headless:true}),errors=[];let checks=0;
 try{
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 const focused=await call('map',{env:'test',focus:'lib:LIB/common',include_libraries:true});
 await p.goto(new URL(new URL(focused.view).pathname,base).href+'?embed=1');await p.waitForFunction(()=>window.dtMapCanvas);await p.locator('[data-item-id="lib:LIB/common"]').waitFor();assert.equal(await p.locator('#map-libraries').isChecked(),true);checks+=2;
 for(const width of [1440,390]){
  await p.setViewportSize({width,height:1000});await p.goto(new URL(new URL(map.view).pathname,base).href+'?embed=1');await p.waitForFunction(()=>window.dtMapCanvas);await p.waitForTimeout(450);
  assert.ok(await p.locator('[data-item-kind=container]').count()>=3);assert.ok(await p.locator('body').evaluate(el=>el.scrollWidth<=innerWidth+1));
  assert.equal(await p.locator('#map-list').innerText().then(s=>s.includes('library')),false);await p.screenshot({path:path.join(out,`overview-${width}.png`),fullPage:true});checks+=3;
  await p.locator('[data-item-kind=container][data-item-id="prefix:service"]').click();await p.locator('#map-detail h2').filter({hasText:/^service$/}).waitFor();await p.locator('#map-neighbors').click();await p.locator('[data-item-kind=node][data-item-id="svc:service-002"]').waitFor();checks++;await p.locator('#map-overview').click();await p.locator('[data-item-kind=container][data-item-id="prefix:service"]').waitFor();
  await p.locator('#map-libraries').check();await p.locator('#map-search').fill('common');await p.locator('#map-list button[data-node="lib:LIB/common"]').waitFor();await p.locator('#map-libraries').uncheck();await p.locator('#map-search').fill('common ');await p.locator('#map-list button[data-node="lib:LIB/common"]').waitFor({state:'detached'});checks++;
  await p.locator('#map-search').fill('orders');await p.locator('#map-list button[data-node="svc:orders"]').waitFor();await p.locator('#map-list button[data-node="svc:orders"]').click();await p.locator('#map-neighbors').click();await p.waitForTimeout(450);
  assert.ok(await p.locator('[data-item-id="svc:orders"]').count());await p.locator('[data-item-id="svc:orders"]').click();await p.locator('#map-detail h2').filter({hasText:'orders'}).waitFor();assert.match(await p.locator('#map-detail').innerText(),/passport/);await p.screenshot({path:path.join(out,`service-${width}.png`),fullPage:true});checks+=2;
  await p.locator('#map-search').fill('sales.records_0');await p.locator('#map-list button[data-node="pg:db0:sales.records_0"]').waitFor();await p.locator('#map-list button[data-node="pg:db0:sales.records_0"]').click();await p.getByRole('button',{name:'pg_query',exact:false}).click();assert.match(await p.locator('#map-call-args').inputValue(),/SELECT/);checks++;
 }
 // A real opaque-origin iframe, matching Open WebUI's embed policy.
 await p.goto(base+'/health');await p.setContent(`<iframe id="webui" sandbox="allow-scripts allow-popups allow-downloads" src="${new URL(new URL(map.view).pathname,base).href}?embed=1" style="width:100%;height:900px"></iframe>`);await p.frameLocator('#webui').locator('.node,.container').first().waitFor();assert.ok(await p.frameLocator('#webui').locator('#map-counts').innerText());checks++;
 // In the trusted admin, selection prepares arguments without executing a live call.
 await p.setViewportSize({width:1440,height:1100});await p.goto(base+'/admin');await p.getByRole('button',{name:'Context & scratchpad',exact:true}).click();await p.locator('#cxNew').click();await p.locator('#cxTitle').fill('Map browser verification');await p.locator('#cxSaveMeta').click();await p.locator('#cxWorking').waitFor();await p.locator('#cxMapOpen').click();
 await p.locator('#cxMapFrame[src]').waitFor();assert.equal(new URL(await p.locator('#cxMapFrame').getAttribute('src')).origin,new URL(base).origin);checks++;
 const frame=p.frameLocator('#cxMapFrame');await frame.locator('.node,.container').first().waitFor();await frame.locator('#map-search').fill('sales.records_0');await frame.locator('#map-list button[data-node="pg:db0:sales.records_0"]').click();await p.getByRole('button',{name:'Prepare pg_query',exact:true}).waitFor();await p.getByRole('button',{name:'Prepare pg_query',exact:true}).click();assert.equal(await p.locator('#cxTool').inputValue(),'pg_query');const proposed=JSON.parse(await p.locator('#cxArgs').inputValue());assert.equal(proposed.db,'db0');assert.match(proposed.sql,/sales/);checks+=3;
 // Exercise the inspector itself with edited arguments and a native cached passport view.
 await frame.locator('#map-search').fill('orders');await frame.locator('#map-list button[data-node="svc:orders"]').click();await frame.getByRole('button',{name:'passport',exact:false}).first().click();
 const args=JSON.parse(await frame.locator('#map-call-args').inputValue());args.libraries=false;await frame.locator('#map-call-args').fill(JSON.stringify(args));await frame.locator('#map-call-run').click();
 await frame.locator('#map-call-status').filter({hasText:'Completed.'}).waitFor();await frame.locator('#map-tool-view:not([hidden])').waitFor();assert.match(await frame.locator('#map-tool-view').getAttribute('src'),/^\/passport\/orders\?t=/);await frame.frameLocator('#map-tool-view').locator('body').filter({hasText:'orders'}).waitFor();checks+=3;
 await p.screenshot({path:path.join(out,'scratchpad-tool.png'),fullPage:true});
 await frame.locator('#map-search').fill('shop-ui');await frame.locator('#map-list button[data-node="ui:shop-ui"]').click();await frame.getByRole('button',{name:'map_ui_preview',exact:false}).click();await frame.locator('#map-call-run').click();await frame.locator('#map-call-status').filter({hasText:'Completed.'}).waitFor({timeout:30000});await frame.frameLocator('#map-tool-view').getByRole('img').waitFor();assert.ok(await frame.frameLocator('#map-tool-view').getByRole('img').evaluate(img=>img.naturalWidth>0));checks++;
 assert.match(await frame.locator('#map-tool-view').getAttribute('src'),/^\/map-preview\//);checks++;
 await p.screenshot({path:path.join(out,'scratchpad-ui-preview.png'),fullPage:true});
 // Save an explicit binding through the editable inspector, and find it again.
 await frame.locator('#map-correct').evaluate(el=>el.open=true);await frame.locator('#map-correct-edit').click();
 await frame.locator('#map-call-args').fill(JSON.stringify({id:'browser-binding-'+Date.now(),evidence:'Synthetic browser test: SHOP/react-ui serves this test deployment',nodes:[{id:'uirepo:SHOP/react-ui',kind:'ui-repository',label:'React shop',repo:'SHOP/react-ui'}],edges:[{from:'ui:shop-ui',to:'uirepo:SHOP/react-ui',relation:'deployment-of'}]}));await frame.locator('#map-call-run').click();await frame.locator('#map-call-status').filter({hasText:'Completed.'}).waitFor();await frame.locator('#map-correct-list').click();await frame.locator('#map-call-run').click();await frame.locator('#map-edit-adjustments button').first().waitFor();checks+=2;
 assert.deepEqual(errors,[]);const report={checks,errors,publicOrigin,adminOrigin:new URL(base).origin,map:{nodes:map.nodes,edges:map.edges},screenshots:out};fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
 }finally{await browser.close();}
}
module.exports={run};if(require.main===module)run(process.argv[2],process.argv[3]).catch(e=>{console.error(e);process.exitCode=1;});
