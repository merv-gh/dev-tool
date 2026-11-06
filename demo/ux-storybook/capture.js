#!/usr/bin/env node
// Optional screenshot reproduction. Requires Playwright and a Chromium install.
const { chromium } = require('playwright'), fs = require('node:fs'), path = require('node:path');
async function main() {
  const args=process.argv.slice(2),get=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
  const url=new URL(get('--url','http://127.0.0.1:4088/?story=investigate'));
  if(!['localhost','127.0.0.1'].includes(url.hostname)||url.protocol!=='http:')throw Error('Capture a local storybook URL.');
  const out=path.resolve(get('--out','work/ux-storybook/reproduced.png')),mobile=args.includes('--mobile');fs.mkdirSync(path.dirname(out),{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  try{const page=await browser.newPage({viewport:{width:mobile?390:1440,height:1040},deviceScaleFactor:1,reducedMotion:'reduce'});await page.goto(url.href);await page.locator('.workspace').waitFor();await page.screenshot({path:out,fullPage:true});console.log(JSON.stringify({file:out,mode:'illustrative prototype',viewport:page.viewportSize()}));}finally{await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
