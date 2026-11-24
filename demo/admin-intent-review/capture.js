#!/usr/bin/env node
// Optional reproducible local capture batch. Does not contact real integrations.
// Explicitly invoked by the reviewer; never runs from the prototype browser.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
async function main() {
  const manifest = JSON.parse(fs.readFileSync(process.argv[2] || 'work/admin-intent-review/fixture.json', 'utf8'));
  const base = new URL(manifest.base);
  if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw Error('Use a disposable localhost fixture.');
  const output = path.resolve(process.argv[3] || 'work/admin-intent-review/reproduced');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const evidence = [];
  try {
    for (const size of [{width:1440,height:1000},{width:390,height:844}]) {
      const context = await browser.newContext({ viewport:size, reducedMotion:'reduce' });
      const page = await context.newPage();
      await page.goto(base + 'admin');
      await page.locator('#nav-workbench').waitFor();
      const areas = await page.locator('#tabs [data-tab]').evaluateAll(es=>es.map(e=>({id:e.dataset.tab,label:e.textContent.trim()})));
      for (const area of areas) {
        await page.goto(base + 'admin#' + area.id);
        await page.locator('#tab-'+area.id).waitFor({ state:'visible' });
        // Fetch completion and actual content are distinct from networkidle: polling is expected.
        await page.locator('#rtIdentity').filter({hasText:'admin'}).waitFor();
        const name=area.id+'-'+size.width+'.jpg';
        await page.screenshot({path:path.join(output,name),type:'jpeg',quality:85,fullPage:true});
        evidence.push({id:area.id,label:area.label,width:size.width,file:name,kind:'current-root-state',effects:'Opening root may load local read data; no run/save/publish action.'});
      }
      if(size.width===1440)for(const sample of manifest.samples){await page.goto(sample.url);await page.locator('body').waitFor();const name='view-'+sample.name+'.jpg';await page.screenshot({path:path.join(output,name),type:'jpeg',quality:85});evidence.push({id:'view-'+sample.name,file:name,kind:'synthetic-renderer-sample'});}
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output,'captures.json'),JSON.stringify({baseline:'5a8ba08',evidence,limits:['Root states and sample renderers only; see the significant-state ledger for uncaptured transitions.']},null,2));
  console.log(JSON.stringify({output,captures:evidence.length}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
