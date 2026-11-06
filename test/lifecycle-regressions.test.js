const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Framer } = require('../lib/state-machine');
const { KeyedWork } = require('../lib/keyed-work');
const L = require('../lib/lifecycles');

test('protocol framing handles split UTF-8, per-record budgets, and incomplete EOF', () => {
  const frames = new Framer({ maxBytes: 6 });
  const bytes = Buffer.from('客户\n');
  assert.deepEqual(frames.push(bytes.subarray(0,1)), []);
  assert.equal(frames.lifecycle.state, 'partial');
  assert.deepEqual(frames.push(bytes.subarray(1)), ['客户']);
  assert.deepEqual(frames.push(Buffer.from('a\nb\nc\nd\ne\nf\ng\n')), ['a','b','c','d','e','f','g']);
  frames.finish(); assert.throws(() => frames.push('x\n'), /closed/);
  const partial = new Framer(); partial.push(Buffer.from([0xe4]));
  assert.throws(() => partial.finish(), /incomplete/);
  const large = new Framer({ maxBytes: 2 }); assert.throws(() => large.push('abc\n'), /budget/);
  const events = new Framer({ separator: /\r?\n\r?\n/ }), found = [];
  for (const byte of Buffer.from('data: 客户😀\r\n\r\ndata: second\n\n')) found.push(...events.push(Buffer.from([byte])));
  assert.deepEqual(found, ['data: 客户😀', 'data: second']); events.finish();
});

test('shared preparations deduplicate in-flight work and retry a failed preparation', async () => {
  const queue = new KeyedWork(L.preparation, { retainTick: false });
  let release, calls = 0;
  const waiting = new Promise(r => release = r);
  const first = queue.run('one', async () => { calls++; await waiting; throw new Error('retry me'); });
  const second = queue.run('one', () => { throw new Error('duplicate'); });
  assert.equal(first, second); release(); await assert.rejects(first, /retry me/);
  assert.equal(calls, 1); assert.equal(await queue.run('one', () => 42), 42);
  assert.equal(queue.items.size, 0);
});

test('failed and reentrant file publication preserve complete versions and clean staging files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-publish-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'record.json'), { atomicFile } = require('../lib/atomic-file');
  fs.writeFileSync(file, 'old');
  const rename = fs.renameSync; let nested = false;
  fs.renameSync = (from,to) => { if (!nested) { nested = true; atomicFile(file, 'nested'); } return rename(from,to); };
  try { atomicFile(file, 'outer'); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file,'utf8'), 'outer');
  fs.renameSync = () => { throw new Error('disk rejected rename'); };
  try { assert.throws(() => atomicFile(file,'broken'), /rejected rename/); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file,'utf8'), 'outer'); assert.deepEqual(fs.readdirSync(root), ['record.json']);
});

test('config migration compensates an interrupted two-file publication without replacing another config', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-migrate-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Run in a sterile child so config paths and cached generations are real.
  fs.writeFileSync(path.join(root,'envs.json'), '{"dev":{}}');
  const script = `const fs=require('fs'),path=require('path'),assert=require('assert/strict');const link=fs.linkSync;fs.linkSync=(a,b)=>{if(path.basename(b)==='config.json'){fs.writeFileSync(b,'{"envs":{"other":{}}}');throw new Error('competing publication');}return link(a,b);};assert.throws(()=>require('./lib/migrate').migrate(),/competing/);assert.equal(fs.existsSync(path.join(process.env.DT_HOME,'.env')),false);assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.DT_HOME,'config.json'))).envs.other.constructor,Object);assert.equal(fs.readdirSync(process.env.DT_HOME).some(x=>x.startsWith('.migrate-')),false);`;
  const result = require('node:child_process').spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:{...process.env,DT_HOME:root,DT_CONFIG_DIR:root},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
