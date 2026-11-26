#!/usr/bin/env node
// Publish completed disposable-fixture trials; never copy private state/config files.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
function summarize(source,output){
 fs.mkdirSync(output,{recursive:true});
 const trials=[],manifestFile=path.join(source,'harness-errors.json'),exclusions=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile)):{};
 if(fs.existsSync(manifestFile))fs.copyFileSync(manifestFile,path.join(output,'harness-errors.json'));
 for(const name of fs.readdirSync(source).filter(n=>n.endsWith('.json.gz')).sort()){
  const bytes=fs.readFileSync(path.join(source,name)),r=JSON.parse(zlib.gunzipSync(bytes));
  if(!r.completedAt)continue;
  const harnessError=exclusions[name]||r.events?.length&&r.events.every(e=>e.result?.error==='Invalid or unexpected token'&&!Object.hasOwn(e.result,'ok'));
  fs.copyFileSync(path.join(source,name),path.join(output,name));
  trials.push({file:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),classification:harnessError?'harness-error':'model-trial',...(exclusions[name]?{exclusionReason:exclusions[name]}:{}),model:r.model,profile:r.profile,surface:r.surface||'code',answerViewKind:r.answerViewKind,seed:r.seed,case:r.case,scenario:r.scenario?.key||r.scenario?.kind||'core',passed:r.passed===true,strictPassed:r.strictPassed===true,formatCompliant:r.formatCompliant===true,finish:r.finish,calls:r.events?.length||0,checks:r.checks,sourceDigest:r.sourceDigest,harnessDigest:r.harnessDigest,grader:r.grader,graderDigest:r.graderDigest,git:r.git,providerMaxPromptTokens:Math.max(0,...(r.providerTurns||[]).map(t=>t.promptTokens||0)),enabledToolNames:r.enabledToolNames,toolScope:r.enabledToolNames?'verified-exact-allowlist':'legacy-group-expanded',usage:r.usage,deliveredToolBytes:(r.events||[]).reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.result)),0)});
 }
 fs.writeFileSync(path.join(output,'index.json'),JSON.stringify({protocol:'dt.code-reliability-index/v1',meaning:'Development histories are not independent A/B estimates. Consult source/harness digests, enabled tools, prompts and raw transcripts. Harness errors are excluded from model claims.',trials},null,2)+'\n');
 return {trials:trials.length,modelTrials:trials.filter(t=>t.classification==='model-trial').length,harnessErrors:trials.filter(t=>t.classification==='harness-error').length};
}
if(require.main===module){
 const args=process.argv.slice(2);if(args.length!==2)throw Error('Usage: node dev/summarize-code-evaluations.cjs SOURCE_REPORTS OUTPUT_DIRECTORY');
 console.log(JSON.stringify(summarize(...args)));
}
module.exports={summarize};
