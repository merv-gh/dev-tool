const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/coverage');
test('coverage attributes actual edges to passing files and leaves missing edges visible',()=>{
 const report=C.aggregate({rows:[{machine:'SM02.job',from:'running',to:'done',kind:'transition',hits:3,file:'test/real.test.js'},{machine:'SM02.job',from:'running',to:'failed',kind:'transition',hits:1,file:'test/broken.test.js'}],tests:[{type:'test:pass',file:'test/real.test.js',name:'real completion'},{type:'test:fail',file:'test/broken.test.js',name:'failed scenario'}]});
 const job=report.machines.find(m=>m.name==='SM02.job');assert.equal(job.edges.find(e=>e.to==='done'&&e.from==='running').covered,true);assert.equal(job.edges.find(e=>e.to==='failed'&&e.from==='running').covered,false);
 assert.ok(job.edges.some(e=>!e.hits));assert.equal(job.edges.find(e=>e.to==='done'&&e.from==='running').evidence[0].file,'test/real.test.js');
});
test('LCOV keeps uncovered executable lines and excludes files outside the repository',()=>{
 const report=C.lcov('SF:lib/execution.js\nDA:1,1\nDA:2,0\nFNDA:0,never\nBRDA:2,0,0,-\nend_of_record\nSF:../private.js\nDA:1,1\nend_of_record\n',process.cwd());
 assert.equal(report.length,1);assert.deepEqual(report[0].uncoveredLines,[2]);assert.equal(report[0].lines.percent,50);assert.equal(report[0].branches.hit,0);assert.equal(C.pct(0,0),null);
});
test('pure validation and repeated state assignments do not masquerade as exercised edges',()=>{
 const S=require('../lib/state-machine'),L=require('../lib/lifecycles'),events=[],stop=S.observe(e=>events.push(e));
 try{S.next(L.job,'running','done');const m=S.create(L.job);m.to('running');m.to('done');assert.throws(()=>m.to('running'),{code:'DT_STATE_TRANSITION'});}
 finally{stop();}
 assert.deepEqual(events.map(e=>e.kind),['reassert','transition','rejected']);
});
