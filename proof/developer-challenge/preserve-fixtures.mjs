// Materialize tool-returned text as portable evidence; never read application files directly.
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const evidence=resolve(here,'evidence');
const record=JSON.parse(readFileSync(resolve(evidence,readdirSync(evidence).find(n=>n.endsWith('-c06-patch.json'))),'utf8'));
const files=record.result.files.filter(f=>f.path.startsWith('src/test/resources/')).map(f=>({workspace:'c06-main-a358',path:f.path,target:'c06/'+f.path}));
files.push({workspace:'order-projection-main-073e',path:'src/test/resources/dt-schema/orders.sql',target:'projection/schema.sql'});
files.push({workspace:'order-projection-main-073e',path:'src/test/resources/dt-fixtures/projection-baseline/pg/6f7264657273/data.sql',target:'projection/data.sql'});
for(let index=0;index<files.length;index++){
 const item=files[index];let from=1,parts=[];
 for(;;){
  const p=spawnSync(process.execPath,[resolve(here,'call.mjs'),'workspace_read',JSON.stringify({workspace:item.workspace,path:item.path,from,to:from+399}),`s02-portable-${index}-${from}`],{env:process.env,encoding:'utf8',maxBuffer:8*1024*1024});
  if(p.status)throw new Error(p.stderr||p.stdout);
  const r=JSON.parse(p.stdout).result;
  if(!r.text)throw new Error('No tool text: '+JSON.stringify(r));
  parts.push(r.text.split('\n').map(line=>line.replace(/^ *\d+  /,'')).join('\n'));
  if(r.to>=r.lines)break;
  from=r.to+1;
 }
 const target=resolve(here,'artifacts',item.target);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,parts.join('\n'));
}
console.log(JSON.stringify({preserved:files.length,root:resolve(here,'artifacts')}));
