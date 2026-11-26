#!/usr/bin/env node
// Measure actual compact/full responses from the same owned retained job.
const fs=require('node:fs'),zlib=require('node:zlib');
async function main(){
 const [stateFile,scenarioFile,output]=process.argv.slice(2);if(!output)throw Error('Usage: node dev/measure-semantic-output.cjs PRIVATE_STATE SCENARIO OUTPUT.json.gz');
 const state=JSON.parse(fs.readFileSync(stateFile)),scenario=JSON.parse(fs.readFileSync(scenarioFile));
 for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR','DT_TOOLS'])delete process.env[key];
 Object.assign(process.env,{DT_HOME:state.traceHome,DT_SEMANTIC_URL:state.url,DT_SEMANTIC_TOKEN:state.token,DT_LOG:'quiet',DT_NO_DOCTOR:'1'});
 const T=require('../lib/tools'),request={analysis:state.analysis,entry:scenario.entry,parameter:scenario.parameter,sink:scenario.sink,argument:scenario.argument,assumptions:[{expression:scenario.predicate,holds:false}]};
 try{
  let compact=await T.call('what_happens_from',request);
  for(let n=0;['running','queued'].includes(compact.state)&&n<20;n++)compact=await T.call('what_happens_from',{job:compact.job,waitMs:30000});
  if(compact.error||['running','queued'].includes(compact.state))throw Error('Semantic measurement did not complete');
  const full=await T.call('what_happens_from',{job:compact.job,all:true});
  const bytes=v=>Buffer.byteLength(JSON.stringify(v));
  const record={protocol:'dt.semantic-output-measurement/v1',sourceDigest:require('../lib/source-version').digest(),request,job:compact.job,metrics:{compactBytes:bytes(compact),fullRetainedBytes:bytes(full),summaryBytes:bytes(compact.summary),ratio:bytes(compact)/bytes(full)},compact,full};
  fs.writeFileSync(output,zlib.gzipSync(JSON.stringify(record,null,2)+'\n'));console.log(JSON.stringify({output,metrics:record.metrics}));
 }finally{await require('../lib/isolate').stop();await require('../lib/state-store').close();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
