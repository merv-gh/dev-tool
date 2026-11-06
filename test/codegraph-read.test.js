const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-graph-read-'));
process.env.DT_HOME = home;
const G = require('../lib/codegraph-read');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const put = (name, value) => { const file = path.join(home, name); fs.writeFileSync(file, JSON.stringify(value)); return file; };

test('streamed graph preserves classes and precise/legacy edge records across chunk and UTF-8 boundaries', () => {
  const record = ['from', 'to', 'calls', 'x'.repeat(65517) + 'é\\"[]{},\n', 1, ['Object'], 'from(Object)'];
  const graph = { padding: 'z'.repeat(65520), classes: [{ id: 'pkg.Événement', methods: [], fields: [] }], edges: [record], preciseEdges: [record, ['a','b','uses','inherited']], app: { name: 'fixture' }, errors: [], sql: [] };
  const file = put('boundary.json', graph), before = fs.readFileSync(file), streamed = G.load(file);
  assert.deepEqual(streamed.classes, graph.classes); assert.deepEqual(streamed.app, graph.app);
  assert.deepEqual([...streamed.edges], graph.edges); assert.deepEqual([...streamed.preciseEdges], graph.preciseEdges);
  assert.deepEqual(fs.readFileSync(file), before, 'A saved revision is never migrated or rewritten');
  assert.equal(fs.readdirSync(home).length, 1, 'No sidecar or duplicate edge index');
});

test('legacy and empty graph arrays remain iterable; stale iterators cannot mix graph generations', () => {
  const file = put('changing.json', { classes: [], edges: [['a','b','uses']], preciseEdges: null });
  const old = G.load(file); assert.equal(old.preciseEdges, null); assert.deepEqual([...old.edges], [['a','b','uses']]);
  fs.writeFileSync(file, JSON.stringify({ classes: [], edges: [] })); const later = new Date(Date.now()+5000); fs.utimesSync(file,later,later);
  assert.throws(() => [...old.edges], /index changed/); assert.deepEqual([...G.load(file).edges], []);
  const broken = path.join(home, 'broken.json'); fs.writeFileSync(broken, '{"classes":[],"edges":[["a"');
  assert.throws(() => G.load(broken), /truncated/);
});

test('large duplicated edge arrays stream under a 48 MiB heap instead of allocating a whole graph', () => {
  const file = path.join(home, 'large.json'), fd = fs.openSync(file,'w'), count = 100000;
  const row = JSON.stringify(['pkg.Source#run', 'pkg.Destination#apply', 'calls', 'src/main/java/pkg/'+'part/'.repeat(12)+'Source.java:12', 1, ['Object'], 'pkg.Source#run(Object)']);
  try { fs.writeSync(fd, '{"classes":[],"edges":['); for(let i=0;i<count;i++)fs.writeSync(fd,(i?',':'')+row); fs.writeSync(fd,'],"preciseEdges":[');for(let i=0;i<count;i++)fs.writeSync(fd,(i?',':'')+row);fs.writeSync(fd,']}'); } finally { fs.closeSync(fd); }
  const script = `const g=require(process.argv[1]).load(process.argv[2]);let count=0;for(const edge of g.preciseEdges){if(edge[2]!=='calls')throw Error('wrong edge');count++;}console.log(JSON.stringify({count,heap:process.memoryUsage().heapUsed}));`;
  // V8 coverage changes the memory/timing experiment; keep this proof process unprofiled.
  const result = JSON.parse(execFileSync(process.execPath,['--max-old-space-size=48','-e',script,require.resolve('../lib/codegraph-read'),file],{encoding:'utf8',timeout:30000,env:{...process.env,NODE_V8_COVERAGE:''}}));
  assert.equal(result.count,count); assert.ok(result.heap < 48*1024*1024);
});
