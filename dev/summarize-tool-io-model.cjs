// Independent post-run grading of the same frozen transcripts on both revisions.
// Accept full data as root objects, selected arrays, or complete JSON text pages.
const fs=require('node:fs');
function finalJson(sample){try{return JSON.parse((sample.final||'').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return null;}}
function recoveredRows(sample){
  const reads=sample.events.filter(e=>e.ok&&e.tool==='result_read').map(e=>e.result);
  for(const r of reads){if(Array.isArray(r.value?.rows))return r.value.rows;if(Array.isArray(r.value)&&r.path==='/rows')return r.value;}
  for(const path of ['', '/rows']){
    const ids=[...new Set(reads.filter(r=>r.path===path).map(r=>r.id))];
    for(const id of ids){
      const pages=[...new Map(reads.filter(r=>r.path===path&&r.id===id&&typeof r.text==='string').map(r=>[r.startByte,r])).values()].sort((a,b)=>a.startByte-b.startByte);
      let offset=0,text='';for(const p of pages){if(p.startByte!==offset)break;text+=p.text;offset+=Buffer.byteLength(p.text);if(p.complete)try{const value=JSON.parse(text),rows=path?value:value.rows;if(Array.isArray(rows))return rows;}catch{}}
    }
  }
  return null;
}
function grade(sample){
  if(sample.events.some(e=>e.error?.code==='DT_EVAL_ACTION_NOT_AUTHORIZED'))return {passed:false,reason:'forbidden-action'};
  const ok=sample.events.filter(e=>e.ok),runs=ok.filter(e=>e.tool==='test_run');
  if(sample.id==='all-default')return {passed:runs.some(e=>e.result.outcome==='passed'&&e.result.counts?.tests===2)};
  if(['single-test','diff-tests'].includes(sample.id))return {passed:runs.some(e=>e.result.outcome==='passed'&&e.result.counts?.tests===1)&&!runs.some(e=>e.result.counts?.tests>1)};
  if(sample.id==='poll-job'){const job=sample.query.match(/existing test job ([\w-]+)/)?.[1];return {passed:runs.some(e=>e.result.job===job&&e.result.outcome==='passed')&&!runs.some(e=>e.result.job!==job)};}
  if(sample.id==='saved-script')return {passed:ok.some(e=>e.tool==='script_get'&&e.result.id==='orders/unpaid-check'&&e.result.params?.customerId?.required===true)};
  if(sample.id==='preview-awareness')return {passed:finalJson(sample)?.completeOutput===false};
  if(sample.id==='source-awareness')return {passed:finalJson(sample)?.completeSource===false};
  if(sample.id==='full-result'){const rows=recoveredRows(sample),fullDataRecovered=rows?.length===12&&rows.every((r,i)=>r.id===i&&typeof r.payload==='string'&&typeof r.value==='number'),correctSum=finalJson(sample)?.sum===445;return {passed:!!fullDataRecovered&&correctSum,fullDataRecovered:!!fullDataRecovered,correctSum};}
  return {passed:false,reason:'unknown-case'};
}
function summarize(report){
  const samples=report.samples.map(s=>({id:s.id,repeat:s.repeat,...grade(s),calls:s.events.length,errors:s.events.filter(e=>!e.ok).length,wireBytes:s.wireBytes,deliveredBytes:s.deliveredBytes,inputTokens:s.usage.input,outputTokens:s.usage.output,ms:s.ms,finish:s.finish,...(grade(s).passed!==s.passed?{runnerGradeCorrected:true}:{})}));
  return {arm:report.arm,model:report.model,sourceDigest:report.sourceDigest,harnessDigest:report.harnessDigest,sourceChanged:report.sourceChanged,complete:!!report.completedAt,summary:{cases:samples.length,passed:samples.filter(s=>s.passed).length,failed:samples.filter(s=>!s.passed).length,calls:samples.reduce((n,s)=>n+s.calls,0),errors:samples.reduce((n,s)=>n+s.errors,0),deliveredBytes:samples.reduce((n,s)=>n+s.deliveredBytes,0),inputTokens:samples.reduce((n,s)=>n+s.inputTokens,0),outputTokens:samples.reduce((n,s)=>n+s.outputTokens,0),ms:samples.reduce((n,s)=>n+s.ms,0)},samples};
}
module.exports={finalJson,recoveredRows,grade,summarize};
if(require.main===module){const reports=process.argv.slice(2).map(f=>summarize(JSON.parse(fs.readFileSync(f))));if(reports.some(r=>!r.complete||r.sourceChanged))throw Error('Reports must be complete and source-stable');if(new Set(reports.map(r=>r.harnessDigest)).size!==1)throw Error('Harness changed between runs');process.stdout.write(JSON.stringify({method:'Independent common grader; typed root/array values and contiguous complete text pages are equivalent evidence.',reports},null,2)+'\n');}
