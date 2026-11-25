const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../recipes/postgres-snapshot/snapshot');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-snapshot-recipe-'));
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
const opts=name=>S.parse(['--image','local/snapshot:test','--out',path.join(home,name)]);
test('plan needs no database/Docker and does not create files',async()=>{let called=false;const o={...opts('plan'),plan:true};const p=await S.run(o,{command:()=>{called=true;}});assert.equal(called,false);assert.equal(p.executed,false);assert.equal(p.push,false);assert.equal(fs.existsSync(o.out),false);assert.match(p.archive,/image.tar$/);});
test('dump/build/export pipeline passes no credentials as arguments or image build environment',async()=>{
 const o=opts('success'),commands=[],password='fixture-unique-password';
 const r=await S.run(o,{environment:{DATABASE_URL:'postgresql://source:'+password+'@db.example.test:5432/orders?sslmode=require',PATH:process.env.PATH},command:async(cmd,args,{env})=>{
  commands.push({cmd,args,env});assert(!JSON.stringify(args).includes(password));
  if(args[0]==='run'){assert.equal(env.PGPASSWORD,password);assert.equal(env.PGSSLMODE,'require');fs.writeFileSync(path.join(o.out,'database.dump'),'PGDMP fixture only');}
  if(args[0]==='build'){assert.equal(env.PGPASSWORD,undefined);assert.equal(env.DATABASE_URL,undefined);assert(!fs.readFileSync(path.join(o.out,'Dockerfile'),'utf8').includes(password));}
  if(args[0]==='image')fs.writeFileSync(path.join(o.out,'image.tar'),'SIMULATED ARCHIVE, NOT A DOCKER IMAGE');
 }});
 assert.deepEqual(commands.map(c=>c.args[0]),['run','build','image']);assert.equal(r.state,'exported');assert.match(r.dump.sha256,/^[a-f0-9]{64}$/);assert.match(r.export.sha256,/^[a-f0-9]{64}$/);assert(!fs.readFileSync(path.join(o.out,'manifest.json'),'utf8').includes(password));
 await assert.rejects(S.run(o,{environment:{DATABASE_URL:'postgres://u:p@host/db'},command:()=>{throw Error('must not execute');}}),/EEXIST/);
});
test('failed dump stops before build and redacts failure; prepare-only never builds',async()=>{
 const o=opts('failure');let count=0;await assert.rejects(S.run(o,{environment:{DATABASE_URL:'postgres://u:secret-value@host/db'},command:async()=>{count++;throw Error('failed secret-value');}}),/\[redacted\]/);assert.equal(count,1);assert.equal(JSON.parse(fs.readFileSync(path.join(o.out,'manifest.json'))).state,'failed');
 const prepared={...opts('prepared'),prepareOnly:true};const r=await S.run(prepared,{environment:{DATABASE_URL:'postgres://u:p@host/db'},command:async(cmd,args)=>{assert.equal(args[0],'run');fs.writeFileSync(path.join(prepared.out,'database.dump'),'PGDMP fixture');}});assert.equal(r.state,'prepared');assert.equal(fs.existsSync(path.join(prepared.out,'image.tar')),false);
});
test('generated image restores at build time, exports only seed cluster, and honors Testcontainers credentials at startup',()=>{
 const files=S.artifacts(opts('unused')),docker=files.Dockerfile,entry=files['snapshot-entrypoint.sh'];assert.equal((docker.match(/^FROM /gm)||[]).length,2);assert.match(docker,/pg_restore.*--exit-on-error/);assert.match(docker,/COPY --from=seed/);assert.match(docker,/listen_addresses/);assert.match(entry,/POSTGRES_PASSWORD/);assert.match(entry,/POSTGRES_USER/);assert.match(entry,/POSTGRES_DB/);assert.match(entry,/:\x27password\x27/);assert.match(entry,/\.dt-snapshot-initializing/);assert.equal(files['.dockerignore'].includes('!manifest.json'),false);
 for(const args of [['--image','--bad','--out','x'],['--image','bad image','--out','x'],['--image','ok','--out','x','--env','dev']])assert.throws(()=>S.parse(args));
});
