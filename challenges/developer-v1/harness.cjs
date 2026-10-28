const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const DT=process.env.DT_CHALLENGE_TOOL_ROOT||path.resolve(__dirname,'../..');
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n');};
function git(cwd,...args){return execFileSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Challenge Author',GIT_AUTHOR_EMAIL:'author@example.invalid',GIT_COMMITTER_NAME:'Challenge Author',GIT_COMMITTER_EMAIL:'author@example.invalid'}}).trim();}
async function prepare(dest){
 if(fs.existsSync(dest)&&fs.readdirSync(dest).length)throw new Error('destination must be empty');
 if(dest.startsWith(__dirname+path.sep))throw new Error('destination must be outside public pack');
 fs.cpSync(__dirname,dest,{recursive:true});
 const home=path.join(dest,'dt-home');process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';
 for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_GIT_DIR','DT_REPOS_DIR'])delete process.env[k];
 write(path.join(home,'config.json'),{envs:{dev:{}},passports:{internalGroups:['com.lumen']},tests:{compileCheck:false,compileFix:false,pgUrl:process.env.DT_TEST_PG_URL||undefined,maven:process.env.DT_TEST_MAVEN||undefined,javaHome:process.env.DT_JAVA_HOME||process.env.JAVA_HOME||undefined}});
 const repos={};for(const id of ['C01','C02','C03','C04','C05','C06','C07','C08']){
  const entries=id==='C03'?[['LIB/common-primitives','LIB/common-primitives'],['FIN/ledger-service','FIN/ledger-service']]:[[`CASES/${id.toLowerCase()}`,'.']];
  for(const [key,sub]of entries){const dir=path.resolve(dest,id,sub);git(dir,'init','-q','-b','main');git(dir,'add','.');git(dir,'commit','-qm','Public incident input');if(id==='C03'&&key.startsWith('LIB/'))git(dir,'tag','v2.4.1');repos[key]=dir;}
 }
 const CI=require(path.join(DT,'lib/codeindex'));
 for(const[key,dir]of Object.entries(repos)){const[project,repo]=key.split('/');const sha=git(dir,'rev-parse','HEAD');CI.build(dir,key,{project,repo,ref:'main',sha});}
 const hashes={};for(const c of require('./cases.json')){
 const files=fs.readdirSync(path.join(dest,c.id),{recursive:true}).filter(f=>!f.startsWith('.git')&&fs.statSync(path.join(dest,c.id,f)).isFile()).sort();
 hashes[c.id]=crypto.createHash('sha256').update(files.map(f=>f+'\0'+fs.readFileSync(path.join(dest,c.id,f))).join('\0')).digest('hex');}
 write(path.join(dest,'setup.json'),{version:1,dtRoot:DT,home,repos,hashes});console.log(JSON.stringify({prepared:dest,home,repos,hashes},null,2));
}
async function serve(dest){const s=require(path.join(dest,'setup.json'));const bb=await require(path.join(DT,'test/fake-bitbucket')).start({repos:s.repos});const cfg=JSON.parse(fs.readFileSync(path.join(s.home,'config.json')));cfg.bitbucket={url:bb.url,token:bb.token};write(path.join(s.home,'config.json'),cfg);console.log(JSON.stringify({home:s.home,bitbucket:bb.url,token:bb.token,repos:s.repos},null,2));process.on('SIGTERM',()=>{bb.close();process.exit(0);});}
(async()=>{const dest=path.resolve(process.argv[3]||'');if(process.argv[2]==='prepare')await prepare(dest);else if(process.argv[2]==='serve')await serve(dest);else throw new Error('use prepare|serve <directory>');})().catch(e=>{console.error(e.stack);process.exitCode=1;});
