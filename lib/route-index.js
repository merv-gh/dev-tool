// Keep only endpoint evidence on the serving path, never whole passport flow graphs.
const fs=require('node:fs'),path=require('node:path');
const C=require('./config'),{readJson,fileStamp}=require('./util');
const detected=new Map(),overlaid=new Map();
function files(){try{return fs.readdirSync(C.PATHS.passports,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>({name:d.name,file:path.join(C.PATHS.passports,d.name,'passport.json')})).filter(d=>fs.existsSync(d.file));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
function project(p){if(!p?.service||!p.effective||typeof p.effective!=='object'||Array.isArray(p.effective))throw Object.assign(Error('Cached passport endpoint attribution is unavailable'),{code:'DT_PASSPORT_INVALID'});return {service:p.service,env:p.env,repo:p.repo?Object.fromEntries(['project','repo','sha','ref'].filter(k=>p.repo[k]!==undefined).map(k=>[k,p.repo[k]])):undefined,effective:{endpoints:p.effective.endpoints||[]}};}
function readProjection(file){
 if(fs.statSync(file).size<524288)return project(readJson(file));
 const r=new (require('./pgstore').Reader)(file),p={};
 try{r.object(key=>{if(key==='service'||key==='env')p[key]=r.value();else if(key==='repo'){r.space();if(r.peek()===110){r.value();return;}p.repo={};r.object(k=>{if(['project','repo','sha','ref'].includes(k))p.repo[k]=r.value();else r.skip();});}else if(key==='effective'){p.effective={};r.object(k=>{if(k==='endpoints')p.effective.endpoints=r.value();else r.skip();});}else r.skip();});r.space();if(r.peek()!==undefined)throw Error('Trailing JSON data');return project(p);}finally{r.close();}
}
function save(p,file=path.join(C.PATHS.passports,require('./util').safeName(p.service),'passport.json')){const value=project(p),stamp=fileStamp(file),sidecar=path.join(C.PATHS.cache,'api-passports',path.basename(path.dirname(file))+'.json');require('./atomic-file').atomicFile(sidecar,JSON.stringify({version:1,stamp,value})+'\n');return value;}
function get({name,file}){
 const stamp=fileStamp(file),hit=detected.get(file);if(hit?.stamp===stamp)return hit.value;
 const sidecar=path.join(C.PATHS.cache,'api-passports',name+'.json'),saved=readJson(sidecar);
 let value;if(saved?.stamp===stamp&&saved.version===1)value=saved.value;else{
  value=readProjection(file);
  try{require('./atomic-file').atomicFile(sidecar,JSON.stringify({version:1,stamp,value})+'\n');}catch(e){require('./trace').note('Endpoint cache could not be saved: '+e.code);}
 }
 detected.set(file,{stamp,value});while(detected.size>2048)detected.delete(detected.keys().next().value);return value;
}
function signature({manual=true,env}={}){
 const overrides=require('./passport/overrides');
 return files().map(row=>{const stamp=fileStamp(row.file);return row.name+':'+stamp+(manual?':'+overrides.signature(get(row),{env}):'');}).join('|');
}
function passports({manual=true,env}={}){
 const A=require('./access'),overrides=require('./passport/overrides');
 return files().map(row=>{
  const p=get(row);if(!manual)return p;
  const revision=overrides.signature(p,{env});if(!revision)return p;
  const key=A.current().scopeKey+'\0'+(env||'')+'\0'+row.file,stamp=fileStamp(row.file)+':'+revision,hit=overlaid.get(key);if(hit?.stamp===stamp)return hit.value;
  const value=project(overrides.apply(p,{env}));overlaid.set(key,{stamp,value});while(overlaid.size>1024)overlaid.delete(overlaid.keys().next().value);return value;
 });
}
module.exports={files,project,readProjection,save,passports,signature};
