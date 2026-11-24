// Inspect the built-in registry in an empty temporary config. Never run tools/plugins.
const {spawnSync}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');
function collect(){
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('DT_'))delete env[key];
 const script=String.raw`const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-intent-inventory-'));process.env.DT_HOME=home;process.env.DT_NO_DOCTOR='1';fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}}}));(async()=>{try{const r=await require('./lib/tools').ready();process.stdout.write(JSON.stringify(r.all.map(t=>({name:t.name,group:t.group||'other',description:t.description?.split('\n')[0],required:t.required||[]})).sort((a,b)=>a.name.localeCompare(b.name))));}finally{fs.rmSync(home,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});`;
 const result=spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'../../..'),env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
 if(result.status!==0)throw Error('Isolated source inventory failed: '+(result.error?.message||result.stderr));return JSON.parse(result.stdout);
}
function assertCurrent(){const stored=require('./tool-inventory.json').tools,live=collect();const keys=xs=>xs.map(t=>t.name+' / '+t.group);if(JSON.stringify(keys(stored))!==JSON.stringify(keys(live)))throw Error('Built-in tools changed. Refresh inventory deliberately, add explicit intent mappings, then verify again.');return live.length;}
if(require.main===module){if(process.argv.includes('--write')){const tools=collect();fs.writeFileSync(path.join(__dirname,'tool-inventory.json'),JSON.stringify({baseline:require('./tool-inventory.json').baseline,source:'lib/tools.js ready().all in isolated config; no tools executed',tools},null,2)+'\n');console.log(JSON.stringify({tools:tools.length,action:'snapshot refreshed; intent mappings still require verification'}));}else console.log(JSON.stringify({current:true,tools:assertCurrent()}));}
module.exports={collect,assertCurrent};
