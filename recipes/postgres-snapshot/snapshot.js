#!/usr/bin/env node
// On-demand utility. No daemon, no registry push, no source database writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function parse(argv){
 const options={baseImage:'postgres:16-bookworm',urlEnv:'DATABASE_URL',network:'bridge'},names={'env':'env','db':'db','base-image':'baseImage','image':'image','out':'out','url-env':'urlEnv','network':'network'},flags={'plan':'plan','prepare-only':'prepareOnly','schema-only':'schemaOnly','help':'help'};
 for(let i=0;i<argv.length;i++){const key=argv[i].replace(/^--/,'');if(!argv[i].startsWith('--')||!(Object.hasOwn(names,key)||Object.hasOwn(flags,key)))throw Error('Unknown option: '+argv[i]);if(flags[key])options[flags[key]]=true;else{if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value: '+argv[i]);options[names[key]]=argv[++i];}}
 if(options.help)return options;
 const image=/^[a-z0-9][a-z0-9./_:@-]{0,250}$/;
 if(!image.test(options.baseImage)||!image.test(options.image||''))throw Error('Give --image and a valid --base-image (no whitespace or command flags)');
 if(!options.out||/[,\n\r\0]/.test(options.out))throw Error('Give a new --out directory without commas/control characters');
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.urlEnv)||!/[A-Za-z0-9]/.test(options.network)||/[^A-Za-z0-9_.-]/.test(options.network))throw Error('Invalid URL variable or Docker network');
 if(!!options.env!==!!options.db)throw Error('--env and --db must be supplied together');
 return {...options,out:path.resolve(options.out)};
}
function artifacts(o){return {'Dockerfile':fs.readFileSync(path.join(__dirname,'Dockerfile.template'),'utf8').replaceAll('__BASE_IMAGE__',()=>o.baseImage),'snapshot-entrypoint.sh':fs.readFileSync(path.join(__dirname,'snapshot-entrypoint.sh'),'utf8'),'.dockerignore':'*\n!Dockerfile\n!database.dump\n!snapshot-entrypoint.sh\n'};}
function plan(o){return {protocol:'dt.postgres-snapshot/v1',source:o.env?{environment:o.env,database:o.db}:{connectionVariable:o.urlEnv},image:o.image,baseImage:o.baseImage,out:o.out,stages:o.prepareOnly?['dump','write-build-context']:['dump','write-build-context','build','export'],archive:o.prepareOnly?null:path.join(o.out,'image.tar'),schemaOnly:!!o.schemaOnly,push:false,executed:false};}
function connection(o,environment=process.env){
 let url;if(o.env){const config=require('../../lib/config'),env=config.getEnv(o.env);url=env.pg?.[o.db];if(!url)throw Error('Configured environment/database is unavailable');}else url=environment[o.urlEnv];
 if(!url)throw Error('Set '+o.urlEnv+' or select --env and --db');
 const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('Expected a PostgreSQL connection URL');
 const result={PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1))||'postgres',PGUSER:decodeURIComponent(u.username)||'postgres',PGPASSWORD:decodeURIComponent(u.password),PGCONNECT_TIMEOUT:'15'};
 for(const [key,target]of [['sslmode','PGSSLMODE'],['sslrootcert','PGSSLROOTCERT']])if(u.searchParams.has(key)){if(key==='sslrootcert')throw Error('Use a Docker-accessible certificate setup; host sslrootcert paths are not mounted by this utility');result[target]=u.searchParams.get(key);}
 return result;
}
function execute(cmd,args,{env,timeoutMs=1800000}={}){return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{env,stdio:['ignore','ignore','pipe']}),parts=[];let size=0,killed=false;const timer=setTimeout(()=>{killed=true;child.kill('SIGTERM');},timeoutMs);timer.unref();child.stderr.on('data',b=>{size+=b.length;parts.push(b);while(size>8192&&parts.length>1)size-=parts.shift().length;});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);if(code===0&&!killed)resolve();else reject(Error(cmd+' failed'+(killed?' (timeout)':' (exit '+code+')')+': '+Buffer.concat(parts).toString().slice(-8192)));});});}
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function run(o,{command=execute,environment=process.env}={}){
 const record=plan(o);if(o.plan)return record;
 // Validate the source before creating output. Refuse to overwrite an existing artifact.
 const pg=connection(o,environment),env={...environment,...pg};
 fs.mkdirSync(path.dirname(o.out),{recursive:true,mode:0o700});
 fs.mkdirSync(o.out,{recursive:false,mode:0o700});
 fs.writeFileSync(path.join(o.out,'.gitignore'),'*\n',{mode:0o600});
 const manifest=path.join(o.out,'manifest.json'),save=()=>fs.writeFileSync(manifest,JSON.stringify(record,null,2)+'\n',{mode:0o600});
 try{
  record.executed=true;record.state='dumping';save();
  const user=typeof process.getuid==='function'?['--user',process.getuid()+':'+process.getgid()]:[];
  await command('docker',['run','--rm',...user,'--network',o.network,'--mount','type=bind,src='+o.out+',dst=/snapshot',...Object.keys(pg).flatMap(k=>['--env',k]),o.baseImage,'pg_dump','--no-owner','--no-privileges','--format=custom',...(o.schemaOnly?['--schema-only']:[]),'--file=/snapshot/database.dump'],{env});
  record.dump={file:'database.dump',bytes:fs.statSync(path.join(o.out,'database.dump')).size,sha256:await digest(path.join(o.out,'database.dump'))};
  if(!record.dump.bytes)throw Error('Dump is empty');
  for(const [name,text]of Object.entries(artifacts(o)))fs.writeFileSync(path.join(o.out,name),text,{mode:name.endsWith('.sh')?0o700:0o600});
  if(o.prepareOnly){record.state='prepared';save();return record;}
  const buildEnv={...environment};delete buildEnv[o.urlEnv];for(const key of Object.keys(pg))delete buildEnv[key];
  record.state='building';save();await command('docker',['build','--tag',o.image,o.out],{env:buildEnv});
  record.state='exporting';save();await command('docker',['image','save','--output',path.join(o.out,'image.tar'),o.image],{env:buildEnv});
  record.export={file:'image.tar',bytes:fs.statSync(path.join(o.out,'image.tar')).size,sha256:await digest(path.join(o.out,'image.tar'))};
  if(!record.export.bytes)throw Error('Image archive is empty');record.state='exported';save();return record;
 }catch(error){record.state='failed';record.error=String(error.message);if(pg.PGPASSWORD)record.error=record.error.split(pg.PGPASSWORD).join('[redacted]');save();throw Error(record.error);}
}
module.exports={parse,plan,artifacts,connection,run};
if(require.main===module)(async()=>{const o=parse(process.argv.slice(2));if(o.help)return console.log('snapshot.js --image local/db-snapshot:tag --out NEW_DIRECTORY [--env dev --db orders | --url-env DATABASE_URL] [--base-image postgres:16-bookworm] [--network host] [--schema-only] [--prepare-only] [--plan]');console.log(JSON.stringify(await run(o),null,2));})().catch(e=>{console.error(e.message);process.exitCode=1;});
