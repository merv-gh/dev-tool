const test = require('node:test');
const assert = require('node:assert/strict');
const { create, bind, next } = require('../lib/state-machine');
const L = require('../lib/lifecycles');
const { Revision, Pending, Draft } = require('../lib/state-machine');

test('UI epochs cannot reset and make a stale response current again', () => {
  const scope = new Revision(), old = scope.advance();scope.advance();
  assert.equal(scope.current(old), false);
  assert.throws(() => { scope.value = 0; }, /advance/);
  assert.equal(scope.current(old), false);
});

test('overlapping operations and separate file/metadata drafts cannot clear one another', () => {
  const pending = new Pending(), draft = new Draft();
  pending.value++;pending.value++;pending.value--;
  assert.equal(pending.lifecycle.state, 'busy');
  draft.mark('metadata');const snapshot=draft.revision;draft.mark('file');
  assert.notEqual(snapshot,draft.revision);draft.clear('metadata');assert.equal(draft.dirty,true);assert.equal(draft.has('file'),true);
  pending.value--;assert.equal(pending.lifecycle.state,'idle');assert.throws(()=>{pending.value--;},/Invalid pending/);
  draft.clear('file');assert.equal(draft.dirty,false);
});

test('terminal records cannot be revived by a late callback and retain the persisted JSON shape', () => {
  const row = bind({ id: 'owned', state: 'running', owner: 'story' }, L.job);
  row.state = 'cancelled';
  assert.throws(() => { row.state = 'done'; }, { code: 'DT_STATE_TRANSITION' });
  assert.equal(row.state, 'cancelled');
  assert.deepEqual(JSON.parse(JSON.stringify(row)), { id: 'owned', state: 'cancelled', owner: 'story' });
  const restored = bind(JSON.parse(JSON.stringify(row)), L.job);
  assert.throws(() => { restored.state = 'running'; }, { code: 'DT_STATE_TRANSITION' });
  assert.throws(() => bind({ state: 'not-a-job-state' }, L.job), { code: 'DT_STATE_UNKNOWN' });
});

test('cancellation during drain wins without pretending the cleanup outcome is known', () => {
  const r = bind({ state: 'queued', cleanupIncomplete: 2 }, L.execution);
  r.state = 'running';r.state = 'draining';r.state = 'cancelling';r.state = 'cancelled';
  assert.equal(r.cleanupIncomplete, 2);
  assert.throws(() => { r.state = 'done'; }, { code: 'DT_STATE_TRANSITION' });
});

test('close retry and durability remain independent from connection readiness', () => {
  const connection = create(L.store), close = create(L.storeClose), write = create(L.writer);
  connection.to('starting');connection.to('ready');write.to('writing');close.to('flushing');write.to('failed');close.to('open');
  assert.equal(connection.state, 'ready');assert.equal(write.state, 'failed');
  write.to('writing');write.to('idle');close.to('flushing');close.to('closing');connection.to('closed');close.to('closed');
  assert.throws(() => connection.to('starting'), { code: 'DT_STATE_TRANSITION' });
});

test('charts have closed state vocabularies and terminal states have no outgoing transitions', () => {
  for (const model of Object.values(L)) {
    const reached = new Set([model.initial]), frontier = [model.initial];
    for (let i=0;i<frontier.length;i++) for (const to of model.transitions[frontier[i]]) if (!reached.has(to)) { reached.add(to);frontier.push(to); }
    // Some known states exist solely for compatibility with persisted records.
    for (const state of model.states) {
      assert.equal(next(model,state,state),state);
      for (const to of model.transitions[state]) assert.ok(model.states.includes(to));
      if (model.terminal.includes(state)) assert.deepEqual(model.transitions[state],[]);
    }
    assert.ok(reached.size > 1, model.name);
    assert.ok(Object.isFrozen(model.transitions));
  }
});
