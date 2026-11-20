const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-flow-')), root = path.resolve(__dirname, '..');
Object.assign(process.env, { DT_HOME: home, DT_LOG: 'quiet', DT_RATE_PER_SEC: '0', DT_STATE_BACKEND: 'legacy', DT_REQUEST_EVENTS: '0' });
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[k];
const plugin = path.join(home, 'flow-fixture.js'), journal = path.join(home, 'effects.jsonl');
fs.writeFileSync(plugin, `const fs=require('node:fs'),E=require(${JSON.stringify(path.join(root, 'lib/execution'))});
const record=(type,a)=>fs.appendFileSync(${JSON.stringify(journal)},JSON.stringify({type,...a})+'\\n');
module.exports=[{name:'fixture_flow_probe',description:'Local deterministic workflow fixture',input:{value:{},tag:{type:'string'},delayMs:{type:'integer'},fail:{type:'boolean'},applicationFail:{type:'boolean'},killAfterEffect:{type:'boolean'}},run:async a=>{
record('start',a);if(a.delayMs)await new Promise((resolve,reject)=>{const signal=E.signal(),stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);record('abort',a);reject(E.abortError(signal?.reason));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},a.delayMs);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();});
if(a.fail){record('failure',a);throw Error('fixture branch failed');}record('effect',a);if(a.killAfterEffect)process.kill(process.pid,'SIGKILL');return a.applicationFail?{ok:false,error:'fixture rejected'}:{value:a.value??null,tag:a.tag||''};}}];`);
const config = extra => { fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, tools: { plugins: [plugin] }, ...extra })); };
config();
const F = require('../lib/automation-flow'), A = require('../lib/access'), E = require('../lib/execution'), T = require('../lib/tools');
const scope = (principalId, storyId, tools) => ({ principalId, storyId, multiUser: true, role: 'user', ...(tools ? { tools } : {}) });
const events = () => { try { return fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 8000) { const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw Error('Timed out waiting for fixture'); await pause(10); } }
const save = (id, nodes, limits) => F.save({ id, expected_revision: null, definition: { title: id, nodes, ...(limits ? { limits } : {}) } });
const tool = (id, args = {}) => ({ id, type: 'tool', tool: 'fixture_flow_probe', arguments: args });
test.after(async () => { await F.close(); await require('../lib/isolate').stop(); await require('../lib/state-store').close(); await require('../lib/observations').close(); fs.rmSync(home, { recursive: true, force: true }); });

test('normal registry exposes strict workflow contracts and definition CAS', async () => {
  const names = (await T.schemas()).map(t => t.name); assert.ok(names.includes('automation_flow_start')); assert.ok(names.includes('automation_flow_model'));
  const def = await T.call('automation_flow_save', { id: 'registry', expected_revision: null, definition: { title: 'Registry', nodes: [tool('one', { value: 4 })] } });
  await assert.rejects(T.call('automation_flow_save', { id: 'registry', expected_revision: null, definition: def.definition }), /Read the flow/);
  await assert.rejects(T.call('automation_flow_start', { id: 'registry', expected_revision: 'old' }), /reviewed/);
  const run = await T.call('automation_flow_start', { id: 'registry', expected_revision: def.revision, await_completion: true }); assert.equal(run.state, 'done'); assert.equal(run.output.one.value, 4);
  await assert.rejects(T.call('automation_flow_status', { run: run.id, bogus: true }), /bogus|additional/);
});

test('bounded loops pass typed references and parallel branches preserve independent results', async () => {
  const def = save('composed', [{ id: 'loop', type: 'loop', iterations: 3, nodes: [tool('check', { value: { $ref: 'iteration' } })] }, { id: 'both', type: 'parallel', concurrency: 2, branches: [{ id: 'left', nodes: [tool('value', { value: '{{input.name}}', delayMs: 30 })] }, { id: 'right', nodes: [tool('value', { value: { $ref: 'results.loop.results.check.value' }, delayMs: 10 })] }] }]);
  const run = await F.start({ id: def.id, expected_revision: def.revision, input: { name: 'Ada' }, await_completion: true });
  assert.equal(run.state, 'done'); assert.equal(run.output.loop.iterations, 3); assert.equal(run.output.both.left.value.value, 'Ada'); assert.equal(run.output.both.right.value.value, 2);
  const fresh = require.resolve('../lib/automation-flow'); delete require.cache[fresh]; assert.equal(require('../lib/automation-flow').status({ run: run.id }).output.loop.iterations, 3);
  const count = events().length; assert.equal((await F.resume({ run: run.id })).state, 'done'); assert.equal(events().length, count, 'completed leaves never replay');
  assert.throws(() => F.normalize({ title: 'unsafe', nodes: [{ id: 'loop', type: 'loop', iterations: 101, nodes: [tool('x')] }] }), /iterations/);
  assert.throws(() => F.normalize({ title: 'unsafe', nodes: [{ id: 'wait', type: 'wait', ms: 86400001 }] }), /wait ms/);
  assert.throws(() => F.normalize({title:'Detached nested flow',nodes:[{id:'escape',type:'tool',tool:'continuation_flow',arguments:{action:'start',arguments:{}}}]}), /non-orchestrator/);
  assert.throws(() => F.fill({ $ref: 'input.__proto__' }, { input: {} }), /Invalid flow reference/);
});

test('global leaf concurrency bound holds across nested parallel groups', async () => {
  const branch = n => ({ id: 'b' + n, nodes: [{ id: 'nested', type: 'parallel', concurrency: 2, branches: [0, 1].map(i => ({ id: 'n' + i, nodes: [tool('probe', { tag: 'concurrency', value: n * 2 + i, delayMs: 25 })] })) }] });
  const def = save('concurrency', [{ id: 'parallel', type: 'parallel', concurrency: 2, branches: [branch(0), branch(1)] }], { maxConcurrency: 2 });
  const run = await F.start({ id: def.id, expected_revision: def.revision, await_completion: true }); assert.equal(run.state, 'done');
  let current = 0, max = 0; for (const e of events().filter(e => e.tag === 'concurrency')) { if (e.type === 'start') { current++; max = Math.max(max, current); } else if (['effect', 'abort', 'failure'].includes(e.type)) current--; } assert.equal(current, 0); assert.equal(max, 2);
});

test('cancelled waits stop immediately and resume the retained deadline without repeating completed effects', async () => {
  const def = save('wait', [tool('once', { tag: 'wait-once' }), { id: 'pause', type: 'wait', ms: 250 }, tool('after', { tag: 'wait-after' })]);
  const run = await F.start({ id: def.id, expected_revision: def.revision });
  await until(() => F.status({ run: run.id, detail: true }).checkpoints['/pause']?.state === 'waiting');
  const due = F.status({ run: run.id, detail: true }).checkpoints['/pause'].dueAt;
  F.cancel({ run: run.id }); await until(() => F.status({ run: run.id }).state === 'cancelled');
  assert.ok(!events().some(e => e.type === 'effect' && e.tag === 'wait-after'));
  const resumed = await F.resume({ run: run.id, await_completion: true }); assert.equal(resumed.state, 'done');
  assert.equal(F.status({ run: run.id, detail: true }).checkpoints['/pause'].dueAt, due);
  assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'wait-once').length, 1);
});

test('run time and expanded-step budgets stop actual work; loops can finish early on an explicit condition', async () => {
  const timeout = save('time-budget', [tool('probe', { tag: 'time-budget', delayMs: 30000 })], { maxRunMs: 500 });
  const timed = await F.start({ id: timeout.id, expected_revision: timeout.revision, await_completion: true }); assert.equal(timed.state, 'cancelled'); assert.ok(events().some(e => e.type === 'abort' && e.tag === 'time-budget')); assert.ok(!events().some(e => e.type === 'effect' && e.tag === 'time-budget'));
  const steps = save('step-budget', [{ id: 'loop', type: 'loop', iterations: 3, nodes: [tool('probe', { tag: 'step-budget' })] }], { maxSteps: 2 }); const stopped = await F.start({ id: steps.id, expected_revision: steps.revision, await_completion: true }); assert.equal(stopped.error.code, 'DT_FLOW_LIMIT'); assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'step-budget').length, 1);
  const conditional = save('condition', [{ id: 'loop', type: 'loop', iterations: 5, until: { ref: 'results.probe.value', equals: 1 }, nodes: [tool('probe', { value: { $ref: 'iteration' } })] }]); const done = await F.start({ id: conditional.id, expected_revision: conditional.revision, await_completion: true }); assert.equal(done.output.loop.iterations, 2);
});

test('parallel failure cancels and drains siblings, retains uncertainty and requires an audited resolution', async () => {
  const def = save('failure', [{ id: 'both', type: 'parallel', concurrency: 2, branches: [{ id: 'slow', nodes: [tool('probe', { tag: 'must-abort', delayMs: 30000 })] }, { id: 'bad', nodes: [tool('probe', { fail: true, delayMs: 20 })] }] }]);
  const run = await F.start({ id: def.id, expected_revision: def.revision, await_completion: true }); assert.equal(run.state, 'failed'); assert.ok(events().some(e => e.type === 'abort' && e.tag === 'must-abort')); assert.ok(!events().some(e => e.type === 'effect' && e.tag === 'must-abort'));
  await assert.rejects(F.resume({ run: run.id }), e => e.code === 'DT_FLOW_UNCERTAIN');
  const detail = F.status({ run: run.id, detail: true });
  for (const cp of Object.values(detail.checkpoints).filter(c => c.type === 'tool')) { assert.equal(cp.state, 'uncertain'); assert.throws(() => F.resolve({ run: run.id, path: cp.path, action: 'skip', reason: 'Fixture effect verified absent' }), /acknowledge/); F.resolve({ run: run.id, path: cp.path, action: 'skip', acknowledge_uncertain: true, reason: 'Fixture effect verified absent' }); }
  assert.equal((await F.resume({ run: run.id, await_completion: true })).state, 'done');
});

test('tools retain principal/story grants and disabled or denied nested calls never execute', async () => {
  let runId;
  await A.run(scope('alice', 'one'), async () => { const def = save('private', [tool('probe', { tag: 'private' })]); runId = (await F.start({ id: def.id, expected_revision: def.revision, await_completion: true })).id; });
  for (const identity of [scope('alice', 'two'), scope('bob', 'one')]) await A.run(identity, async () => { assert.throws(() => F.status({ run: runId }), /not found/); assert.equal(F.list().definitions.length, 0); });
  await A.run(scope('restricted', 'one', ['automation_flow_*']), async () => { const def = save('denied', [tool('probe', { tag: 'denied' })]); const run = await F.start({ id: def.id, expected_revision: def.revision, await_completion: true }); assert.equal(run.state, 'failed'); assert.equal(run.error.code, 'DT_ACCESS_DENIED'); });
  assert.ok(!events().some(e => e.tag === 'denied'));
});

test('model nodes make no hidden calls, use the configured provider and abort actual HTTP work', async () => {
  let calls = 0, lastBody, disconnected = false;
  const provider = http.createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { calls++; lastBody = JSON.parse(body); if (lastBody.messages[0].content === 'hang') { res.on('close', () => { disconnected = true; }); return; } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Mock summary' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } })); }); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  config({ llm: { baseUrl: 'http://127.0.0.1:' + provider.address().port, model: 'fixture-model' } }); CReload();
  try {
    const def = save('model', [{ id: 'summary', type: 'model', prompt: 'Summarize {{input.topic}}' }]);
    const refused = await F.start({ id: def.id, expected_revision: def.revision, input: { topic: 'orders' }, await_completion: true }); assert.equal(refused.error.code, 'DT_FLOW_MODEL_PERMISSION'); assert.equal(calls, 0);
    const done = await F.resume({ run: refused.id, allow_model: true, await_completion: true }); assert.equal(done.state, 'done'); assert.equal(done.output.summary.content, 'Mock summary'); assert.equal(lastBody.model, 'fixture-model'); assert.equal(lastBody.messages[0].content, 'Summarize orders'); assert.equal(calls, 1);
    await assert.rejects(T.call('automation_flow_model', { prompt: 'x', model: 'not-allowed' }), /allowlist/);
    const hang = save('model-cancel', [{ id: 'summary', type: 'model', prompt: 'hang' }]); const run = await F.start({ id: hang.id, expected_revision: hang.revision, allow_model: true });
    await until(() => calls === 2); F.cancel({ run: run.id }); await until(() => F.status({ run: run.id }).state === 'cancelled'); await until(() => disconnected); assert.equal(F.status({ run: run.id }).unresolved[0].state, 'uncertain');
  } finally { provider.closeAllConnections(); await new Promise(r => provider.close(r)); config(); CReload(); }
});
function CReload() { require('../lib/config').reload(); }

async function killedChild(code, ready) {
  const child = spawn(process.execPath, ['-e', code], { cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await until(() => stdout.includes('RUN:') || child.exitCode !== null); assert.equal(child.exitCode, null, stderr);
  const run = stdout.match(/RUN:([a-f0-9-]+)/)[1]; await ready(run); child.kill('SIGKILL'); await exited; return run;
}
test('process restart rehydrates wait deadlines, completed effects and uncertain in-flight effects without replay', async () => {
  const def = save('restart', [tool('before', { tag: 'restart-before' }), { id: 'pause', type: 'wait', ms: 300 }, tool('after', { tag: 'restart-after' })]);
  const run = await killedChild(`const F=require('./lib/automation-flow');F.start({id:'restart',expected_revision:${JSON.stringify(def.revision)}}).then(r=>process.stdout.write('RUN:'+r.id+'\\n'));`, run => until(() => F.status({ run, detail: true }).checkpoints['/pause']?.state === 'waiting'));
  assert.equal(F.status({ run }).state, 'interrupted'); const due = F.status({ run, detail: true }).checkpoints['/pause'].dueAt;
  assert.equal((await F.resume({ run, await_completion: true })).state, 'done'); assert.equal(F.status({ run, detail: true }).checkpoints['/pause'].dueAt, due); assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'restart-before').length, 1);
  const uncertain = save('restart-uncertain', [tool('effect', { tag: 'restart-uncertain', delayMs: 30000 })]);
  const pending = await killedChild(`const F=require('./lib/automation-flow');F.start({id:'restart-uncertain',expected_revision:${JSON.stringify(uncertain.revision)}}).then(r=>process.stdout.write('RUN:'+r.id+'\\n'));`, run => until(() => events().some(e => e.type === 'start' && e.tag === 'restart-uncertain')));
  const starts = events().filter(e => e.type === 'start' && e.tag === 'restart-uncertain').length;
  await assert.rejects(F.resume({ run: pending }), e => e.code === 'DT_FLOW_UNCERTAIN'); assert.equal(events().filter(e => e.type === 'start' && e.tag === 'restart-uncertain').length, starts);
  F.resolve({ run: pending, path: '/effect', action: 'complete', result: { externallyVerified: true }, acknowledge_uncertain: true, reason: 'External fixture evidence reconciled after crash' }); assert.equal((await F.resume({ run: pending, await_completion: true })).state, 'done'); assert.equal(events().filter(e => e.type === 'start' && e.tag === 'restart-uncertain').length, starts);
});

test('a crash after an external effect and before checkpoint acknowledgement never silently repeats the effect', async () => {
  const def = save('crash-after-effect', [tool('effect', { tag: 'effect-before-crash', killAfterEffect: true })]);
  const child = spawnSync(process.execPath, ['-e', `const F=require('./lib/automation-flow');F.start({id:'crash-after-effect',expected_revision:${JSON.stringify(def.revision)}}).then(r=>process.stdout.write('RUN:'+r.id+'\\n'));`], { cwd: root, env: { ...process.env }, encoding: 'utf8', timeout: 8000 });
  assert.equal(child.signal, 'SIGKILL', child.stderr); const run = child.stdout.match(/RUN:([a-f0-9-]+)/)[1];
  assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'effect-before-crash').length, 1); await assert.rejects(F.resume({ run }), e => e.code === 'DT_FLOW_UNCERTAIN'); assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'effect-before-crash').length, 1);
  F.resolve({ run, path: '/effect', action: 'complete', result: { verified: 'existing effect receipt' }, acknowledge_uncertain: true, reason: 'External journal proves the effect happened before the process stopped' });
  const resumed = await F.resume({ run, await_completion: true }); assert.equal(resumed.state, 'done'); assert.equal(resumed.output.effect.verified, 'existing effect receipt'); assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'effect-before-crash').length, 1);
});

test('two fresh processes racing to resume one checkpoint cannot both execute its next effect', async () => {
  const def = save('dual-resume', [{ id: 'pause', type: 'wait', ms: 100 }, tool('effect', { tag: 'dual-resume', delayMs: 250 })]);
  const run = await killedChild(`const F=require('./lib/automation-flow');F.start({id:'dual-resume',expected_revision:${JSON.stringify(def.revision)}}).then(r=>process.stdout.write('RUN:'+r.id+'\\n'));`, run => until(() => F.status({ run, detail: true }).checkpoints['/pause']?.state === 'waiting'));
  const outputs = ['', ''], errors = ['', ''];
  const code = `const F=require('./lib/automation-flow');process.stdout.write('READY\\n');process.stdin.once('data',async()=>{try{const r=await F.resume({run:${JSON.stringify(run)},await_completion:true});process.stdout.write('RESULT:'+JSON.stringify({state:r.state})+'\\n');}catch(e){process.stdout.write('RESULT:'+JSON.stringify({code:e.code})+'\\n');}finally{await F.close();await require('./lib/isolate').stop();await require('./lib/state-store').close();}});`;
  const children = [0, 1].map(i => { const child = spawn(process.execPath, ['-e', code], { cwd: root, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] }); child.stdout.on('data', b => { outputs[i] += b; }); child.stderr.on('data', b => { errors[i] += b; }); return child; });
  const exits = children.map(c => new Promise(resolve => c.once('exit', (code, signal) => resolve({ code, signal }))));
  try { await until(() => outputs.every(o => o.includes('READY'))); for (const child of children) child.stdin.end('go'); const ended = await Promise.all(exits); for (let i = 0; i < ended.length; i++) assert.equal(ended[i].code, 0, errors[i]); const results = outputs.map(o => JSON.parse(o.match(/RESULT:(.*)/)[1])); // The nonblocking writer lock may reject both contenders. A caller can also
    // observe the winner's completed receipt after it finishes. Neither outcome
    // implies another execution; assert the external journal, then explicit progress.
    assert.ok(results.every(r => r.state === 'done' || r.code === 'STATE_CONFLICT'), JSON.stringify(results));
    assert.ok(events().filter(e => e.type === 'effect' && e.tag === 'dual-resume').length <= 1);
    if (F.status({ run }).state !== 'done') assert.equal((await F.resume({ run, await_completion: true })).state, 'done');
    assert.equal(events().filter(e => e.type === 'effect' && e.tag === 'dual-resume').length, 1); }
  finally { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('server shutdown cancels and drains workflows owned by different principals and stories', async () => {
  const records = [];
  for (const owner of [scope('shutdown-alice', 'first'), scope('shutdown-bob', 'second')]) await A.run(owner, async () => { const def = save('shutdown', [tool('probe', { tag: owner.principalId, delayMs: 30000 })]); const run = await F.start({ id: def.id, expected_revision: def.revision }); records.push({ owner, run }); });
  await until(() => events().filter(e => e.type === 'start' && String(e.tag).startsWith('shutdown-')).length === 2);
  await F.close();
  for (const { owner, run } of records) A.run(owner, () => { assert.equal(F.status({ run: run.id }).state, 'cancelled'); assert.ok(events().some(e => e.type === 'abort' && e.tag === owner.principalId)); assert.ok(!events().some(e => e.type === 'effect' && e.tag === owner.principalId)); });
});
