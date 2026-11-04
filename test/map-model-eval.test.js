const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../dev/eval-map-model');
test('map model evaluation parses narrative plus fenced JSON without accepting malformed values or weakening semantic checks',()=>{
 assert.deepEqual(E.parseAnswer('Evidence first.\n```json\n{"count":7,"total":280}\n```\nStatic caveat.'),{count:7,total:280});
 assert.equal(E.parseAnswer('No structured answer'),undefined);assert.equal(E.parseAnswer('```json\n{invalid}\n```'),undefined);
 const grade=E.QUESTIONS.find(q=>q.id==='trace').grade,correct={producer:'svc:orders',consumer:'svc:shipping',database:'db0',table:'sales.records_0',sql:'SELECT * FROM "sales"."records_0" LIMIT 20'};
 assert.equal(grade(correct),true);assert.equal(grade({...correct,database:'pg:db0:sales.records_0'}),false);assert.equal(grade({...correct,sql:'DELETE FROM sales.records_0'}),false);
 assert.equal(E.QUESTIONS.find(q=>q.id==='library').grade({library:'lib:LIB/common',services:['svc:orders','svc:shipping']}),true);
});
test('UI ownership grading requires a real clarification and rejects invented bindings or mutation',()=>{
 const grade=E.QUESTIONS.find(q=>q.id==='ownership').grade,answer={repository:null,needs_user_input:true,questions:['Which source repository serves this site?']},evidence={calls:[{tool:'map_node'}]};
 assert.equal(grade(answer,null,evidence),true);assert.equal(grade({...answer,repository:''},null,evidence),true);assert.equal(grade({...answer,repository:'SHOP/guessed'},null,evidence),false);assert.equal(grade(answer,null,{calls:[{tool:'map_node'},{tool:'map_adjust'}]}),false);
});
