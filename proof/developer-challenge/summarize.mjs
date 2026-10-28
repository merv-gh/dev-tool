import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('./evidence/',import.meta.url);
const records=readdirSync(root).filter(n=>n.endsWith('.json')).map(n=>({artifact:n,...JSON.parse(readFileSync(new URL(n,root),'utf8'))}));
const supplemental=records.filter(r=>/-s0[1-4]-/.test(r.artifact));
const initial=records.filter(r=>!/-s0[1-4]-/.test(r.artifact));
const stats=rs=>({calls:rs.length,durationSumMs:rs.reduce((a,r)=>a+r.durationMs,0),stdoutBytes:rs.reduce((a,r)=>a+r.stdoutBytes,0),stderrBytes:rs.reduce((a,r)=>a+r.stderrBytes,0),started:rs.map(r=>r.started).sort()[0],ended:rs.map(r=>r.ended).sort().at(-1)});
const out={all:stats(initial),cases:{},unassigned:null};
for(let i=1;i<=8;i++){const id='c'+String(i).padStart(2,'0');out.cases[id.toUpperCase()]=stats(records.filter(r=>r.artifact.toLowerCase().includes(id)));}
out.unassigned=stats(initial.filter(r=>!/-c0[1-8](?:-|\.)|read-c0[1-8]/i.test(r.artifact)));
writeFileSync(new URL('./metrics.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
const patches=initial.filter(r=>r.result?.patch).map(r=>({case:r.artifact.match(/c0[1-8]/i)?.[0].toUpperCase(),artifact:r.artifact,workspace:r.result.workspace,base:r.result.base,files:r.result.files,redGreen:r.result.tests,truncated:r.result.patch.includes('more chars]')}));
writeFileSync(new URL('./submissions.json',import.meta.url),JSON.stringify(patches,null,2)+'\n');
writeFileSync(new URL('./supplement-metrics.json',import.meta.url),JSON.stringify({all:stats(supplemental),scenarios:Object.fromEntries([1,2,3,4].map(n=>{const id='s'+String(n).padStart(2,'0');return [id.toUpperCase(),stats(supplemental.filter(r=>r.artifact.includes(id)))];}))},null,2)+'\n');
const calls=readFileSync(new URL('./evidence/calls.jsonl',import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
writeFileSync(new URL('./supplement-calls.jsonl',import.meta.url),calls.filter(r=>/-s0[1-4]-/.test(r.artifact)).map(JSON.stringify).join('\n')+'\n');
console.log(JSON.stringify(out,null,2));
