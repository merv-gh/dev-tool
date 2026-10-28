const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-confluence-'));
process.env.DT_HOME = home;
process.env.DT_CACHE_DIR = path.join(home, 'cache');
process.env.DT_PASSPORTS_DIR = path.join(home, 'passports');
process.env.DT_REPOS_DIR = path.join(home, 'repos');
process.env.DT_RATE_PER_SEC = '0';
delete process.env.DT_TOOLS;
const mock = require('../demo/confluence').createMock({ pageSize: 2 });
let retries = 0, embeddingCalls = 0, visionCalls = 0, relationCalls = 0, rerankCalls = 0, base;
const srv = http.createServer((req, res) => {
  const send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.url === '/retry') { if (!retries++) { res.statusCode = 429; res.setHeader('retry-after', '0'); } return send({ ok: true }); }
  if (req.url === '/redirect') { res.statusCode = 302; res.setHeader('location', 'http://other.invalid/secret'); return res.end(); }
  if (req.url === '/v1/embeddings' || req.url === '/v1/chat/completions') {
    let body = ''; req.on('data', b => body += b).on('end', () => {
      const b = JSON.parse(body);
      if (req.url.endsWith('/embeddings')) { embeddingCalls++; return send({ data: b.input.map((s, index) => ({ index, embedding: /refund/i.test(s) ? [1, 0, 0] : [0, 1, 0] })) }); }
      if (b.messages[0].content.startsWith('Extract architectural')) {
        relationCalls++; const blocks = JSON.parse(b.messages[1].content).blocks, block = blocks.find(b => b.text.includes('payment-service') && b.text.includes('sales.payments'));
        return send({ choices: [{ message: { content: JSON.stringify(block ? [{ from: 'payment-service', to: 'sales.payments', kind: 'write', technology: 'PostgreSQL', blockId: block.id }, { from: 'invented-service', to: 'sales.payments', kind: 'calls', blockId: block.id }] : []) } }] });
      }
      if (b.messages[0].content.startsWith('Rank the supplied')) { rerankCalls++; return send({ choices: [{ message: { content: '[0]' } }] }); }
      visionCalls++;
      return send({ choices: [{ message: { content: 'The image shows a manual refund approval form.' } }] });
    }); return;
  }
  if (mock.handle(req, res)) return;
  res.statusCode = 404; res.end();
});
let configuration;
const configure = extra => {
  configuration = { envs: { dev: { postgres: { orders: 'postgres://localhost/orders', archive: 'postgres://localhost/archive' } } }, confluence: { url: base, token: 'secret', type: 'server', spaces: ['SHOP'], ...extra }, llm: { baseUrl: base + '/v1', key: 'llm-secret', model: 'vision-demo' }, server: { ratePerSec: 0 } };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(configuration)); require('../lib/config').reload();
};
test.before(() => new Promise(resolve => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}`; configure(); resolve(); })));
test.after(() => { srv.close(); fs.rmSync(home, { recursive: true, force: true }); });
const C = require('../lib/docs-cache'), P = require('../lib/docs-parse'), S = require('../lib/docs-search');

test('storage parser keeps structure, stable block IDs, source offsets, code, links and issues', () => {
  const page = { id: '42', space: 'SHOP', title: 'Refunds', version: 1, storage: '<h1>Refunds</h1><p>First sentence. Second sentence!</p><h2>Rules</h2><ul><li>Approve &gt; 500 EUR.</li></ul><table><tr><th>Code</th><th>Meaning</th></tr><tr><td>400</td><td>Bad &#114;equest</td></tr></table><ac:structured-macro ac:name="code"><ac:parameter ac:name="language">java</ac:parameter><ac:plain-text-body><![CDATA[if (a < 3) return "safe";]]></ac:plain-text-body></ac:structured-macro><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">SHOP-1</ac:parameter></ac:structured-macro><p><ac:link><ri:page ri:content-title="Payments" ri:space-key="PAY"/></ac:link></p>' };
  const parsed = P.parse(page);
  assert.deepEqual(parsed.blocks.filter(b => b.kind === 'table-row').map(b => b.text), ['Code: 400 | Meaning: Bad request']);
  const rule = parsed.blocks.find(b => b.kind === 'list-item'); assert.deepEqual(rule.path, ['Refunds', 'Rules']);
  assert.equal(parsed.blocks.find(b => b.kind === 'code').language, 'java');
  assert.equal(parsed.blocks.find(b => b.kind === 'code').text, 'if (a < 3) return "safe";');
  assert.equal(parsed.links[0].title, 'Payments'); assert.equal(parsed.links[0].space, 'PAY'); assert.ok(parsed.links[0].blockId);
  assert.equal(parsed.blocks.find(b => b.kind === 'issue').issue, 'SHOP-1');
  for (const b of parsed.blocks) assert.equal(parsed.text.slice(b.start, b.end), b.text);
  const edited = P.parse({ ...page, version: 2, storage: '<p>Inserted earlier.</p>' + page.storage }, parsed.blocks);
  assert.equal(edited.blocks.find(b => b.text === rule.text).id, rule.id, 'unrelated insertion preserves quote ID');
  assert.equal(P.parse({ ...page, storage: '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><p>&secret;</p>' }).blocks[0].text, '&secret;');
  assert.equal(P.parse({ ...page, storage: '<p>&amp;lt; stays encoded &lt;.</p>' }).blocks[0].text, '&lt; stays encoded <.');
  assert.equal(P.hash(Buffer.from([255, 254])), require('crypto').createHash('sha256').update(Buffer.from([255, 254])).digest('hex'));
});

test('Server/DC sync paginates all pages, caches attachments and structure; image vision is off', async () => {
  mock.pages.get('816').body += '<p>Возврат требует проверки статуса платежа.</p>';
  const r = await C.sync();
  assert.equal(r.spaces[0].updated, 10); assert.equal(C.list().length, 10); assert.equal(r.index.pages, 10);
  assert.ok(mock.requests.filter(r => r.path === '/rest/api/content').length >= 5);
  assert.equal(mock.requests.find(r => r.path === '/rest/api/content').authorization, 'Bearer secret');
  const architecture = C.page('810'); assert.ok(architecture.diagrams.some(d => d.nodes.some(n => n.label === 'payment-service')));
  const refunds = C.page('813'); assert.ok(refunds.diagrams.some(d => d.format === 'mermaid'));
  const image = refunds.diagrams.find(d => d.format === 'image'); assert.equal(image.vision, false); assert.match(image.caption, /Manual approval/); assert.equal(visionCalls, 0);
  assert.equal(fs.readFileSync(path.join(C.DIR, 'attachments', refunds.attachments[0].hash)).length, require('../demo/confluence').PNG.length);
  assert.deepEqual(C.page('813', { section: 'Refunds / Rules' }).blocks.map(b => b.kind), ['heading', 'paragraph', 'table-row', 'table-row']);
});

test('contextual lexical search is offline, extractive and quote checking is version-specific', async () => {
  const count = mock.requests.length, result = await S.search('refund approval', { spaces: 'SHOP', hybrid: false });
  assert.equal(mock.requests.length, count); assert.equal(result.mode, 'bm25-trigram'); assert.ok(result.blocks.length);
  const evidence = result.blocks.flatMap(b => b.quotes.map(text => ({ blockId: b.id, text, version: b.version })));
  assert.ok(S.verify(evidence).every(q => q.verified));
  const rule = C.page('813').blocks.find(b => b.text.startsWith('Refunds over'));
  assert.equal(S.verify([{ blockId: rule.id, text: 'Refunds over 500 EUR … manual approval.' }])[0].verified, true);
  assert.equal(S.verify([{ blockId: rule.id, text: 'Refunds under 500 EUR need a manual approval.' }])[0].verified, false);
  assert.equal(S.verify([{ blockId: rule.id, text: 'manual approval … Refunds over' }])[0].verified, false);
  assert.equal((await S.search('refund', { spaces: 'MISSING' })).total, 0);
  assert.throws(() => C.page('../secret'), /Invalid/);
});

test('incremental sync skips identical versions and attachment downloads; historical evidence survives', async () => {
  const before = C.page('813'), rule = before.blocks.find(b => b.text.startsWith('Refunds over')), downloads = mock.requests.filter(r => r.path.startsWith('/download/')).length;
  const r = await C.sync(); assert.equal(r.spaces[0].mode, 'incremental'); assert.equal(r.spaces[0].updated, 0); assert.equal(r.spaces[0].unchanged, 10);
  const page = mock.pages.get('813'); page.version++; page.body = '<p>New note.</p>' + page.body.replace('500 EUR need', '600 EUR need');
  const changed = await C.sync(); assert.equal(changed.spaces[0].updated, 1);
  assert.equal(mock.requests.filter(r => r.path.startsWith('/download/')).length, downloads);
  assert.equal(S.verify([{ blockId: rule.id, text: rule.text, version: before.version }])[0].verified, true);
  assert.equal(S.verify([{ blockId: rule.id, text: rule.text }])[0].verified, false);
  assert.ok(mock.requests.find(r => r.query.cql?.includes('lastmodified >=')));
});

test('failed incremental page does not advance checkpoint or erase cached content', async () => {
  const stateFile = path.join(C.DIR, '_state.json'), checkpoint = fs.readFileSync(stateFile, 'utf8'), p = mock.pages.get('812'), before = C.page('812');
  p.version++; p.fail = true;
  const r = await C.sync(); assert.equal(r.spaces[0].errors[0].id, '812'); assert.equal(fs.readFileSync(stateFile, 'utf8'), checkpoint); assert.equal(C.page('812').version, before.version);
  p.fail = false; assert.equal((await C.sync()).spaces[0].errors.length, 0);
});

test('attachment-only version changes are discovered without fetching unchanged page bodies', async () => {
  const before = C.page('810'), a = mock.pages.get('810').attachments[0], bodies = mock.requests.filter(r => r.path === '/rest/api/content/810').length;
  a.version++; a.data = Buffer.from(require('../demo/confluence').DRAWIO.replace('value="HTTP"', 'value="HTTPS"'));
  const r = await C.sync(); assert.equal(r.spaces[0].updated, 1);
  const updated = C.page('810'); assert.notEqual(updated.attachments[0].hash, before.attachments[0].hash); assert.equal(updated.version, before.version);
  assert.ok(updated.diagrams.some(d => d.relations?.some(r => r.label === 'HTTPS')));
  assert.equal(mock.requests.filter(r => r.path === '/rest/api/content/810').length, bodies);
});

test('daily reconciliation removes deleted pages and handles moves between spaces', async () => {
  const historical = C.page('819'), quote = historical.blocks.find(b => b.kind === 'paragraph');
  mock.pages.delete('819'); mock.pages.get('818').space = 'PAY';
  const r = await C.sync({ spaces: 'SHOP,PAY', full: true });
  assert.equal(r.spaces[0].deleted, 2); assert.equal(r.spaces[1].updated, 1);
  assert.equal(C.list('SHOP').length, 8); assert.equal(C.page('818').space, 'PAY');
  assert.throws(() => C.page('819'), /not cached/);
  assert.equal(S.verify([{ blockId: quote.id, space: 'SHOP', version: historical.version, text: quote.text }])[0].verified, true, 'old citation remains verifiable after page deletion');
  assert.equal((await S.search('former approval threshold', { hybrid: false })).blocks.some(b => b.pageId === '819'), false);
});

test('Cloud adapter uses v2 pages/spaces/attachments/ancestors and basic email/token auth', async () => {
  const client = C.createClient({ ...C.config(), type: 'cloud', user: 'person@example.com' });
  const r = await C.sync({ spaces: 'SHOP', full: true, client }); assert.equal(r.spaces[0].updated, 8);
  assert.ok(mock.requests.some(r => r.path === '/api/v2/spaces/1/pages'));
  const request = mock.requests.find(r => r.path === '/api/v2/pages/813');
  assert.equal(request.query['body-format'], 'storage'); assert.equal(request.authorization, 'Basic ' + Buffer.from('person@example.com:secret').toString('base64'));
  assert.ok(mock.requests.some(r => r.path === '/api/v2/pages/813/attachments'));
  assert.ok(mock.requests.some(r => r.path === '/api/v2/pages/813/ancestors'));
  assert.throws(() => C.createClient({ ...C.config(), type: 'cloud' }), /requires/);
  const server = C.createClient({ ...C.config(), type: 'server', user: 'ignored@example.com' }); assert.equal(server.cloud, false);
});

test('rate-limit retry is bounded and page/attachment credentials cannot cross origins', async () => {
  const client = C.createClient(); assert.deepEqual(await client.request('/retry'), { ok: true }); assert.equal(retries, 2);
  await assert.rejects(client.request('http://elsewhere.invalid/private'), /cross-origin/);
  await assert.rejects(client.request('/redirect'), /cross-origin/);
});

function seedSystem() {
  const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
  write(path.join(home, 'cache/dev/pg/orders.json'), { db: 'orders', tables: [{ schema: 'sales', name: 'orders', kind: 'table', columns: [{ name: 'id', type: 'bigint' }] }, { schema: 'sales', name: 'payments', kind: 'table', columns: [{ name: 'order_id', type: 'bigint' }] }], functions: [] });
  write(path.join(home, 'cache/dev/pg/archive.json'), { db: 'archive', tables: [{ schema: 'history', name: 'orders', kind: 'table', columns: [] }], functions: [] });
  write(path.join(home, 'cache/dev/kafka/payment_received.json'), { topic: 'payment_received', partitions: 3, valueSchema: { version: 2, type: 'AVRO', schema: '{"type":"record","name":"Payment","fields":[]}' }, fields: { orderId: 'number' } });
  for (const service of ['order-service', 'payment-service', 'notification-service']) {
    const endpoint = service === 'payment-service' ? [{ method: 'POST', path: '/api/payments/{orderId}/refund', handler: 'PaymentController.refund', file: 'PaymentController.java', line: 14 }] : [];
    const tables = service === 'payment-service' ? [{ table: 'sales.payments', access: 'write', file: 'PaymentDao.java', line: 30 }] : service === 'order-service' ? [{ table: 'sales.orders', access: 'read', file: 'OrderDao.java', line: 10 }] : [];
    const produces = service === 'payment-service' ? [{ topic: 'payment_received', file: 'PaymentPublisher.java', line: 16 }] : [];
    const consumes = service === 'notification-service' ? [{ topic: 'payment_received', file: 'NotificationListener.java', line: 10 }] : [];
    const calls = service === 'order-service' ? [{ client: 'payment-service', method: 'POST', path: '/api/payments', file: 'PaymentClient.java', line: 5 }] : [];
    write(path.join(home, 'passports', service, 'passport.json'), { service, builtAt: new Date().toISOString(), repo: { project: 'SHOP', repo: service, sha: 'abc123' }, summary: { endpoints: endpoint.length, consumes: consumes.map(t => t.topic), produces: produces.map(t => t.topic), tables: Object.fromEntries(tables.map(t => [t.table, [t.access]])), calls: calls.map(t => t.client), libraries: [] }, effective: { endpoints: endpoint, tables, produces, consumes, calls }, flows: endpoint.map(e => ({ entry: `${e.method} ${e.path}`, kind: 'http', out: { tables, produces } })) });
  }
}

test('graph links exact entities, preserves ambiguity and provenance, and flags the planted docs gap', () => {
  seedSystem();
  const K = require('../lib/knowledge'), graph = K.build('dev');
  assert.ok(graph.relations.some(r => r.from === 'service:payment-service' && r.to === 'topic:payment_received' && r.confidence === 'verified'));
  assert.ok(graph.relations.some(r => r.from === 'service:order-service' && r.to === 'service:payment-service' && r.confidence === 'stated'));
  assert.ok(graph.mentions.some(m => m.entity === 'service:payment-service' && m.blockId));
  const page = { id: '1', space: 'SHOP', title: 'Ambiguity', version: 1, blocks: [{ id: 'p1.b1', text: 'orders order-service-extra', path: [] }] };
  const ambiguous = K.build('dev', { pages: [page] });
  assert.ok(ambiguous.mentions.some(m => m.name === 'orders' && m.candidates.length >= 2 && !m.entity));
  assert.equal(ambiguous.mentions.some(m => m.entity === 'service:order-service'), false);
  assert.ok(graph.gaps.some(g => g.to === 'external:fraud-service'));
  assert.equal(graph.gaps.some(g => g.from === 'service:payment-service' && g.to === 'topic:payment_received'), false, 'diagram Kafka arrow agrees with verified producer');
  assert.equal(graph.gaps.some(g => g.from === 'service:payment-service' && g.to === 'table:orders:sales.payments'), false, 'diagram update agrees with verified write');
});

test('feature joins exact evidence, cached code/database/Kafka and diagram exports in one call', async () => {
  const r = await require('../lib/knowledge').feature('How do refunds work?', { env: 'dev', spaces: 'SHOP', limit: 8 });
  assert.ok(r.evidence.length > 0 && r.evidence.length <= 8 && r.evidence.every(e => e.verified));
  assert.ok(r.model.nodes.some(n => n.kind === 'topic' && n.schema?.version === 2));
  assert.ok(r.model.nodes.some(n => n.name === 'sales.payments'));
  assert.ok(r.model.flows.some(f => f.name === 'POST /api/payments/{orderId}/refund'));
  assert.ok(r.diagrams.some(d => d.format === 'mermaid' && d.source.includes('sequenceDiagram')));
  assert.ok(r.diagrams.some(d => d.format === 'plantuml' && d.source.includes('@startuml')));
  assert.ok(r.diagrams.some(d => d.format === 'structurizr' && d.source.includes('workspace')));
  assert.ok(r.gaps.some(g => g.to === 'external:fraud-service'));
  const id = r.view.split('/').at(-1), result = require('../lib/results').load(id); assert.equal(result.view, 'diagram');
  const localized = await require('../lib/knowledge').feature('Возврат', { env: 'dev', spaces: 'SHOP', limit: 1 });
  assert.ok(localized.evidence.some(e => e.verified && e.text.includes('Возврат')), 'Unicode evidence is preserved');
});

test('optional embedding enrichment is cached; query results fuse with RRF; vision is explicitly enabled', async () => {
  configure({ embeddings: { enabled: true, baseUrl: base + '/v1', model: 'mock-embedding' } });
  await S.build(); const afterBuild = embeddingCalls; assert.ok(afterBuild > 0);
  await S.build(); assert.equal(embeddingCalls, afterBuild, 'unchanged blocks do not embed twice');
  const r = await S.search('refund'); assert.match(r.mode, /rrf/); assert.equal(embeddingCalls, afterBuild + 1);
  configure({ vision: true });
  await C.sync({ full: true }); const image = C.page('813').diagrams.find(d => d.format === 'image');
  assert.equal(image.vision, true); assert.equal(image.provenance, 'docs:image:inferred'); assert.equal(visionCalls, 1);
  await C.sync({ full: true }); assert.equal(visionCalls, 1, 'vision result reused by attachment hash');
  configure();
});

test('optional relation extraction remains inferred and rejects names absent from source evidence', async () => {
  configure({ extractRelations: true, rerank: true });
  await C.sync({ full: true });
  const p = C.page('812'); assert.equal(p.inferredRelations.length, 1); assert.equal(p.inferredRelations[0].from, 'payment-service'); assert.ok(relationCalls > 0);
  const graph = require('../lib/knowledge').build('dev');
  assert.ok(graph.relations.some(r => r.confidence === 'inferred' && r.provenance.status === 'inferred'));
  assert.equal(graph.nodes.some(n => n.name === 'invented-service'), false);
  const result = await S.search('refund', { rerank: true }); assert.match(result.mode, /rerank/); assert.equal(rerankCalls, 1);
  const calls = relationCalls; await C.sync({ full: true }); assert.equal(relationCalls, calls, 'identical page/model extraction reused');
  configure();
});

test('registry exposes cached docs, quote verification, feature and exports through standard tools', async () => {
  const tools = require('../lib/tools');
  const result = await tools.call('docs_search', { query: 'refund', spaces: 'SHOP' }); assert.ok(result.blocks.length);
  const page = await tools.call('docs_page', { id: '813' }); assert.equal(page.title, 'Refunds');
  const row = page.blocks.find(b => b.kind === 'table-row');
  assert.equal((await tools.call('docs_verify', { quotes: [{ blockId: row.id, text: row.text }] }))[0].verified, true);
  const diagram = await tools.call('diagram', { model: { nodes: [{ id: 'pay', name: 'Payments' }], relations: [] }, format: 'mermaid' }); assert.match(diagram.source, /flowchart/);
  assert.ok(require('../lib/indexer').WHAT.includes('confluence'));
});
