// Search existing local source without fetching or building an index. Indexed
// revisions keep their native trigram search; cold checkouts use optional rg.
const fs = require('node:fs'), path = require('node:path');
const CI = require('./codeindex'), E = require('./execution');
const backends = new Map();
const invalid = message => Object.assign(new Error(message), {code:'DT_ARGUMENT_INVALID'});
const selectors = value => [].concat(value || []).flatMap(v => String(v).split(',')).map(v=>v.trim()).filter(Boolean);
const matches = (spec, source) => !spec.length || spec.some(p => {
  const re = new RegExp('^'+p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i');
  return re.test(source.key)||re.test(source.repo)||re.test(source.workspace||'');
});
async function sources(selector) {
  const spec=selectors(selector), keys=CI.select(selector), indexed=[], raw=[];
  for(const key of keys){
    if(key.startsWith('work/')){const w=require('./workspace').checkId(key.slice(5));if(w.dirty){raw.push({key,root:w.path,repo:w.repo,workspace:w.id});continue;}}
    indexed.push(key);
  }
  // A requested immutable revision must never fall back to a mutable checkout.
  const rawSpec=spec.filter(p=>!p.includes('@'));
  if(spec.length&&!rawSpec.length)return {indexed,raw};
  const repos=require('./config').PATHS.repos;
  let projects=[];try{projects=await fs.promises.readdir(repos,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const project of projects){
    if(!project.isDirectory()||project.name.startsWith('.')||project.name.startsWith('_'))continue;
    for(const repo of await fs.promises.readdir(path.join(repos,project.name),{withFileTypes:true})){
      if(!repo.isDirectory()||repo.name.startsWith('.'))continue;
      const key=`${project.name}/${repo.name}`,source={key,repo:repo.name,root:path.join(repos,project.name,repo.name)};
      if(matches(rawSpec,source)&&!indexed.includes(key))raw.push(source);
    }
  }
  if(spec.length)for(const w of require('./workspace').list()){
    const meta=require('./workspace').checkId(w.id),source={key:'work/'+w.id,repo:meta.repo,workspace:w.id,root:meta.path};
    if(w.exists&&matches(rawSpec,source)&&!indexed.includes(source.key)&&!raw.some(s=>s.key===source.key))raw.push(source);
  }
  return {indexed,raw:raw.sort((a,b)=>a.key.localeCompare(b.key))};
}
function candidatePaths(root,pattern,{regex,ignoreCase,timeMs}) {
  const command=process.env.DT_RG||'rg';
  const backend = backends.get(command) || require('./state-machine').create(require('./lifecycles').searchBackend); backends.set(command, backend);
  if(backend.is('unavailable'))return Promise.resolve(null);
  // JS regex syntax is preserved by using rg only to enumerate files for regex
  // queries; literal ASCII searches also get rg's native content prefilter.
  const prefilter=!regex&&!/[\r\n\x80-\uffff]/.test(pattern);
  const args=['--null','--no-ignore','--hidden','--glob','!**/.*/**'];
  for(const dir of CI.SKIP_DIRS)args.push('--glob',`!**/${dir}/**`);
  if(prefilter){args.push('--files-with-matches','--fixed-strings','--max-filesize','1M');if(ignoreCase)args.push('--ignore-case');args.push('-e',pattern);}else args.push('--files');
  args.push('--','.');
  return new Promise((resolve,reject)=>{
    E.check();let buffer='',bytes=0,truncated=false,paths=[],errorText='';const decoder=new(require('node:string_decoder').StringDecoder)('utf8');
    const tree=require('./process-tree'),child=tree.spawnTree(command,args,{cwd:root,stdio:['ignore','pipe','pipe']});
    let stopping;const signal=E.signal(),abort=()=>stopping||(stopping=tree.stop(child,500)),release=E.resource(abort);
    const timer=setTimeout(()=>{truncated=true;abort();},timeMs);
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>2*1024*1024){truncated=true;abort();return;}
      buffer+=decoder.write(chunk);let n;while((n=buffer.indexOf('\0'))>=0){paths.push(buffer.slice(0,n).replace(/^\.\//,''));buffer=buffer.slice(n+1);}
    });
    child.stderr.on('data',chunk=>errorText=(errorText+chunk).slice(-1000));
    child.on('error',error=>{if(error.code==='ENOENT'){backend.to('unavailable');resolve(null);}else reject(error);});
    child.on('close',(code)=>{
      clearTimeout(timer);release();signal?.removeEventListener('abort',abort);
      if(signal?.aborted)return reject(E.abortError(signal.reason));
      if (!backend.terminal) backend.to('available');
      if(code!==0&&code!==1&&!truncated)return reject(new Error('ripgrep failed: '+errorText));
      resolve({paths:paths.sort(),backend:'ripgrep',truncated,prefilter});
    });
  });
}
async function nativePaths(root,deadline) {
  const paths=[];let truncated=false;
  async function visit(dir){
    E.check();if(Date.now()>deadline||paths.length>=20000){truncated=true;return;}
    for(const entry of await fs.promises.readdir(path.join(root,dir),{withFileTypes:true})){
      if(entry.isDirectory()){if(!entry.name.startsWith('.')&&!CI.SKIP_DIRS.has(entry.name))await visit(path.join(dir,entry.name));}
      else if(entry.isFile()&&CI.TEXT.test(entry.name))paths.push(path.join(dir,entry.name).split(path.sep).join('/'));
      if(truncated)break;
    }
  }
  await visit('');return {paths:paths.sort(),backend:'native-scan',truncated};
}
async function scan(source,pattern,options){
  const deadline=options.deadline;
  let found=await candidatePaths(source.root,pattern,{...options,timeMs:Math.max(1,deadline-Date.now())});
  found||=await nativePaths(source.root,deadline);
  if(options.regex)return require('./isolate').exec('codeSearch','scanPaths',[source,pattern,options,found]);
  return scanPaths(source,pattern,options,found);
}
async function scanPaths(source,pattern,options,found){
  const deadline=options.deadline,re=options.regex?new RegExp(pattern,options.ignoreCase?'i':''):new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),options.ignoreCase?'i':'');
  const pathRe=options.glob?CI.globRe(options.glob):null;
  const hits=[];let scanned=0,bytes=0,files=0,truncated=found.truncated;
  for(const rel of found.paths){
    E.check();if(Date.now()>deadline||bytes>=64*1024*1024){truncated=true;break;}
    if(!CI.TEXT.test(rel)||(pathRe&&!pathRe.test(rel))||(!options.tests&&/(^|\/)src\/(test|it)\//.test(rel)))continue;
    if(rel.split(/[\\/]/).some(p=>p==='..'))continue;
    let text;
    try{const handle=await fs.promises.open(path.join(source.root,rel),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const stat=await handle.stat();if(!stat.isFile()||stat.size>CI.MAX_FILE)continue;bytes+=stat.size;text=await handle.readFile('utf8');}finally{await handle.close();}}catch(e){if(['ENOENT','ELOOP','EACCES'].includes(e.code))continue;throw e;}
    scanned++;const lines=text.split('\n');let count=0;
    for(let line=0;line<lines.length;line++)if(re.test(lines[line])){
      hits.push({repo:source.key,path:rel,line:line+1,text:lines[line].trim().slice(0,300),...(options.context?{context:lines.slice(Math.max(0,line-options.context),line+options.context+1).join('\n').slice(0,8000)}:{})});
      count++;if(hits.length>=options.limit||count>=options.limit)break;
    }
    if(!count&&options.regex&&/\\n|\[\\s|[\r\n]/.test(pattern)&&new RegExp(re.source,re.flags+'m').test(text)){hits.push({repo:source.key,path:rel,line:0,text:'(match spans lines)'});count++;}
    if(count)files++;
    if(hits.length>=options.limit){truncated=true;break;}
  }
  return {hits,files,scanned,candidates:found.paths.length,truncated,backend:found.backend};
}
function indexed(keys,pattern,options){return CI.grep(keys,pattern,options);}
async function searchImpl({repo,repos,pattern,regex=false,ignore_case=true,glob,context=0,limit=100,tests=true}){
  if(!pattern)throw invalid('pattern is empty');
  if(repo&&repos&&repo!==repos)throw invalid('Use repo for one repository or repos for multiple selectors');
  if(repo&&/[,?*]/.test(repo))throw invalid('repo selects one repository; use repos for globs/multiple repositories');
  let selector=repo||repos;
  if(repo&&!repo.includes('/')&&!repo.includes('@')){const passport=require('./passport').load(repo);if(passport?.repo?.project&&passport.repo.repo)selector=typeof passport.codeIndex==='string'&&CI.load(passport.codeIndex)?passport.codeIndex:`${passport.repo.project}/${passport.repo.repo}`;}
  for(const value of selectors(selector))if(!/[?*]/.test(value)&&value.includes('/'))CI.keyDir(value);
  const options={regex,ignoreCase:ignore_case!==false,glob,context:Math.max(0,Math.min(context||0,10)),limit:Math.max(1,Math.min(limit||100,2000)),tests:tests!==false,perFile:Math.max(1,Math.min(limit||100,2000))};
  if(regex)new RegExp(pattern,options.ignoreCase?'i':'');
  const selected=await sources(selector);if(repo&&selected.indexed.length+selected.raw.length>1)throw invalid('Repository is ambiguous; use PROJECT/repo: '+[...selected.indexed,...selected.raw.map(s=>s.key)].slice(0,20).join(', '));
  const started=Date.now(),deadline=Date.now()+10000,out={hits:[],files:0,scanned:0,candidates:0,truncated:false,backends:[]};
  const add=r=>{out.hits.push(...r.hits);for(const field of ['files','scanned','candidates'])out[field]+=r[field];out.truncated||=r.truncated;out.backends.push(r.backend||'trigram');if(r.plan)out.plan=r.plan;};
  if(selected.indexed.length)add(await require('./isolate').exec('codeSearch','indexed',[selected.indexed,pattern,options]));
  for(const source of selected.raw){if(Date.now()>deadline||out.hits.length>=options.limit){out.truncated=true;break;}add(await scan(source,pattern,{...options,limit:options.limit-out.hits.length,deadline}));}
  return {...out,backends:[...new Set(out.backends)],ms:Date.now()-started,sources:[...selected.indexed,...selected.raw.map(s=>s.key)],unindexed:selected.raw.map(s=>s.key)};
}
function search(args){return E.run({kind:'code-search',signal:AbortSignal.timeout(10000)},()=>searchImpl(args));}
module.exports={search,indexed,scanPaths};
