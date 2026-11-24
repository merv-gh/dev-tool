#!/usr/bin/env node
// Offline only. Download with engine.js and the exported recipe.json.
'use strict';
const fs = require('node:fs');
const engine = require('./engine');
function selfTest() {
  const assert = require('node:assert/strict');
  let checks = 0;
  const check = (name, fn) => { fn(); checks++; };
  check('original and corrected winner', () => {
    assert.equal(engine.select(engine.fixture,false).id,104);
    assert.equal(engine.select(engine.fixture,true).id,103);
    assert.equal(engine.comparison('ready',false).verdict,'failed');
    assert.equal(engine.comparison('ready',true).verdict,'passed');
  });
  check('partial and failure do not claim a passing assertion', () => {
    assert.equal(engine.comparison('partial',true).verdict,'inconclusive');
    assert.equal(engine.comparison('partial',true).documents.length,1);
    assert.equal(engine.comparison('error',true).actual,null);
    assert.equal(engine.comparison('error',true).transport,'failed');
    assert.equal(engine.comparison('error',true).verdict,'not-run');
  });
  check('empty read uses coherent registry fallback', () => {
    const empty=engine.comparison('empty',false);
    assert.equal(empty.actual,'Petrova Anna Ivanovna');assert.equal(empty.chosenId,null);assert.equal(empty.documents.length,0);assert.equal(empty.verdict,'passed');
  });
  check('contract cases execute separately from saved correction', () => {
    assert.equal(engine.verify(false).filter(c=>!c.passed).length,1);
    assert.equal(engine.verify(true).every(c=>c.passed),true);
    assert.equal(engine.verify(true).find(c=>c.id==='coherent').actual,'Petrova Anna');
  });
  check('source nodes and tasks have different source samples', () => {
    const nodes=['entry','query','selection','mapping','exit'];
    assert.equal(new Set(nodes.map(n=>engine.sourceSample('PERS-218',n).code)).size,5);
    assert.equal(new Set(nodes.map(n=>engine.sourceSample('SHOP-142',n).code)).size,5);
    assert.match(engine.sourceSample('SHOP-142','entry').code,/refund/);
    assert.doesNotMatch(engine.sourceSample('SHOP-142','entry').code,/person/);
  });
  check('conflict preserves the exact draft and never executes arbitrary guard', () => {
    const task=engine.taskState('PERS-218');task.correctionDraft={guard:'arbitrary()',reason:'Retain this reason',scope:'review'};task.revision++;
    const original=engine.clone(task.correctionDraft);
    assert.equal(engine.saveCorrection(task).ok,false);assert.deepEqual(task.correctionDraft,original);assert.equal(task.corrected,false);
    task.draftRevision=task.revision;
    assert.match(engine.saveCorrection(task).error,/Arbitrary guards/);assert.deepEqual(task.correctionDraft,original);
    task.correctionDraft.guard=engine.guard;
    assert.equal(engine.saveCorrection(task).ok,true);assert.equal(task.correctionSaved.scope,'review');
    assert.equal(task.lastResult.verdict,'failed');assert.equal(task.checkResults,null);assert.equal(task.replayPolicy,'original');
    assert.match(engine.sourceSample(task.id,'selection').code,/Missing: exclude/);
  });
  check('session reload isolates tasks, drafts and results', () => {
    let text=null;const storage={getItem:()=>text,setItem:(_key,value)=>{text=value;}};
    const before=engine.session(storage);
    before.tasks['PERS-218'].note='person only';before.tasks['PERS-218'].correctionDraft.reason='unsaved exact reason';before.tasks['PERS-218'].steering=['check expiry'];
    before.tasks['SHOP-142'].note='checkout only';before.tasks['SHOP-142'].workerStatus='paused';
    before.configDraft='{"keep":"draft"}';engine.persist(storage,before);
    const after=engine.session(storage);
    assert.equal(after.tasks['PERS-218'].note,'person only');assert.equal(after.tasks['SHOP-142'].note,'checkout only');
    assert.equal(after.tasks['PERS-218'].correctionDraft.reason,'unsaved exact reason');assert.equal(after.tasks['SHOP-142'].workerStatus,'paused');
    assert.deepEqual(after.tasks['SHOP-142'].steering,[]);assert.equal(after.configDraft,before.configDraft);
  });
  check('reload interrupts local work without inventing a background worker', () => {
    const request=engine.normalizeTask('PERS-218',{running:true,operation:'comparison'});
    const docs=engine.normalizeTask('SHOP-142',{running:true,operation:'docs'});
    assert.equal(request.running,false);assert.equal(request.requestState,'interrupted');assert.equal(docs.running,false);assert.equal(docs.workerStatus,'paused');
    assert.match(docs.overnightOutput,/No background worker/);
  });
  check('storage failure and corrupted storage remain usable', () => {
    assert.equal(engine.persist({setItem:()=>{throw Error('blocked');}},{}),false);
    for(const saved of ['bad JSON','null','[]','{"tasks":{"PERS-218":null}}'])assert.equal(engine.session({getItem:()=>saved}).tasks['PERS-218'].id,'PERS-218');
  });
  check('person recipe replays selected policy and explicit expectation', () => {
    assert.equal(engine.replay(engine.recipe('',false)).passed,false);
    assert.equal(engine.replay(engine.recipe('',true)).passed,true);
    const changed=engine.recipe('',true);changed.expected='Another name';assert.equal(engine.replay(changed).passed,false);
  });
  check('partial and empty exported scenarios retain their verdicts', () => {
    assert.equal(engine.replay(engine.recipe({scenario:'partial',corrected:true})).outcome,'inconclusive');
    assert.equal(engine.replay(engine.recipe({scenario:'empty'})).passed,true);
    assert.equal(engine.replay(engine.recipe({scenario:'error'})).outcome,'not-run');
  });
  check('overnight export cannot replay the person service', () => {
    const recipe=engine.recipe({taskId:'SHOP-142',note:'checkout handoff',docsState:'recovered'});
    assert.equal(recipe.source.repository,'DEMO/checkout');assert.equal(recipe.params,undefined);
    assert.doesNotMatch(JSON.stringify(recipe),/PERS-218|person-intent|person-name|personId/);
    const replay=engine.replay(recipe);assert.equal(replay.passed,true);assert.equal(replay.externalOperations,0);assert.match(replay.unresolvedRealSource,/Confluence/);
    recipe.taskId='PERS-218';assert.throws(()=>engine.replay(recipe),/scope disagree/);
  });
  check('incomplete checkpoint cannot pass retention check', () => {
    const recipe=engine.recipe({taskId:'SHOP-142'});recipe.checkpoint.completedSources.pop();assert.equal(engine.replay(recipe).passed,false);
  });
  check('modified fixture, IDs and unsupported guards are rejected', () => {
    const fixture=engine.recipe('',true);fixture.fixture.documents[0].annulled=false;assert.throws(()=>engine.replay(fixture),/fixed embedded fixture/);
    const id=engine.recipe('',true);id.params.personId=99;assert.throws(()=>engine.replay(id),/scope disagree/);
    const guard=engine.recipe('',true);guard.correction={guard:'eval(code)'};assert.throws(()=>engine.replay(guard),/Unsupported correction guard/);
    assert.throws(()=>engine.replay({format:'dt.admin-intent-proposal/v1'}),/incomplete/);
  });
  console.log(JSON.stringify({passed:true,checks,effects:'Node assertions only; no browser or external services used.'},null,2));
}
function main() {
  if(process.argv[2]==='--self-test')return selfTest();
  try {
    const recipe=JSON.parse(fs.readFileSync(process.argv[2]||'recipe.json','utf8'));
    const result=engine.replay(recipe);
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.passed?0:1;
  } catch(error) { console.error('Offline replay failed: '+error.message);process.exitCode=2; }
}
if(require.main===module)main();
module.exports={main,selfTest};
