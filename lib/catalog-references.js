// Conservative retention references live separately from the SQLite writer, so
// saving evidence cannot wait behind a large index transaction. References are
// released explicitly; an archive/move must never silently unpin its evidence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=message=>Object.assign(Error(message),{code:'DT_CATALOG_RETENTION',statusCode:409});
const root=env=>path.join(path.dirname(require('./catalog-store').filename(env)),'catalog-references');
function locked(env,fn){
 const dir=root(env),lock=path.join(dir,'.lock');fs.mkdirSync(dir,{recursive:true});
 try{fs.mkdirSync(lock);}catch(e){if(e.code!=='EEXIST')throw e;let alive=Date.now()-fs.statSync(lock).mtimeMs<30000;try{const owner=JSON.parse(fs.readFileSync(path.join(lock,'owner.json'))),p=owner.pid;try{process.kill(p,0);alive=owner.thread?alive:true;}catch(e){alive=e.code!=='ESRCH';}}catch{}if(alive)throw fail('Catalog retention is busy; retry saving the evidence');fs.rmSync(lock,{recursive:true,force:true});try{fs.mkdirSync(lock);}catch{throw fail('Catalog retention is busy');}}
 const token=crypto.randomUUID();fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,thread:require('node:worker_threads').threadId,token}));
 try{return fn(dir,()=>{if(JSON.parse(fs.readFileSync(path.join(lock,'owner.json'))).token!==token)throw fail('Catalog retention lease changed');const now=new Date();fs.utimesSync(lock,now,now);});}finally{try{if(JSON.parse(fs.readFileSync(path.join(lock,'owner.json'))).token===token)fs.rmSync(lock,{recursive:true,force:true});}catch{}}
}
function list(env,generation){
 if(!/^[a-f0-9]{64}$/.test(generation||''))return [];
 const dir=path.join(root(env),generation);let files;try{files=fs.readdirSync(dir);}catch{return [];}
 return files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))));
}
function collect(value,out=new Map(),depth=0,budget={n:0}){
 if(!value||typeof value!=='object'||depth>12||++budget.n>20000)return out;
 if(value.protocol==='dt.catalog-page/v1'&&/^[\w-]+$/.test(value.env||'')&&/^[a-f0-9]{64}$/.test(value.generation||''))out.set(value.env+':'+value.generation,{env:value.env,generation:value.generation});
 for(const v of Object.values(value))collect(v,out,depth+1,budget);return out;
}
function retain(input,source){
 let value=input;if(Buffer.isBuffer(input)&&!input.includes('dt.catalog-page/v1'))return [];if(typeof input==='string'||Buffer.isBuffer(input)){const text=String(input);if(!text.includes('dt.catalog-page/v1'))return [];if(Buffer.byteLength(text)>4*1048576)throw fail('Catalog evidence needs a compact manifest before saving');try{value=JSON.parse(text);}catch{return [];}}
 const references=[...collect(value).values()],scope=require('./access').owner().scopeKey,reference=crypto.createHash('sha256').update(scope+'\0'+source).digest('hex');
 for(const r of references)locked(r.env,dir=>{
   if(!require('./catalog-store').page(r.env,'',{generation:r.generation,limit:1}))throw fail('Catalog generation is unavailable; refresh before retaining a reference');
   const target=path.join(dir,r.generation,reference+'.json');if(!fs.existsSync(target)){let total=0;for(const g of fs.readdirSync(dir))if(/^[a-f0-9]{64}$/.test(g))total+=fs.readdirSync(path.join(dir,g)).length;if(total>=10000)throw fail('Catalog reference budget reached; explicitly release obsolete evidence references');}
   require('./atomic-file').atomicFile(target,JSON.stringify({...r,reference,scope,at:new Date().toISOString()}),{mode:0o600});
 });return references.map(r=>({...r,reference}));
}
function release(env,generation,reference){require('./access').requireAdmin();if(!/^[a-f0-9]{64}$/.test(reference||''))throw fail('Invalid reference');return locked(env,dir=>{const found=list(env,generation).find(r=>r.reference===reference&&r.scope===require('./access').owner().scopeKey);if(!found)throw fail('Reference is not available in the selected scope');fs.unlinkSync(path.join(dir,generation,reference+'.json'));return {released:reference,generation};});}
module.exports={retain,list,locked,release};
