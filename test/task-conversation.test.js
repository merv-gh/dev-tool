const test=require('node:test'),assert=require('node:assert/strict'),C=require('../web/task-conversation');
test('conversation tells an ordered story of actual messages, grouped tools, acknowledged corrections and failures',()=>{
 const e=(cursor,type,data={})=>({cursor,type,at:'2026-11-21T09:00:00Z',...data});
 const events=[e(1,'admitted'),e(2,'model.started'),e(3,'model.completed',{content:'I will inspect the requirement.',tools:['confluence_page']}),e(4,'tool.started',{tool:'confluence_page'}),e(5,'tool.completed',{tool:'confluence_page',artifact:'one.json'}),e(6,'tool.completed',{tool:'bitbucket_file',artifact:'two.json'}),e(7,'control',{action:'steer',message:'Preserve zero totals.'}),e(8,'tool.completed',{tool:'pg_query',failed:true,preview:'Database unavailable'}),e(9,'blocked',{message:'Review the error.'})];
 const before=JSON.stringify(events),rows=C.rows(events.reverse());assert.deepEqual(rows.map(r=>r.kind),['assistant','work','user','failure','blocker']);assert.equal(rows[1].events.length,2);assert.equal(rows[0].text,'I will inspect the requirement.');assert.equal(rows[2].text,'Preserve zero totals.');assert.equal(rows[2].acknowledged,true);assert.match(rows[3].event.preview,/unavailable/);assert.equal(JSON.stringify(events.reverse()),before);
 assert.ok(!rows.some(r=>r.text?.includes('model.started')));
});
test('group identities remain stable as tool results arrive; legacy journals never fabricate assistant claims',()=>{
 const first={cursor:3,type:'tool.completed',tool:'confluence_search'},second={cursor:5,type:'tool.completed',tool:'confluence_page'};
 assert.equal(C.rows([first])[0].key,C.rows([second,first])[0].key);assert.equal(C.rows([{cursor:1,type:'model.completed',tools:['find']}]).length,0);
 assert.equal(C.rows([{cursor:2,type:'model.completed',content:'Partial answer',contentTruncated:true}])[0].truncated,true);
});
test('current-state labels expose actual operations, safe control acknowledgement and actionable context or outcome recovery',()=>{
 assert.match(C.status({state:'running',pending:{kind:'tool',tool:'bitbucket_file'}}).title,/repository file/);
 assert.match(C.status({state:'running',pending:{kind:'model'}}).title,/model response/);
 assert.match(C.status({state:'running',controlPending:'pause'}).title,/pause requested/);
 assert.equal(C.status({state:'needs_attention',reason:'Active context reached byte budget'}).action,'context');
 assert.equal(C.status({state:'needs_attention',reason:'Unknown effect',pending:{kind:'tool'}}).action,'resolve');
 assert.equal(C.status({state:'waiting',watch:{tool:'jenkins_build'}}).action,'checks');
 assert.match(C.status({state:'paused'}).detail,/No work is running/);assert.match(C.status({state:'completed'}).title,/saved/);assert.match(C.status({state:'cancelled'}).title,/Stopped/);
});

test('provider recovery and automatic checkpoints remain visible in the conversation',()=>{
 const rows=C.rows([{cursor:1,type:'model.backoff',attempt:2,retryAt:'2026-11-25T20:00:00Z'},{cursor:2,type:'context.compaction.started'},{cursor:3,type:'context.compacted',beforeBytes:40000,afterBytes:12000},{cursor:4,type:'context.overflow'}]);
 assert.equal(rows.length,4);assert.match(rows[0].text,/retry 2.*2026-11-25/);assert.match(rows[2].text,/40000 → 12000/);assert.match(C.status({state:'running',pending:{kind:'compaction'}}).title,/Compacting/);
});
