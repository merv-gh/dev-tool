const test=require('node:test'),assert=require('node:assert/strict'),T=require('../lib/task-context');
test('compaction retains complete tool groups and defaults to manual',()=>{
 const messages=[{role:'user',content:'goal'},{role:'assistant',tool_calls:[{id:'a'}]},{role:'tool',tool_call_id:'a',content:'one'},{role:'tool',tool_call_id:'b',content:'two'},{role:'assistant',content:'done'}];
 for(const budget of [0,40,100,200,1000]){const {head,tail}=T.prefix(messages,budget);assert.deepEqual([...head,...tail],messages);assert.notEqual(tail[0]?.role,'tool');}
 assert.equal(T.limits({}).automatic,false);assert.equal(T.limits({compactionMode:'auto'}).automatic,true);assert.equal(T.limits({compactionMode:'auto',compaction:false}).automatic,false);
});
test('transient model retries are bounded, jittered and respect Retry-After',()=>{
 for(const statusCode of [408,429,500,502,503,504])assert.equal(T.retry({statusCode},0,{taskRetryBaseMs:1000},()=>0),1000);
 for(const statusCode of [400,401,403,404,422])assert.equal(T.retry({statusCode},0,{}),null);
 assert.equal(T.retry({message:'ECONNRESET'},1,{taskRetryBaseMs:1000},()=>.5),2200);
 assert.equal(T.retry({statusCode:429,retryAfterMs:5000},0,{taskRetryBaseMs:1000},()=>0),5000);
 assert.equal(T.retry({statusCode:503},5,{}),null);assert.equal(T.retry({message:'invalid arguments'},0,{}),null);
});
test('continuation index prioritizes authored models over request dumps and searches query words',()=>{
 const files=[{path:'runs/a/requests/turn-1.json',summary:'models saved'},{path:'progress.md',summary:'Original goal'},{path:'runs/a/notes/models/chair.js',summary:'Metric chair definition'},{path:'runs/a/evidence/4-confluence_page.json',summary:'Review'}];
 assert.deepEqual(T.memoryIndex(files,'models saved').files.map(f=>f.path),['runs/a/notes/models/chair.js']);assert.equal(T.memoryIndex(files).files[0].path,'runs/a/notes/models/chair.js');assert.equal(T.memoryIndex(files).internalFiles,1);assert.equal(T.memoryIndex(files,'turn-1',true).files[0].path,files[0].path);
 const ledger=T.anchors({id:'a',notes:['models/chair.js'],events:[{type:'tool.completed',tool:'confluence_page',artifact:'evidence/4.json',failed:false},{type:'tool.completed',tool:'task_memory_read',artifact:'evidence/5.json'}]});assert.equal(ledger.savedNotes.latest[0],'runs/a/notes/models/chair.js');assert.equal(ledger.recentReceipts.length,1);assert.equal(ledger.recentReceipts[0].path,'runs/a/evidence/4.json');
});
