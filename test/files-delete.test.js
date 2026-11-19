const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-delete-'));process.env.DT_HOME=home;process.env.DT_RATE_PER_SEC='0';process.env.DT_LOG='quiet';
for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_REPOS_DIR','DT_TOOLS'])delete process.env[k];
const root=path.join(home,'files'),remote=path.join(home,'remote');fs.mkdirSync(root);fs.mkdirSync(path.join(remote,'upload'),{recursive:true});let sftp;
const F=require('../lib/files'),C=require('../lib/context'),T=require('../lib/tools'),W=require('../lib/workspace'),A=require('../lib/access');
test.before(async()=>{sftp=await require('./sftp-server').start({root:remote,user:'test',password:'test'});fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},scripts:{starters:false},files:{local:{type:'local',path:'files',write:true},readonly:{type:'local',path:'files'},remote:{type:'sftp',host:'127.0.0.1',port:sftp.port,user:'test',password:'test',root:'/upload',write:true}}}));require('../lib/config').reload();});
test.after(async()=>{await sftp?.close();await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('model deletes context progress notes through direct tools and the nearby files helper',async()=>{
 const c=C.open({title:'Disposable notes'}),written=C.write({id:c.id,path:'notes/progress-notes.md',content:'finished scratch work',summary:'Temporary progress notes'});
 const result=await T.call('files_delete',{store:c.store,path:written.path,expected_revision:written.revision});assert.equal(result.deleted,true);assert.ok(!C.get(c.id).files.some(f=>f.path===written.path));assert.equal(C.search({id:c.id,query:'finished scratch'}).hits.length,0);
 const direct=C.write({id:c.id,path:'notes/other.md',content:'delete me'});assert.equal((await T.call('context_delete_file',{id:c.id,path:direct.path,expected_revision:direct.revision})).removed,direct.path);
 const code=await T.call('code',{context:c.id,code:"await files.write('scratch.md','temporary');await files.remove('scratch.md');await files.write('scratch.md','new note');return (await files.read('scratch.md'));"});assert.equal(code.ok,true,code.error);assert.equal(code.returned,'new note');
 const fresh=await T.call('code',{context:c.id,code:"return await files.remove('scratch.md');"});assert.equal(fresh.ok,true,fresh.error);assert.equal(fresh.returned.removed,'scratch.md');
 const stale=await T.call('code',{context:c.id,code:"await files.write('stale.md','old');await tools.context_write({id:files.id,path:'stale.md',content:'newer'});await files.remove('stale.md');"});assert.equal(stale.ok,false);assert.match(stale.error,/changed/);assert.equal(C.read({id:c.id,path:'stale.md'}).content,'newer');
 for(const profile of ['direct','tester']){const names=(await T.schemas({profile})).map(t=>t.name);for(const name of ['files_delete','context_delete_file','workspace_delete'])assert.ok(names.includes(name),profile+' '+name);}
 const discovery=await T.call('tool_search',{query:'delete temporary progress notes'});assert.match(JSON.stringify(discovery),/files_delete|workspace_delete|context_delete_file/);
});
test('local and SFTP stores return revisions on write and support explicit one-file deletion',async()=>{
 for(const store of ['local','remote']){const written=await F.write(store,'notes/progress.md','scratch '+store);assert.match(written.revision,/^[a-f0-9]{64}$/);const result=await T.call('files_delete',{store,path:written.path,expected_revision:written.revision});assert.equal(result.deleted,true);assert.equal(result.bytes,Buffer.byteLength('scratch '+store));await assert.rejects(F.read(store,written.path));}
});
test('HTTP and MCP callers can delete created notes through the shared registry',async()=>{
 const server=require('../server').start({port:0});await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,headers={'content-type':'application/json','x-dt-story':'delete-http'};
 try{for(const transport of ['http','mcp']){
  const note=await A.run({storyId:'delete-http'},()=>F.write('local',transport+'.md','temporary'));
  const args={store:'local',path:note.path,expected_revision:note.revision},response=await fetch(base+(transport==='http'?'/api/tool/files_delete':'/mcp'),{method:'POST',headers,body:JSON.stringify(transport==='http'?args:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'files_delete',arguments:args}})});assert.equal(response.status,200);const body=await response.json(),result=transport==='http'?body.result:JSON.parse(body.result.content[0].text);assert.equal(result.deleted,true);await A.run({storyId:'delete-http'},()=>assert.rejects(F.read('local',note.path)));
 }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('stale revisions, read-only stores, directories, symlinks and escapes preserve files',async()=>{
 const written=await F.write('local','keep.txt','old');await F.write('local','keep.txt','new',{overwrite:true});await assert.rejects(F.remove({store:'local',path:'keep.txt',expected_revision:written.revision}),/changed/);
 const current=await F.read('local','keep.txt');await assert.rejects(F.remove({store:'readonly',path:'keep.txt',expected_revision:current.revision}),/read-only/);
 await assert.rejects(F.remove({store:'local',path:'keep.txt'}),/expected_revision/);await assert.rejects(F.remove({store:'local',path:'',expected_revision:current.revision}),/one file/);await assert.rejects(F.remove({store:'local',path:'../keep.txt',expected_revision:current.revision}),/leaves/);
 fs.symlinkSync(path.join(root,'keep.txt'),path.join(root,'link.txt'));await assert.rejects(F.remove({store:'local',path:'link.txt',expected_revision:current.revision}),/symbolic/);await assert.rejects(F.remove({store:'local',path:'notes',expected_revision:current.revision}),/regular file/);
 assert.equal((await F.read('local','keep.txt')).text,'new');assert.equal(fs.existsSync(path.join(root,'link.txt')),true);
 const c=C.open({title:'Managed metadata'});await assert.rejects(F.remove({store:c.store,path:'index.json',expected_revision:current.revision}),/managed/);
});
test('source replacement during local removal is restored; failed restoration reports retained recovery bytes',async t=>{
 const first=await F.write('local','racing.txt','old'),rename=fs.renameSync;
 t.mock.method(fs,'renameSync',function(from,to){rename.call(fs,from,to);if(path.basename(to).startsWith('.dt-delete-'))fs.writeFileSync(to,'replacement');});
 await assert.rejects(F.remove({store:'local',path:first.path,expected_revision:first.revision}),/changed during deletion/);assert.equal((await F.read('local','racing.txt')).text,'replacement');t.mock.restoreAll();
 const second=await F.write('local','recovery.txt','original'),unlink=fs.unlinkSync;let blocked=false;
 t.mock.method(fs,'unlinkSync',function(file){if(!blocked&&path.basename(file).startsWith('.dt-delete-')){blocked=true;fs.writeFileSync(path.join(root,'recovery.txt'),'replacement');throw Error('unlink failed');}return unlink.call(fs,file);});
 const result=await F.remove({store:'local',path:second.path,expected_revision:second.revision});assert.equal(result.deleted,false);assert.ok(result.recovery);assert.equal(fs.readFileSync(path.join(root,result.recovery.path),'utf8'),'original');assert.equal((await F.read('local','recovery.txt')).text,'replacement');assert.equal(require('../lib/call-outcome').classify('files_delete',result).failed,true);
});
test('deletion remains in the authenticated context/store scope',async()=>{
 const scope=principalId=>({principalId,storyId:'notes',multiUser:true,role:'user'});let c,note;
 await A.run(scope('alice'),async()=>{c=C.open({title:'Alice notes'});note=C.write({id:c.id,path:'private.md',content:'alice'});await F.write('local','private.md','alice');});
 await A.run(scope('bob'),async()=>{await assert.rejects(T.call('files_delete',{store:c.store,path:note.path,expected_revision:note.revision}));await assert.rejects(F.remove({store:'local',path:'private.md',expected_revision:note.revision}));});
 await A.run(scope('alice'),async()=>{assert.equal(C.read({id:c.id,path:note.path}).content,'alice');assert.equal((await F.read('local','private.md')).text,'alice');});
});
test('workspace deletion invalidates indexes, preserves newer edits and exports tracked deletions',async t=>{
 const seed=path.join(home,'seed');fs.mkdirSync(seed);const git=(...args)=>execFileSync('git',args,{cwd:seed,encoding:'utf8',stdio:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'}}).trim();
 fs.writeFileSync(path.join(seed,'App.java'),'class DisposableApp {}\n');fs.writeFileSync(path.join(seed,'progress.md'),'tracked progress\nmore lines\n');git('init','-q','-b','main');git('add','.');git('commit','-qm','initial');
 const w=await W.open({project:'TEST',repo:'delete-notes',url:'file://'+seed}),m=W.checkId(w.id),initial=W.read(w.id,'progress.md',{from:1,to:1});assert.match(initial.revision,/^[a-f0-9]{64}$/);
 const note=W.write(w.id,'scratch.md',{content:'temporary'});assert.equal((await T.call('workspace_delete',{workspace:w.id,path:note.path,expected_revision:note.revision})).deleted,true);assert.equal(fs.existsSync(path.join(m.path,note.path)),false);
 W.write(w.id,'progress.md',{content:'newer progress'});await assert.rejects(T.call('workspace_delete',{workspace:w.id,path:'progress.md',expected_revision:initial.revision}),/changed/);assert.equal(W.read(w.id,'progress.md').text.includes('newer progress'),true);
 const current=W.read(w.id,'progress.md');W.remove(w.id,'progress.md',{expected_revision:current.revision});const source=W.read(w.id,'App.java');W.remove(w.id,'App.java',{expected_revision:source.revision});assert.equal(W.checkId(w.id).dirty,true);W.index(w.id);assert.equal(W.checkId(w.id).dirty,false);assert.equal(require('../lib/codeindex').grep(['work/'+w.id],'DisposableApp').hits.length,0);
 const patch=await W.patch(w.id);assert.ok(patch.files.some(f=>f.path==='progress.md'&&f.status==='deleted'));assert.match(patch.patch,/deleted file mode/);assert.equal(git('show','HEAD:progress.md'),'tracked progress\nmore lines');
 const keep=W.write(w.id,'keep.txt',{content:'keep'});fs.symlinkSync(path.join(m.path,'keep.txt'),path.join(m.path,'link.txt'));
 for(const invalid of ['.','../seed/App.java','/keep.txt','.git/config','.GIT/config','link.txt'])assert.throws(()=>W.remove(w.id,invalid,{expected_revision:keep.revision}));assert.throws(()=>W.remove(w.id,'keep.txt'),/expected_revision/);assert.equal(W.read(w.id,'keep.txt').text.includes('keep'),true);
 t.mock.method(require('../lib/javacheck'),'check',async(id)=>{W.write(id,'Draft.java',{content:'class Fixed {}\n'});return {fixed:[{file:'Draft.java',why:'synthetic automatic edit'}]};});
 const fixed=await T.call('workspace_write',{workspace:w.id,path:'Draft.java',content:'class Draft {}\n'});assert.equal(fixed.revision,W.read(w.id,'Draft.java').revision);assert.equal((await T.call('workspace_delete',{workspace:w.id,path:'Draft.java',expected_revision:fixed.revision})).deleted,true);
 await A.run({principalId:'bob',storyId:'other',multiUser:true},()=>assert.rejects(T.call('workspace_delete',{workspace:w.id,path:'keep.txt',expected_revision:keep.revision})));assert.equal(W.read(w.id,'keep.txt').text.includes('keep'),true);
});
