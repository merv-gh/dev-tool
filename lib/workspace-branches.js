// Branch navigation opens/reuses a separate owned checkout; dirty sources stay put.
const fs=require('node:fs'),path=require('node:path'),W=require('./workspace'),G=require('./git');
async function list(id,{refresh=false}={}){
 const m=W.checkId(id),file=path.join(m.path,'.dt','branches.json');let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 if(refresh){const remote=m.remote||G.remote(m.project,m.repo),out=await G.git(['ls-remote','--heads',remote],m.path,G.authArgs(remote),{timeoutMs:30000}),rows=out.split('\n').filter(Boolean).map(line=>{const [sha,ref]=line.split(/\s+/);return {name:ref?.replace(/^refs\/heads\//,''),sha};}).filter(r=>r.name);saved={at:new Date().toISOString(),branches:rows.slice(0,5000),truncated:rows.length>5000};require('./atomic-file').atomicFile(file,JSON.stringify(saved),{mode:0o600});}
 const byName=new Map((saved?.branches||[]).map(b=>[b.name,b]));if(m.ref&&!G.isSha(m.ref)&&!byName.has(m.ref))byName.set(m.ref,{name:m.ref,sha:m.sha});return {workspace:id,current:m.ref,branches:[...byName.values()].sort((a,b)=>a.name.localeCompare(b.name)),source:saved?'Retained remote branches':'Workspace ref only · refresh to fetch remote branches',observedAt:saved?.at,truncated:saved?.truncated||false};
}
async function open(id,ref){const m=W.checkId(id);if(typeof ref!=='string'||!ref||ref.length>512||/^-|[\x00-\x20]/.test(ref))throw Error('Choose a valid Git branch/ref');const existing=W.list().filter(w=>w.exists&&w.repo===m.project+'/'+m.repo&&w.ref===ref).map(w=>W.checkId(w.id)).find(w=>(w.remote||G.remote(w.project,w.repo))===(m.remote||G.remote(m.project,m.repo)));
 if(existing)return {...existing,path:path.relative(require('./config').HOME,existing.path),reused:true};
 return W.open({project:m.project,repo:m.repo,service:m.service,ref,url:m.remote});}
module.exports={list,open};
