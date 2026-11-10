// Annotation processors own a module, not just the file under the cursor. Let
// the project's compiler regenerate outputs; keep dt's fast test selection.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const active=new Map(),jars=new Map(),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const skip=new Set(['.git','.dt','target','build','node_modules','.gradle','out']);
function configs(root){const out=[];function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory()&&!skip.has(e.name))visit(path.join(dir,e.name));else if(e.isFile()&&e.name==='lombok.config')out.push(path.join(dir,e.name));}}visit(root);return out.sort();}
function detect(root,p,classpath=[],processorpath=[]){
 if(processorpath.length)return 'configured annotation processor path';
 for(const file of [path.join(root,'pom.xml'),path.join(p.modDir,'pom.xml'),path.join(root,'build.gradle'),path.join(root,'build.gradle.kts'),path.join(p.modDir,'build.gradle'),path.join(p.modDir,'build.gradle.kts')]){
  let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}
  if(/<annotationProcessorPaths\b|<annotationProcessors\b|<artifactId>\s*lombok\s*<|\b(annotationProcessor|testAnnotationProcessor|kapt|ksp)\b|io\.freefair\.lombok/.test(text))return 'declared Lombok or annotation processing';
 }
 if(configs(root).length)return 'Lombok configuration';
 for(const file of classpath.filter(f=>/\.jar$/.test(f)&&fs.existsSync(f))){
  if(/(?:^|[/\\])lombok-[^/\\]+\.jar$/.test(file))return 'Lombok on the compile classpath';
  const st=fs.statSync(file),key=file+':'+st.size+':'+st.mtimeMs;
  if(!jars.has(key)){if(jars.size>=2000)jars.clear();jars.set(key,require('./javacheck').zipEntries(file).includes('META-INF/services/javax.annotation.processing.Processor'));}
  if(jars.get(key))return 'annotation processor on the compile classpath';
 }
 for(const dir of ['target/generated-sources','build/generated/sources']){try{if(fs.readdirSync(path.join(p.modDir,dir),{recursive:true}).some(f=>/\.java$/.test(f)))return 'build-generated Java sources';}catch{}}
 return null;
}
function outputFingerprint(p){
 const entries=[];for(const base of p.tool==='maven'?['target/classes','target/test-classes','target/generated-sources','target/generated-test-sources']:['build/classes','build/generated']){const dir=path.join(p.modDir,base);if(!fs.existsSync(dir))continue;for(const name of fs.readdirSync(dir,{recursive:true})){const file=path.join(dir,name),st=fs.lstatSync(file);if(st.isFile())entries.push([base+'/'+name,st.size,st.mtimeMs]);}}
 return entries.length?hash(JSON.stringify(entries.sort((a,b)=>a[0].localeCompare(b[0])))):null;
}
function markCompiled(root,p,cfg,env){
 const TR=require('./testrun'),inputs=configs(root).map(f=>[path.relative(root,f),fs.readFileSync(f,'utf8')]),source=TR.fingerprint(root,{includeTests:true});
 require('./atomic-file').atomicFile(path.join(root,'.dt','annotation-'+hash(p.module).slice(0,12)+'.json'),JSON.stringify({identity:hash(JSON.stringify([source,inputs,cfg,env])),production:TR.fingerprint(root),config:hash(JSON.stringify(inputs)),outputs:outputFingerprint(p)}),{mode:0o600});
}
async function compile(root,p,cfg,env,log=()=>{}){
 const key=root+'\0'+p.module;while(active.has(key))await active.get(key);
 const task=(async()=>{
  const TR=require('./testrun'),inputs=configs(root).map(f=>[path.relative(root,f),fs.readFileSync(f,'utf8')]);
  const source=TR.fingerprint(root,{includeTests:true}),production=TR.fingerprint(root),identity=hash(JSON.stringify([source,inputs,cfg,env]));
  const file=path.join(root,'.dt','annotation-'+hash(p.module).slice(0,12)+'.json');let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  if(previous?.identity===identity&&previous.outputs&&previous.outputs===outputFingerprint(p))return {code:0,out:'',ms:0,reused:true};
  const clean=previous?.production!==production||previous?.config!==hash(JSON.stringify(inputs))||!!previous.outputs&&previous.outputs!==outputFingerprint(p);let cmd,args,cwd=root;
  if(p.tool==='maven'){
   const m=TR.mavenCmd(root,cfg);cmd=m[0];args=[...m[1],'-B','-ntp',...(clean?['clean']:[]),'test-compile',`-Dmaven.repo.local=${cfg.mavenRepo}`,...(cfg.mavenSettings?['-s',cfg.mavenSettings]:[]),...(cfg.offline?['-o']:[]),...cfg.args,...(p.module!=='.'?['-pl',p.module,'-am']:[])];
  }else{
   const g=TR.gradleCmd(root,cfg),prefix=p.module==='.'?'':':'+p.module.split('/').join(':')+':';cmd=g[0];args=[...g[1],'--console=plain','--no-watch-fs',...(clean?[prefix+'clean']:[]),prefix+'testClasses',...(cfg.offline?['--offline']:[]),...require('./buildenv').forBuild(cfg,'gradle').args,...cfg.args];
  }
  const r=await require('./trace').step('annotation-aware compile',()=>require('./fastrun').exec(cmd,args,{cwd,env,log,timeoutMs:cfg.timeoutMs}),p.module+' · project processors and generated sources');
  if(source!==TR.fingerprint(root,{includeTests:true}))return {...r,code:r.code||1,stale:true,out:r.out+'\nSources changed while compiling; retry against a stable workspace.'};
  if(r.code===0)require('./atomic-file').atomicFile(file,JSON.stringify({identity,production,config:hash(JSON.stringify(inputs)),outputs:outputFingerprint(p)}),{mode:0o600});
  return {...r,reused:false};
 })();active.set(key,task);try{return await task;}finally{if(active.get(key)===task)active.delete(key);}
}
async function check(root,p,files,cfg){
 const TR=require('./testrun'),{env}=await TR.envFor(p,cfg),r=await compile(root,p,cfg,env);
 const errors=TR.compileErrors(r.out,root),mine=errors.filter(e=>files.includes(e.file)),other=errors.filter(e=>!files.includes(e.file));
 return {ok:r.code===0,checked:files.length,compileMs:r.ms,ms:r.ms,compiler:'project-build',reason:'Annotation processors and generated sources are compiled with the project configuration; source auto-fixes are not applied to compiler-generated symbols.',reused:r.reused,errors:mine,...(other.length?{alsoBroken:other.slice(0,20)}:{}),...(r.code!==0?{buildError:require('./redact').clean(require('./testout').compactLog(r.out).slice(-3000))}:{}),...(r.stale?{stale:true}:{})};
}
module.exports={detect,compile,check,configs,markCompiled};
