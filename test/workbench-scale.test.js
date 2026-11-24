const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-workbench-scale-'));
process.env.DT_CONFIG_DIR = home; process.env.DT_CACHE_DIR = path.join(home, 'cache');
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
const E = require('../lib/workspace-editor'), W = require('../lib/workspace'), A = require('../lib/access');
let workspace, root;
test.before(async () => {
  const seed = path.join(home, 'seed'); fs.mkdirSync(seed);
  const git = (...args) => execFileSync('git', args, { cwd: seed, env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' }, stdio: 'pipe' });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(seed, 'README.md'), 'fixture'); git('add', '.'); git('commit', '-qm', 'fixture');
  workspace = await W.open({ project: 'TEST', repo: 'scale', ref: 'main', url: 'file://' + seed }); root = W.checkId(workspace.id).path;
  for (let i = 0; i < 20000; i++) { const dir = path.join(root, i < 5000 ? 'wide' : 'services/service-' + Math.floor(i / 150) + '/src/main/java'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'Файл-' + String(i).padStart(5, '0') + '.java'), '// fixture\n'); }
  fs.symlinkSync(home, path.join(root, 'external'));
});
test.after(async () => { await require('../lib/isolate').stop(); await require('../lib/state-store').close(); fs.rmSync(home, { recursive: true, force: true }); });
test('all 5,000 folder entries are reachable with stable pages; stale and cross-folder cursors fail explicitly', () => {
  let cursor, all = [], first;
  do { const p = E.tree(workspace.id, 'wide', { limit: 150, cursor }); first ||= p; all.push(...p.entries.map(e => e.path)); cursor = p.next_cursor; } while (cursor);
  assert.equal(all.length, 5000); assert.equal(new Set(all).size, 5000); assert.equal(first.total, 5000);
  assert.throws(() => E.tree(workspace.id, '.', { cursor: first.next_cursor }), /another folder/);
  assert.throws(() => E.tree(workspace.id, 'wide', { cursor: 'garbage' }), /Invalid continuation/);
  fs.writeFileSync(path.join(root, 'wide', 'new.java'), 'new'); assert.throws(() => E.tree(workspace.id, 'wide', { cursor: first.next_cursor }), { code: 'DT_EDITOR_STALE_CURSOR' });
  fs.unlinkSync(path.join(root, 'wide', 'new.java'));
});
test('20,000 paths are searchable without reading contents; Unicode, refresh, cursor and ownership remain correct', async () => {
  const all = await E.search(workspace.id, 'Файл', { limit: 1000 }); assert.equal(all.total, 20000); assert.ok(all.indexed_files >= 20000);
  let cursor, seen = new Set(); do { const p = await E.search(workspace.id, 'Файл', { limit: 1000, cursor }); for (const e of p.entries) seen.add(e.path); cursor = p.next_cursor; } while (cursor);
  assert.equal(seen.size, 20000);
  const last = await E.search(workspace.id, '19999'); assert.equal(last.entries.length, 1); assert.match(E.read(workspace.id, last.entries[0].path).content, /fixture/);
  assert.equal((await E.search(workspace.id, 'external')).total, 0);
  fs.writeFileSync(path.join(root, 'Файл-added.txt'), 'refresh'); const refreshed = await E.search(workspace.id, 'added', { refresh: true }); assert.equal(refreshed.total, 1);
  await assert.rejects(E.search(workspace.id, 'Файл', { cursor: all.next_cursor }), { code: 'DT_EDITOR_STALE_CURSOR' });
  await A.run({ principalId: 'other', storyId: 'other', multiUser: true }, async () => assert.rejects(E.search(workspace.id, 'Файл'), /available|no workspace/));
});
test('fixed-width graph model keeps shared call sites, cycles and directly searchable fields distinct', () => {
  const P = require('../web/views/_path-browser');
  const nodes = Array.from({ length: 50000 }, (_, i) => ({ id: String(i), label: 'Method ' + i, kind: 'method', field: i === 49999 ? 'response.fio' : undefined }));
  const edges = Array.from({ length: 200 }, (_, i) => ({ id: 'call:' + i, from: String(i), to: String(i + 1), callSite: 'Handler.java:' + i }));
  edges.push({ id: 'shared', from: '5', to: '200' }, { id: 'cycle', from: '200', to: '100' });
  const graph = P.graph(nodes, edges); assert.equal(graph.search('response.fio').items[0].id, '49999'); assert.equal(graph.incoming.get('200').length, 2); assert.equal(graph.outgoing.get('200')[0].id, 'cycle'); assert.equal(graph.incoming.get('100').length, 2);
  const occurrences = P.pathGraph({ nodes: [{ id: 1, code: 'same()' }, { id: 1, code: 'same()' }] }); assert.equal(occurrences.byId.size, 2); assert.equal(occurrences.edges.length, 1);
});
test('path occurrence defaults never replace a library source identity or explicit unknown revision', () => {
  const P = require('../web/views/_path-browser');
  const graph = P.pathGraph({ nodes: [{ repo: 'LIB/handler', sha: 'library-sha', evidence: 'Library evidence', file: 'Handler.java' }, { repo: 'LIB/unknown', revision: null, revisionKey: null }, { code: 'app()' }] }, { repo: 'APP/person', revision: 'app-sha', revisionKey: 'app-index', evidence: 'App evidence' });
  assert.equal(graph.nodes[0].repo, 'LIB/handler'); assert.equal(graph.nodes[0].revision, 'library-sha'); assert.equal(graph.nodes[0].evidence, 'Library evidence'); assert.equal(graph.nodes[0].revisionKey, undefined);
  assert.equal(graph.nodes[1].revision, null); assert.equal(graph.nodes[1].revisionKey, null); assert.equal(graph.nodes[2].revisionKey, 'app-index');
});
test('all navigation captures filters/pages and route selections use their own edge with bounded forward history', () => {
  const P = require('../web/views/_path-browser'), b = Object.create(P.Browser.prototype);
  Object.assign(b, { graph: P.graph([{ id: 'a' }, { id: 'b' }], [{ id: 'ab', from: 'a', to: 'b' }]), history: [], position: -1, query: '', offset: 0, relations: {}, content: { scrollTop: 0 }, restore() { const s = this.history[this.position]; this.query = s.query; this.offset = s.offset; this.relations = structuredClone(s.relations); } });
  b.focus('a'); b.focus('b', b.graph.byEdge.get('ab')); b.travel(-1); b.query = 'changed after Back'; b.offset = 25; b.relations = { to: { query: 'late call site', offset: 50 } }; b.travel(1); b.travel(-1);
  assert.equal(b.query, 'changed after Back'); assert.equal(b.offset, 25); assert.equal(b.relations.to.offset, 50);
  b.focus('a', undefined, [{ id: 'a' }]); assert.equal(b.history.at(-1).edge, undefined); assert.equal(b.history.length, b.position + 1);
  for (let i = 0; i < 250; i++) b.focus(i % 2 ? 'a' : 'b'); assert.equal(b.history.length, 200);
});
