const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-pgstore-'));
process.env.DT_HOME = home;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { big: { postgres: { big: 'postgres://x@127.0.0.1:1/big' } } } }));
const S = require('../lib/pgstore');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const file = name => path.join(home, 'cache/big/pg', name + '.json');

test('paged records preserve values, arrays, overloads, dictionary rows and old reader snapshots', () => {
  const f = file('small'), w = S.writer(f);
  const functions = [
    { schema: 's', name: 'total', signature: 'x int', body: 'select "é😀", \'\\\\\';', comment: null },
    { schema: 's', name: 'total', signature: 'x text', body: 'select 2', arg_list: [{ name: 'x', type: 'text' }] },
  ];
  for (const fn of functions) w.add('functions', fn);
  w.ensure('tables'); w.add('dictionaries', { $key: 's.d_kind', count: 1, rows: [{ id: '9007199254740993' }] });
  w.commit({ db: 'small' });
  const old = S.load(f);
  assert.ok(Array.isArray(old.functions));
  assert.deepEqual(old.functions.map(f => ({ ...f })), functions);
  assert.deepEqual(Object.keys(old.functions), ['0', '1']);
  assert.deepEqual(old.tables, []);
  assert.equal(old.functions.find(f => f.signature === 'x text').body, 'select 2');
  assert.deepEqual(old.dictionaries['s.d_kind'].rows, [{ id: '9007199254740993' }]);
  assert.ok(!JSON.stringify(old.dictionaries).includes('rows'));
  const next = S.writer(f); next.add('functions', { schema: 's', name: 'new', body: 'select 3' }); next.commit({ db: 'small' });
  assert.equal(S.load(f).functions[0].name, 'new');
  assert.equal(old.functions[1].body, 'select 2', 'a refresh never mixes generations in a reader');
  assert.ok(S.stats().bytes <= S.LIMIT);
});

test('malformed and oversized legacy records preserve the source and remove staging files', () => {
  const f = file('bad'); fs.mkdirSync(path.dirname(f), { recursive: true });
  for (const text of ['{"tables":[],"functions":[{"name":"x"}', '{"functions":[{"name":"x","body":"' + 'a'.repeat(S.LIMIT) + '"}]}']) {
    fs.writeFileSync(f, text);
    assert.throws(() => S.migrate(f), e => e.code === 'DT_PG_CATALOG');
    assert.equal(fs.readFileSync(f, 'utf8'), text);
    assert.deepEqual(fs.readdirSync(path.dirname(f)).filter(n => n.startsWith('bad.json.')), []);
  }
  fs.rmSync(f);
});

test('migration handles whitespace, escaped quotes and UTF-8 across read boundaries', () => {
  const f = file('unicode');
  const row = { schema: 's', name: 'quote', body: 'é😀\\"{}[]\n'.repeat(12000), arg_list: [], comment: 'last' };
  fs.writeFileSync(f, JSON.stringify({ tables: [], functions: [row], dictionaries: {}, db: 'unicode' }, null, 2));
  S.migrate(f);
  assert.deepEqual({ ...S.load(f).functions[0] }, row);
  assert.deepEqual(S.load(f).tables, []);
});

test('body=false does not parse the function body, even when that body record is corrupt', () => {
  const f = file('big'), w = S.writer(f);
  w.ensure('tables');
  w.add('functions', { schema: 's', name: 'test', kind: 'function', body: 'select 1', arg_list: [{ name: 'id', type: 'int' }] });
  w.commit({ db: 'big' });
  const manifest = JSON.parse(fs.readFileSync(f, 'utf8'));
  const data = fs.openSync(path.join(path.dirname(f), manifest.data), 'r+');
  try { fs.writeSync(data, Buffer.from('!'), 0, 1, 0); } finally { fs.closeSync(data); }
  const P = require('../lib/pgindex');
  const without = P.describe('big', 's.test', { body: false });
  assert.equal(without[0].arg_list[0].name, 'id');
  assert.equal(Object.hasOwn(without[0], 'body'), false);
  assert.throws(() => P.describe('big', 's.test'), /invalid JSON record/);
});

test('a 200+ MiB catalog migrates, indexes and answers functions under a 64 MiB heap', { timeout: 180000 }, () => {
  const f = file('big'), fd = fs.openSync(f, 'w');
  const body = '/* ' + 'x'.repeat(52 * 1024) + ' */ select id from s.orders;';
  try {
    fs.writeSync(fd, '{"db":"big","database":"big","syncedAt":"2026-10-31T00:00:00Z","tables":[{"schema":"s","name":"orders","kind":"table","columns":[{"name":"id","type":"bigint"}],"constraints":[]}],"functions":[');
    for (let i = 0; i < 4096; i++) fs.writeSync(fd, (i ? ',' : '') + JSON.stringify({ schema: 's', name: 'f' + i, kind: 'function', signature: 'id bigint', args: 'id bigint', returns: 'bigint', lang: 'sql', body, arg_list: [] }));
    fs.writeSync(fd, '],"viewDeps":[],"triggers":[],"dictionaries":{}}');
  } finally { fs.closeSync(fd); }
  const bytes = fs.statSync(f).size;
  assert.ok(bytes > 200 * 1024 * 1024);
  const root = path.resolve(__dirname, '..');
  const script = `
    const assert=require('node:assert/strict'),fs=require('fs');
    const pg=require('./lib/pg'),P=require('./lib/pgindex'),S=require('./lib/pgstore');
    const cat=pg.loadDb('big','big');
    assert.equal(cat.functions.length,4096);
    assert.equal(cat.functions[4095].body,${JSON.stringify(body)});
    const rebuilt=P.build('big'); assert.equal(rebuilt.dbs,1);
    const lookupStart=Date.now();const description=P.describe('big','s.f4095',{body:false});const lookupMs=Date.now()-lookupStart;
    assert.equal(description.length,1);assert.equal(Object.hasOwn(description[0],'body'),false);
    assert.ok(P.describe('big','s.f4095',{bodyLimit:80})[0].body.length<160);
    assert.equal(P.uses('big','s.f4095')[0].target,'s.orders');
    require('./lib/catalog').build('big');
    assert.ok(require('./lib/catalog').find('big','pgfn: f4095').length);
    assert.ok(require('./lib/knowledge').system('big').nodes.some(n=>n.name==='s.f4095'));
    const impact=require('./lib/impact'); const G=impact.load({env:'big',target:'pgfn:s.f4095'});
    assert.equal(impact.load({env:'big',target:'pgfn:s.f4095'}),G);
    const manifest=JSON.parse(fs.readFileSync(${JSON.stringify(f)},'utf8'));const dataBytes=fs.statSync(require('path').join(require('path').dirname(${JSON.stringify(f)}),manifest.data)).size;
    console.log(JSON.stringify({dataBytes,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),lookupMs,manifestBytes:fs.statSync(${JSON.stringify(f)}).size,cacheBytes:S.stats().bytes}));
  `;
  const r = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', script], { cwd: root, env: { ...process.env, DT_HOME: home, DT_LOG: 'quiet', DT_PG_SLIM_BYTES: 'invalid' }, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 150000 });
  assert.equal(r.status, 0, `${r.signal || ''}\n${r.stdout}\n${r.stderr}`);
  const metrics = JSON.parse(r.stdout.trim());
  assert.ok(metrics.manifestBytes < 100000);
  assert.ok(metrics.cacheBytes <= S.LIMIT);
  assert.ok(metrics.dataBytes < bytes / 4, 'large repetitive SQL is compressed per field without loading the whole catalog');
  console.log(`catalog ${Math.round(bytes / 1048576)} MiB: ${JSON.stringify(metrics)}`);
});
