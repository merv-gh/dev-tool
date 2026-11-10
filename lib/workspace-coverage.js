// Per-run change coverage. Source pins and bytecode snapshots keep an old green
// report from approving a new edit. No existing project-wide baseline is needed.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const W=require('./workspace'),G=require('./git'),R=require('./results');
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const cache=id=>{W.checkId(id);return path.join(require('./access').scopedDirectory(require('./config').PATHS.cache),'change-coverage',id);};
const write=(file,value)=>require('./atomic-file').atomicFile(file,JSON.stringify(value),{mode:0o600});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const error=message=>Object.assign(Error(message),{code:'DT_COVERAGE_ARGUMENT'});
const groovy=s=>"'"+String(s).replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'";
function ranges(lines){const out=[];for(const n of [...new Set(lines)].sort((a,b)=>a-b)){const last=out.at(-1);if(last&&last[1]+1===n)last[1]=n;else out.push([n,n]);}return out;}
const production=p=>/(^|\/)src\/main\/(java|kotlin|groovy)\/.+\.(java|kt|groovy)$/.test(p);
async function plan(id,{base}={}){
 const m=W.checkId(id),root=m.path,ref=base||m.sha;
 if(typeof ref!=='string'||!ref||ref.length>300||/^-|[\x00-\x20]/.test(ref))throw error('base must be a Git commit/ref');
 const sha=(await G.git(['rev-parse','--verify',ref+'^{commit}'],root)).trim();
 const names=(await G.git(['diff','--name-only','-z','--no-renames',sha,'--'],root)).split('\0').filter(production);
 const fresh=(await G.git(['ls-files','--others','--exclude-standard','-z'],root)).split('\0').filter(production);
 const files=[];
 for(const name of [...new Set([...names,...fresh])].sort()){
  if(files.length>=500)throw error('More than 500 changed production files; narrow the baseline or split this change');
  const full=W.resolvePath(m,name,{missing:true}).full;if(!fs.existsSync(full)){files.push({path:name,deleted:true,changed:[],ranges:[]});continue;}
  if(fs.statSync(full).size>8*1024*1024)throw error('Changed source exceeds the 8 MiB coverage planning limit');
  const source=fs.readFileSync(full,'utf8'),lines=source.split('\n'),changed=[];let deletedLines=0;
  if(fresh.includes(name)){for(let n=1;n<=lines.length-(source.endsWith('\n')?1:0);n++)changed.push(n);}
  else {const diff=await G.git(['diff','--no-ext-diff','--no-textconv','--no-renames','--unified=0',sha,'--',name],root);for(const h of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)){const count=h[4]===undefined?1:+h[4];deletedLines+=(h[2]===undefined?1:+h[2]);for(let n=+h[3];n<+h[3]+count;n++)changed.push(n);}}
  if(changed.length+files.reduce((n,f)=>n+f.changed.length,0)>20000)throw error('More than 20000 changed lines; split this coverage scope');
  files.push({path:name,hash:digest(source),changed,ranges:ranges(changed),sourceLines:Object.fromEntries(changed.map(n=>[n,(lines[n-1]||'').slice(0,400)])),removedSideLines:deletedLines});
 }
 const fingerprint=require('./testrun').fingerprint(root,{includeTests:true});
 return {schema:'dt.change-coverage/v1',workspace:id,base:sha,sourceFingerprint:fingerprint,createdAt:new Date().toISOString(),files,counts:{files:files.length,changedLines:files.reduce((n,f)=>n+f.changed.length,0),deletedFiles:files.filter(f=>f.deleted).length},limitations:['Scope is added/modified lines in standard JVM production source roots, including untracked files. Removed code has no current executable lines.','Before measurement, changed lines are candidates, not an executable-line denominator. No historical coverage baseline is required.']};
}
// Read class identity + SourceFile without loading classes or interpreting Java.
function classIdentity(file){
 const b=fs.readFileSync(file);if(b.length>16*1024*1024||b.readUInt32BE(0)!==0xcafebabe)throw error('Invalid/oversized class file');let p=8;const cp=Array(b.readUInt16BE(p));p+=2;
 for(let i=1;i<cp.length;i++){const t=b[p++];if(t===1){const n=b.readUInt16BE(p);p+=2;cp[i]=b.toString('utf8',p,p+n);p+=n;}else if([7,8,16,19,20].includes(t)){cp[i]=b.readUInt16BE(p);p+=2;}else if([3,4,9,10,11,12,17,18].includes(t))p+=4;else if([5,6].includes(t)){p+=8;i++;}else if(t===15)p+=3;else throw error('Unknown class constant');}
 p+=2;const name=cp[cp[b.readUInt16BE(p)]];p+=4;const interfaces=b.readUInt16BE(p);p+=2+interfaces*2;
 const attributes=()=>{const n=b.readUInt16BE(p);p+=2;let source;for(let i=0;i<n;i++){const key=cp[b.readUInt16BE(p)],size=b.readUInt32BE(p+2);p+=6;if(key==='SourceFile')source=cp[b.readUInt16BE(p)];p+=size;if(p>b.length)throw error('Truncated class');}return source;};
 for(let section=0;section<2;section++){const n=b.readUInt16BE(p);p+=2;for(let i=0;i<n;i++){p+=6;attributes();}}
 const source=attributes();return {name,source:source?[...name.split('/').slice(0,-1),source].join('/'):null};
}
function walk(dir,suffix,out=[]){let es;try{es=fs.readdirSync(dir,{withFileTypes:true});}catch{return out;}for(const e of es){const f=path.join(dir,e.name);if(e.isDirectory())walk(f,suffix,out);else if(e.isFile()&&f.endsWith(suffix))out.push(f);}return out;}
async function artifacts(root,p,cfg,env,target){
 const version=cfg.coverage?.version||'0.8.16';if(!/^\d+\.\d+\.\d+$/.test(version))throw error('tests.coverage.version must be a released JaCoCo version');
 const find=(artifact,classifier,override)=>{if(override){const f=path.resolve(require('./config').HOME,override);if(!fs.existsSync(f))throw error('Configured coverage jar is unavailable');return f;}return path.join(cfg.mavenRepo,'org/jacoco',artifact,version,artifact+'-'+version+'-'+classifier+'.jar');};
 const agent=find('org.jacoco.agent','runtime',cfg.coverage?.agentJar),cli=find('org.jacoco.cli','nodeps',cfg.coverage?.cliJar);
 if(p.tool==='gradle'&&(!fs.existsSync(agent)||!fs.existsSync(cli))){
  const dir=path.join(root,'.dt','coverage','jars',version);fs.mkdirSync(dir,{recursive:true});const resolved={agent:cfg.coverage?.agentJar?agent:path.join(dir,'agent.jar'),cli:cfg.coverage?.cliJar?cli:path.join(dir,'cli.jar'),version};
  if(!fs.existsSync(resolved.agent)||!fs.existsSync(resolved.cli)){
   const init=path.join(dir,'resolve.gradle'),task='dtCoverageResolve'+digest(version).slice(0,8),TR=require('./testrun'),g=TR.gradleCmd(root,cfg);
   fs.writeFileSync(init,`gradle.projectsEvaluated { rootProject { tasks.register('${task}') { doLast {\n`+[['agent','org.jacoco.agent','runtime'],['cli','org.jacoco.cli','nodeps']].filter(([key])=>!fs.existsSync(resolved[key])).map(([key,artifact,classifier])=>` def dep${key} = dependencies.create('org.jacoco:${artifact}:${version}:${classifier}@jar'); def conf${key} = configurations.detachedConfiguration(dep${key}); conf${key}.transitive = false\n java.nio.file.Files.copy(conf${key}.singleFile.toPath(), file(${groovy(resolved[key])}).toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)\n`).join('')+'} } } }\n');
   const r=await TR.exec(g[0],[...g[1],'--console=plain','--no-watch-fs',...(cfg.offline?['--offline']:[]),...require('./buildenv').forBuild(cfg,'gradle').args,...cfg.args,'--init-script',init,task],{...target,cwd:root,env,timeoutMs:cfg.timeoutMs});if(r.code!==0||!fs.existsSync(resolved.agent)||!fs.existsSync(resolved.cli))throw error('JaCoCo jars unavailable from Gradle repositories/cache; configure tests.coverage.agentJar/cliJar for offline use');
  }return resolved;
 }
 for(const [file,artifact,classifier]of [[agent,'org.jacoco.agent','runtime'],[cli,'org.jacoco.cli','nodeps']])if(!fs.existsSync(file)){
  const TR=require('./testrun'),m=TR.mavenCmd(root,cfg),r=await TR.exec(m[0],[...m[1],'-B','-ntp',`-Dmaven.repo.local=${cfg.mavenRepo}`,...(cfg.mavenSettings?['-s',cfg.mavenSettings]:[]),...(cfg.offline?['-o']:[]),...cfg.args,'org.apache.maven.plugins:maven-dependency-plugin:3.8.1:get',`-Dartifact=org.jacoco:${artifact}:${version}:jar:${classifier}`,'-Dtransitive=false'],{...target,cwd:root,env,timeoutMs:cfg.timeoutMs});if(r.code!==0||!fs.existsSync(file))throw error('JaCoCo jars unavailable; provision the Maven cache or configure tests.coverage.agentJar/cliJar');
 }
 return {agent,cli,version};
}
async function begin(id,base,root,p,cfg,env,target){
 const scope=await plan(id,{base});if(!scope.files.some(f=>f.changed.length))return {scope,state:'no_changes'};
 if(!['maven','gradle'].includes(p.tool))return {scope,state:'unavailable',gaps:['Automatic change coverage currently supports JVM Maven/Gradle runs.']};
 const run=crypto.randomBytes(12).toString('hex'),dir=path.join(root,'.dt','coverage',run);fs.mkdirSync(dir,{recursive:true});
 try{return {scope,run,dir,state:'collecting',...await artifacts(root,p,cfg,env,target),xml:path.join(dir,'jacoco.xml'),exec:path.join(dir,'jacoco.exec'),module:p.module};}catch(cause){return {scope,run,dir,state:'unavailable',gaps:[require('./redact').clean(cause.message)]};}
}
function snapshot(session,p){
 const root=W.checkId(session.scope.workspace).path,mod=path.relative(root,p.modDir).split(path.sep).join('/'),dirs=p.tool==='maven'?[path.join(p.modDir,'target/classes')]:['java','kotlin','groovy'].map(lang=>path.join(p.modDir,'build/classes',lang,'main')),classes=[],gaps=[];fs.mkdirSync(path.join(session.dir,'classes'),{recursive:true});
 for(const dir of dirs)for(const file of walk(dir,'.class')){let c;try{c=classIdentity(file);}catch{continue;}if(!c.source||c.name.split('/').some(n=>!n||n==='.'||n==='..'||/[\\\x00]/.test(n)))continue;
  const candidates=session.scope.files.filter(f=>!f.deleted&&f.changed.length&&(!mod||f.path.startsWith(mod+'/'))&&f.path.endsWith('/'+c.source));
  if(candidates.length!==1){if(candidates.length>1)gaps.push('Ambiguous source mapping: '+c.source);continue;}
  const dest=path.join(session.dir,'classes',c.name+'.class');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);classes.push({name:c.name,path:candidates[0].path,sha256:digest(fs.readFileSync(dest))});
 }
 session.classes=classes;session.gaps=[...(session.gaps||[]),...gaps];return classes;
}
function agentArgument(session){return '-javaagent:'+session.agent+'=destfile='+session.exec+',append=false,includes='+(session.classes||[]).map(c=>c.name.replaceAll('/','.')).join(':');}
function gradleInit(session,p){
 const file=path.join(session.dir,'coverage.gradle'),agent=groovy(session.agent),dest=groovy(session.exec);
 fs.writeFileSync(file,`allprojects { tasks.withType(org.gradle.api.tasks.testing.Test).configureEach { t ->\n  def existing = t.extensions.findByName('jacoco'); if(existing != null) existing.enabled = false\n  maxParallelForks = 1; forkEvery = 0; outputs.upToDateWhen { false }\n  doFirst { jvmArgs '-javaagent:' + ${agent} + '=destfile=' + ${dest} + ',append=true' }\n} }\n`);return file;
}
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/gi,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[e]||String.fromCodePoint(e[2].toLowerCase()==='x'?parseInt(e.slice(3,-1),16):Number(e.slice(2,-1)))));
// Streaming tags: JaCoCo reports are commonly one giant XML line. Never fetch
// external entities/DTDs and never parse the entire report into an object tree.
async function xmlLines(file,scope){
 if(fs.statSync(file).size>256*1024*1024)throw error('JaCoCo report exceeds 256 MiB');
 const sources=new Map(),stack=[],wanted=scope?new Map():null;if(scope)for(const f of scope.files){const key=f.path.replace(/^.*?src\/main\/(?:java|kotlin|groovy)\//,'');if(!wanted.has(key))wanted.set(key,new Set());for(const n of f.changed)wanted.get(key).add(n);}let pending='',pkg='',current=null,currentWanted=null,rootSeen=false,rootEnded=false;
 for await(const chunk of fs.createReadStream(file,{encoding:'utf8',highWaterMark:65536})){
  pending+=chunk;for(;;){const start=pending.indexOf('<');if(start<0){pending='';break;}if(start)pending=pending.slice(start);if(pending.startsWith('<!--')){const end=pending.indexOf('-->');if(end<0)break;pending=pending.slice(end+3);continue;}
   let end=-1,quote=null;for(let i=1;i<pending.length;i++){const c=pending[i];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>'){end=i;break;}}if(end<0)break;
   const tag=pending.slice(1,end);pending=pending.slice(end+1);const name=tag.match(/^\/?[\w:.-]+/)?.[0],attrs={};for(const a of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs))attrs[a[1]]=decode(a[3]);
   if(name&&!tag.startsWith('!')&&!tag.startsWith('?')){if(name.startsWith('/')){if(stack.pop()!==name.slice(1))throw error('Malformed XML nesting');if(name==='/report')rootEnded=true;}else if(!tag.endsWith('/')){if(rootEnded)throw error('Multiple XML roots');if(!stack.length){if(name!=='report')throw error('Expected JaCoCo report');rootSeen=true;}stack.push(name);}}
   if(name==='package')pkg=attrs.name||'';else if(name==='/package')pkg='';else if(name==='sourcefile'){const key=[pkg,attrs.name].filter(Boolean).join('/');if(sources.has(key))throw error('Duplicate JaCoCo source mapping; import one unambiguous module report');current=new Map();sources.set(key,current);currentWanted=wanted?.get(key);if(tag.endsWith('/'))current=null;}
   else if(name==='/sourcefile')current=null;else if(name==='line'&&current){const vals=['nr','mi','ci','mb','cb'].map(k=>Number(attrs[k]));if(vals.some(v=>!Number.isSafeInteger(v)||v<0)||!vals[0])throw error('Invalid JaCoCo line counters');const [nr,mi,ci,mb,cb]=vals;if(!wanted||currentWanted?.has(nr))current.set(nr,{line:nr,missedInstructions:mi,coveredInstructions:ci,missedBranches:mb,coveredBranches:cb});}
  }if(pending.length>1048576)throw error('Oversized XML tag/comment');
 }
 if(pending.trim()||!sources.size||!rootSeen||!rootEnded||stack.length)throw error('Incomplete report or no source mappings');return sources;
}
function evaluate(scope,sources,{verified=false,sourcePaths}={}){
 const files=scope.files.map(f=>{
  const suffix=f.path.replace(/^.*?src\/main\/(?:java|kotlin|groovy)\//,''),mapped=sources.get(suffix),candidates=scope.files.filter(other=>other.path.replace(/^.*?src\/main\/(?:java|kotlin|groovy)\//,'')===suffix),mappedPaths=sourcePaths?candidates.filter(other=>sourcePaths.has(other.path)):[],ambiguous=candidates.length>1&&!(mappedPaths.length===1&&mappedPaths[0].path===f.path);
  const lines=f.changed.map(n=>{const hit=!ambiguous&&mapped?.get(n);return hit?{...hit,source:f.sourceLines?.[n],state:hit.coveredInstructions>0?'covered':'missed'}:{line:n,source:f.sourceLines?.[n],state:f.deleted?'removed':mapped&&!ambiguous?'non-executable':'unknown'};});
  const count=state=>lines.filter(l=>l.state===state).length;return {path:f.path,deleted:!!f.deleted,ranges:f.ranges,lines,counts:{covered:count('covered'),missed:count('missed'),unknown:count('unknown'),nonExecutable:count('non-executable')},mapped:!!mapped&&!ambiguous};
 });
 const summary={covered:0,missed:0,unknown:0,nonExecutable:0,coveredBranches:0,missedBranches:0};for(const f of files){for(const k of ['covered','missed','unknown','nonExecutable'])summary[k]+=f.counts[k];for(const l of f.lines){summary.coveredBranches+=l.coveredBranches||0;summary.missedBranches+=l.missedBranches||0;}}
 const executable=summary.covered+summary.missed,branches=summary.coveredBranches+summary.missedBranches;return {files,summary:{...summary,executable,percent:executable?Math.round(summary.covered/executable*1000)/10:null,branchPercent:branches?Math.round(summary.coveredBranches/branches*1000)/10:null,complete:verified&&summary.unknown===0,fullyCovered:verified&&executable>0&&summary.unknown===0&&summary.missed===0&&summary.missedBranches===0}};
}
async function finish(session,p,cfg,env,target){
 if(!session)return null;
 if(session.state==='no_changes'){const evaluated=evaluate(session.scope,new Map(),{verified:true}),report={...session.scope,...evaluated,id:crypto.randomBytes(12).toString('hex'),state:'no_changes',available:true,testOutcome:session.testOutcome,gaps:[],limits:session.scope.limitations};write(path.join(cache(report.workspace),report.id+'.json'),report);write(path.join(cache(report.workspace),'latest.json'),{id:report.id});return compact(report);}
 if(session.state!=='collecting')return unavailable(session,session.gaps||[]);
 const root=W.checkId(session.scope.workspace).path;
 if(!session.classes)snapshot(session,p);
 const execs=walk(session.dir,'.exec');let gaps=[...(session.gaps||[])];
 if(!execs.length)return unavailable(session,[...gaps,'No JaCoCo execution data. Maven builds must consume argLine; use coverage with mode=fast or configure the project test JVM.']);
 const r=await require('./testrun').exec(cfg.javaHome?path.join(cfg.javaHome,'bin/java'):'java',['-jar',session.cli,'report',...execs,'--classfiles',path.join(session.dir,'classes'),'--xml',session.xml,'--encoding','UTF-8'],{...target,cwd:root,env,timeoutMs:cfg.timeoutMs});
 if(r.code!==0||!fs.existsSync(session.xml))return unavailable(session,[...gaps,'JaCoCo could not analyze the captured bytecode: '+require('./redact').clean(r.out.slice(-1200))]);
 const matched=session.scope.sourceFingerprint===require('./testrun').fingerprint(root,{includeTests:true}),mismatch=/does not match|do not match/i.test(r.out);
 if(!matched)gaps.push('Workspace inputs changed during collection.');if(mismatch)gaps.push('Execution data does not match captured bytecode.');
 const data=evaluate(session.scope,await xmlLines(session.xml,session.scope),{verified:matched&&!mismatch&&!gaps.length,sourcePaths:new Set(session.classes.map(c=>c.path))});
 const report={schema:'dt.change-coverage-report/v1',id:session.run,workspace:session.scope.workspace,base:session.scope.base,sourceFingerprint:session.scope.sourceFingerprint,at:new Date().toISOString(),state:matched&&!mismatch?'measured':'stale',available:true,provenance:'JaCoCo execution data and captured production bytecode; changed source lines only',collector:{engine:'JaCoCo',version:session.version},...data,tests:session.tests,testOutcome:session.testOutcome,bytecode:session.classes,gaps,artifacts:{xml:path.relative(root,session.xml).split(path.sep).join('/'),exec:execs.map(f=>path.relative(root,f).split(path.sep).join('/'))},limits:['A covered line does not prove assertions or business behavior. Partial branches remain uncovered.','Unmapped/ambiguous files remain unknown, never 100%. Deleted lines are not a current executable denominator.']};
 write(path.join(cache(report.workspace),report.id+'.json'),report);write(path.join(cache(report.workspace),'latest.json'),{id:report.id});return compact(report);
}
function unavailable(session,gaps){
 if(!session.scope)return {state:'unavailable',available:false,gaps};
 const r={...session.scope,...evaluate(session.scope,new Map()),id:session.run||crypto.randomBytes(12).toString('hex'),state:'unavailable',available:false,testOutcome:session.testOutcome,gaps};write(path.join(cache(r.workspace),r.id+'.json'),r);write(path.join(cache(r.workspace),'latest.json'),{id:r.id});return compact(r);
}
function load(id,report){W.checkId(id);if(report&&!/^[a-f0-9]{24}$/.test(report))throw error('Invalid coverage report id');let r;try{const key=report||read(path.join(cache(id),'latest.json')).id;r=read(path.join(cache(id),key+'.json'));}catch(cause){if(cause.code==='DT_COVERAGE_ARGUMENT')throw cause;return {workspace:id,available:false,state:'unavailable',gaps:['No retained change coverage. Run test_run with coverage=true.']};}const stale=r.sourceFingerprint!==require('./testrun').fingerprint(W.checkId(id).path,{includeTests:true});return {...r,stale,state:stale?'stale':r.state,summary:{...r.summary,complete:!stale&&r.summary.complete,fullyCovered:!stale&&r.summary.fullyCovered}};}
function compact(report){const view=R.saveView('workspace-coverage',report,{title:'Changed code coverage'});return {id:report.id,workspace:report.workspace,state:report.state,available:report.available,base:report.base,stale:report.stale||false,summary:report.summary,files:report.files.slice(0,20).map(f=>({path:f.path,counts:f.counts,uncovered:f.lines.filter(l=>['missed','unknown'].includes(l.state)||l.missedBranches).slice(0,8).map(l=>({...l,source:l.source?.slice(0,180)})),moreUncovered:Math.max(0,f.lines.filter(l=>['missed','unknown'].includes(l.state)||l.missedBranches).length-8)})),moreFiles:Math.max(0,report.files.length-20),gaps:report.gaps,artifacts:report.artifacts,view};}
function get(id,{report,file}={}){const r=load(id,report);if(!r.id)return r;if(file){const f=r.files.find(f=>f.path===file);if(!f)throw error('File is outside this coverage report');return {...compact(r),files:[f]};}return compact(r);}
module.exports={plan,begin,finish,snapshot,agentArgument,gradleInit,get,load,evaluate,xmlLines,classIdentity,ranges};
