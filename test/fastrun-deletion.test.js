// Exercise the fast-run lifecycle without requiring Maven/JDK downloads. The fake compiler
// leaves obsolete outputs exactly as an incremental compiler does; only Maven clean removes them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fast-delete-'));
process.env.DT_HOME = home;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const root = path.join(home, 'project'), javaHome = path.join(home, 'jdk');
const program = (file, source) => { put(file, `#!${process.execPath}\n${source}`); fs.chmodSync(file, 0o755); };
const commandLog = path.join(home, 'maven-runs.jsonl');
const compileFailure = path.join(home, 'fail-javac');
program(path.join(javaHome, 'bin', 'javac'), `
const fs = require('fs'), path = require('path'), args = process.argv.slice(2);
if (args.includes('-version')) { process.stderr.write('javac 17.0.1'); process.exit(0); }
const out = args[args.indexOf('-d') + 1]; fs.mkdirSync(out, { recursive: true });
for (const file of args.filter(a => a.endsWith('.java'))) fs.writeFileSync(path.join(out, path.basename(file, '.java') + '.class'), 'compiled');
if (fs.existsSync(${JSON.stringify(compileFailure)})) process.exit(1);
`);
program(path.join(javaHome, 'bin', 'java'), `
const fs = require('fs'), args = process.argv.slice(2);
fs.writeFileSync(args[args.indexOf('DtLauncher') + 1], '[]');
`);
const fakeMaven = path.join(home, 'maven.js');
put(fakeMaven, `
const fs = require('fs'), path = require('path'), args = process.argv.slice(2), root = process.cwd();
fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify(args) + '\\n');
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
if (args.includes('clean')) fs.rmSync(path.join(root, 'target'), { recursive: true, force: true });
for (const kind of ['main', 'test']) {
  const out = path.join(root, 'target', kind === 'main' ? 'classes' : 'test-classes'); fs.mkdirSync(out, { recursive: true });
  for (const file of walk(path.join(root, 'src', kind, 'java'))) if (file.endsWith('.java')) fs.writeFileSync(path.join(out, path.basename(file, '.java') + '.class'), 'compiled');
  const resources = path.join(root, 'src', kind, 'resources');
  for (const file of walk(resources)) { const dest = path.join(out, path.relative(resources, file)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(file, dest); }
}
const jars = ['junit-platform-engine-1.10.0.jar', 'junit-platform-launcher-1.10.0.jar'].map(name => path.join(root, name));
for (const jar of jars) fs.writeFileSync(jar, 'jar');
const cp = args.find(a => a.startsWith('-Dmdep.outputFile=')); if (cp) fs.writeFileSync(cp.split('=').slice(1).join('='), jars.join(path.delimiter));
`);

const main = path.join(root, 'src/main/java'), resources = path.join(root, 'src/test/resources');
put(path.join(root, 'pom.xml'), '<project/>');
put(path.join(main, 'Keep.java'), 'class Keep {}');
put(path.join(main, 'Old.java'), 'class Old {}');
put(path.join(root, 'src/test/java/OldTest.java'), 'class OldTest {}');
put(path.join(resources, 'old.properties'), 'old');
put(path.join(resources, 'keep.properties'), 'keep');
const out = (...p) => path.join(root, 'target', ...p);
const logs = [];
const run = () => require('../lib/fastrun').run({ id: 'deletions', root, plan: { tool: 'maven', module: '.', modDir: root }, cfg: { javaHome, mavenRepo: path.join(home, 'm2'), args: [], timeoutMs: 30000 }, env: process.env, mvn: { cmd: process.execPath, args: [fakeMaven] }, selectors: ['OldTest'], graph: { classes: [], edges: [] }, log: s => logs.push(s) });
const addIncremental = (file, text) => { put(file, text); const future = new Date(Date.now() + 2000); fs.utimesSync(file, future, future); };

test('deleted original, incrementally added and failed-compile inputs force a clean preparation', async () => {
  const first = await run();
  assert.equal(first.code, 0, first.out);
  assert.equal(first.prepared, true);
  assert.ok(fs.existsSync(out('classes', 'Old.class')));
  assert.ok(fs.existsSync(out('test-classes', 'old.properties')));
  addIncremental(path.join(main, 'Added.java'), 'class Added {}');
  addIncremental(path.join(resources, 'added.properties'), 'added');
  const second = await run();
  assert.equal(second.code, 0, second.out);
  assert.equal(second.prepared, false);
  assert.ok(fs.existsSync(out('classes', 'Added.class')));
  assert.ok(fs.existsSync(out('test-classes', 'added.properties')));
  for (const file of [path.join(main, 'Old.java'), path.join(main, 'Added.java'), path.join(root, 'src/test/java/OldTest.java'), path.join(resources, 'old.properties'), path.join(resources, 'added.properties')]) fs.rmSync(file);
  const third = await run();
  assert.equal(third.code, 0, third.out);
  assert.equal(third.prepared, true);
  for (const file of [out('classes', 'Old.class'), out('classes', 'Added.class'), out('test-classes', 'OldTest.class'), out('test-classes', 'old.properties'), out('test-classes', 'added.properties')]) assert.equal(fs.existsSync(file), false, file);
  assert.ok(fs.existsSync(out('classes', 'Keep.class')));
  assert.equal(fs.readFileSync(out('test-classes', 'keep.properties'), 'utf8'), 'keep');
  assert.ok(logs.some(s => /5 deleted source\/resource files/.test(s)));

  // javac can produce some class files and then fail. Those attempted inputs must
  // also be tracked, even though the last successful compilation stamp stays put.
  addIncremental(path.join(main, 'Bad.java'), 'class Bad {}');
  put(compileFailure, 'fail');
  const failed = await run();
  assert.equal(failed.phase, 'compile');
  assert.ok(fs.existsSync(out('classes', 'Bad.class')));
  fs.rmSync(compileFailure); fs.rmSync(path.join(main, 'Bad.java'));
  const recovered = await run();
  assert.equal(recovered.code, 0, recovered.out);
  assert.equal(recovered.prepared, true);
  assert.equal(fs.existsSync(out('classes', 'Bad.class')), false);
  const commands = fs.readFileSync(commandLog, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(commands.length, 3, 'normal edits use javac without another Maven invocation');
  assert.equal(commands[0].includes('clean'), false);
  assert.ok(commands.slice(1).every(args => args.includes('clean')));
});
