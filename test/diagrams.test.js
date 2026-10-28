const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { parseDiagram, write, render, generate, sanitizeSvg } = require('../lib/diagrams');

const model = {
  name: 'Refunds',
  nodes: [
    { id: 'person:customer', name: 'Customer', kind: 'person' },
    { id: 'service:payments', name: 'Payment service', kind: 'service', technology: 'Java', version: 'abc123', owner: 'Payments', provenance: { source: 'code', status: 'verified', file: 'Payment.java', line: 12 } },
    { id: 'topic:refund_created', name: 'refund_created', kind: 'topic', technology: 'Kafka', schema:{version:2,schema:'{"name":"RefundCreated"}'}, partitions:3, lastMessageAt:'2026-10-28T10:00:00Z' },
    { id: 'db:pay', name: 'Payments DB', kind: 'database', technology: 'Postgres', tables: ['pay.refunds'] },
    { id: 'service:fraud', name: 'Fraud service', kind: 'external' },
  ],
  relations: [
    { from: 'person:customer', to: 'service:payments', label: 'Request refund', technology: 'HTTP', provenance: { source: 'code', status: 'verified' } },
    { from: 'service:payments', to: 'topic:refund_created', label: 'Publish refund', provenance: { source: 'docs:diagram', blockId: 'p42.b3' } },
    { from: 'service:payments', to: 'db:pay', label: 'Write refund', confidence: 'verified' },
    { from: 'service:payments', to: 'service:fraud', label: 'Check fraud', conflict: true },
  ],
  flows: [
    { name: 'Refund', steps: [{ from: 'person:customer', to: 'service:payments', label: 'POST /refund', provenance: { source: 'code' } }, { from: 'service:payments', to: 'topic:refund_created', label: 'refund_created', provenance: { source: 'docs:prose' } }] },
    { name: 'Persist', steps: [{ from: 'service:payments', to: 'db:pay', label: 'INSERT refund', provenance: { source: 'code' } }] },
  ],
};

test('draw.io reads cells, HTML labels, arrows and wrapped UserObjects', () => {
  const d = parseDiagram('drawio', `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="svc" value="&lt;b&gt;Orders&lt;/b&gt; &amp;amp; API" vertex="1"/><UserObject id="db" label="Orders DB"><mxCell vertex="1"/></UserObject><mxCell id="edge" source="svc" target="db" value="writes" edge="1"/></root></mxGraphModel>`);
  assert.deepEqual(d.nodes, [{ id: 'db', label: 'Orders DB' }, { id: 'svc', label: 'Orders & API' }]);
  assert.deepEqual(d.relations, [{ from: 'svc', to: 'db', label: 'writes' }]);
});

test('draw.io decodes compressed, URL-encoded, multi-page and escaped XML', () => {
  const xml = '<mxGraphModel><root><mxCell id="a" value="Платёж" vertex="1"/><mxCell id="b" value="Orders" vertex="1"/><mxCell edge="1" source="a" target="b" value="HTTP"/></root></mxGraphModel>';
  const compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');
  const d = parseDiagram('draw.io', `<mxfile><diagram name="First">${compressed}</diagram><diagram name="Second"><mxGraphModel><root><mxCell id="c" value="Third" vertex="1"/></root></mxGraphModel></diagram></mxfile>`);
  assert.equal(d.nodes.find(n => n.id === 'a').label, 'Платёж');
  assert.equal(d.nodes.length, 3);
  assert.equal(d.relations[0].label, 'HTTP');
  const escaped = xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  assert.equal(parseDiagram('drawio', `<diagram>${escaped}</diagram>`).nodes.length, 2);
  assert.throws(() => parseDiagram('drawio', '<diagram>%%%broken</diagram>'), /compressed draw.io/);
  assert.throws(() => parseDiagram('drawio', '<!DOCTYPE x [<!ENTITY file SYSTEM "file:///etc/passwd">]><mxGraphModel/>'), /entities/);
});

test('Gliffy extracts text children and line endpoint constraints', () => {
  const d = parseDiagram('gliffy', JSON.stringify({ stage: { objects: [
    { id: 1, uid: 'shape', graphic: { Shape: {} }, children: [{ id: 11, graphic: { Text: { text: '<p>Payments</p>' } } }] },
    { id: 2, uid: 'shape', graphic: { Shape: {} }, name: 'Kafka' },
    { id: 3, graphic: { Line: {} }, children: [{ id: 31, graphic: { Text: { text: 'publishes' } } }], constraints: { startConstraint: { startPositionConstraint: { nodeId: 1 } }, endConstraint: { endPositionConstraint: { nodeId: 2 } } } },
  ] } }));
  assert.equal(d.nodes.find(n => n.id === '1').label, 'Payments');
  assert.deepEqual(d.relations, [{ from: '1', to: '2', label: 'publishes' }]);
  assert.equal(d.nodes.length,2,'shape labels and edge labels do not become orphan nodes');
});

test('PlantUML parses sequence aliases, reverse arrows and C4 macros without evaluating includes', () => {
  const d = parseDiagram('plantuml', '@startuml\n!includeurl https://example.invalid/private\nactor "Customer" as customer\nparticipant payment as "Payment Service"\ncustomer -> payment: POST /refund\npayment <-- customer: retry\n@enduml');
  assert.equal(d.nodes.find(n => n.id === 'payment').label, 'Payment Service');
  assert.deepEqual(d.relations.map(r => [r.from, r.to, r.label]), [['customer', 'payment', 'POST /refund'], ['customer', 'payment', 'retry']]);
  const c4 = parseDiagram('puml', 'Person(user, "A, B")\nContainer(service, "Payment \\"API\\"", "Java", "Refund")\nContainerDb(db, "Pay DB", "Postgres")\nRel(service, db, "writes", "SQL")');
  assert.equal(c4.nodes.find(n => n.id === 'user').label, 'A, B');
  assert.equal(c4.nodes.find(n => n.id === 'db').kind, 'database');
  assert.equal(c4.relations[0].technology, 'SQL');
});

test('Mermaid parses flowchart labels, chained edges, C4 and sequence messages', () => {
  const d = parseDiagram('mermaid', 'flowchart LR\nsvc["Payment service"] -->|HTTP| fraud[Fraud]\nsvc -.-> db[(Payments)]\nsvc --> topic --> consumer\nsvc -- publishes --> topic');
  assert.equal(d.nodes.find(n => n.id === 'svc').label, 'Payment service');
  assert.equal(d.nodes.find(n => n.id === 'db').kind, 'database');
  assert.ok(d.relations.some(r => r.from === 'topic' && r.to === 'consumer'));
  assert.ok(d.relations.some(r => r.label === 'publishes'));
  assert.equal(d.relations.filter(r => r.to === 'fraud')[0].label, 'HTTP');
  const sequence = parseDiagram('mmd', 'sequenceDiagram\nactor customer as Customer\nparticipant payment as Payment Service\ncustomer->>payment: POST /refund\npayment-->>customer: 202 Accepted');
  assert.equal(sequence.nodes.find(n => n.id === 'payment').label, 'Payment Service');
  assert.equal(sequence.relations.length, 2);
  const c4 = parseDiagram('mermaid', 'C4Container\nContainer(service,"Payment", "Java")\nContainerDb(db,"Pay", "SQL")\nRel(service,db,"writes","SQL")');
  assert.equal(c4.nodes.length, 2);
  assert.equal(c4.relations[0].label, 'writes');
});

test('SVG reads text and explicit edges without fetching images or executing XML', () => {
  const d = parseDiagram('image/svg+xml', '<svg><text id="a">Orders <tspan>API</tspan></text><text data-node-id="b">Payments &amp; refunds</text><path data-source="a" data-target="b" aria-label="calls"/><image href="https://never.invalid"/></svg>');
  assert.equal(d.nodes[0].label, 'Orders API');
  assert.equal(d.nodes[1].label, 'Payments & refunds');
  assert.deepEqual(d.relations, [{ from: 'a', to: 'b', label: 'calls' }]);
  assert.throws(() => parseDiagram('png', 'pixels'), /unsupported diagram/);
  assert.throws(() => parseDiagram('mermaid', 'x'.repeat(8 * 1024 * 1024 + 1)), /8 MiB/);
});

test('Mermaid C4 and sequence writers preserve provenance, conflicts, flow selection and enrichment', () => {
  const source = write(model);
  assert.match(source, /^flowchart LR/);
  assert.match(source, /n1 -->\|"Request refund #91;HTTP#93;"\| n2/);
  assert.match(source, /n2 -\.->\|"Publish refund"\| n3/);
  assert.match(source, /n2 -->\|"Write refund"\| n4/);
  assert.match(source, /linkStyle 3 stroke:#b42318/);
  assert.match(source, /Owner#58; Payments/);
  assert.match(source, /Version#58; abc123/);
  assert.match(source, /pay.refunds/);
  assert.match(source, /Schema#58; RefundCreated v2/);
  assert.match(source, /Partitions#58; 3/);
  assert.match(source, /Last message#58; 2026-10-28T10#58;00#58;00Z/);
  assert.match(source, /Legend/);
  const sequence = write(model, { view: 'sequence:1' });
  assert.match(sequence, /INSERT refund/);
  assert.doesNotMatch(sequence, /POST \/refund/);
  assert.match(sequence, /Note over/);
  assert.equal(write(model), source, 'exports are deterministic');
});

test('PlantUML writes fixed stdlib C4 include, layout, code/docs/conflict tags and sequence', () => {
  for (const [view, type] of [['context','Context'],['container','Container'],['dynamic','Dynamic']]) {
    const source = write(model, { format: 'plantuml', view });
    assert.match(source, new RegExp(`!include <C4/C4_${type}>`));
    assert.match(source, /!pragma layout smetana/);
    assert.match(source, /legend right/);
    assert.match(source, /@enduml$/);
    if (view !== 'dynamic') assert.match(source, /\$tags="conflict"/);
  }
  const container = write(model, { format: 'plantuml' });
  assert.match(container, /ContainerDb\(n4/); assert.match(container, /ContainerQueue\(n3/);
  assert.match(container, /title Refunds/);
  const sequence = write(model, { format: 'plantuml', view: 'sequence', flow: 'Refund' });
  assert.match(sequence, /n1 -> n2 : POST \/refund/); assert.match(sequence, /n2 --> n3 : refund_created/);
  assert.doesNotMatch(sequence, /!include/);
});

test('Structurizr exports nested containers, semantic tags and ordered dynamic views', () => {
  const source = write(model, { format: 'structurizr' });
  assert.match(source, /^workspace "Refunds"/);
  assert.match(source, /architecture = softwareSystem/);
  assert.match(source, /n2 = container "Payment service"/);
  assert.match(source, /n1 = person "Customer"/);
  assert.match(source, /systemContext architecture Context/);
  assert.match(source, /container architecture Container/);
  assert.match(source, /dynamic architecture Flow1 "Refund"/);
  assert.match(source, /relationship "stated" \{\n\s+dashed true/);
  assert.match(source, /relationship "conflict"/);
});

test('writers escape malicious labels, ids, newlines and directives in all formats', () => {
  const attack = '" ]\n!includeurl https://evil.invalid/secret\n@enduml\n<script>evil</script> & [[javascript:evil]] \\';
  const evil = { title: attack, nodes: [{ id: attack, label: attack }], relations: [{ from: attack, to: 'other', label: attack }] };
  for (const format of ['mermaid', 'plantuml', 'structurizr']) {
    const source = write(evil, { format });
    assert.doesNotMatch(source, /\n!includeurl|\n<script>|\n@enduml\n/);
    if (format !== 'structurizr') assert.doesNotMatch(source, /<script>/);
    assert.ok(source.includes('n1'), 'untrusted ids become stable aliases');
  }
  assert.throws(() => write(model, { format: 'bogus' }), /unsupported diagram format/);
  assert.throws(() => write(model, { view: 'bogus' }), /unsupported diagram view/);
  assert.equal(generate(model).length, 9, 'two C4 + two flows for each visual format, one DSL export');
});

test('SVG sanitization keeps geometry and safe styles while removing active content and network', () => {
  const dirty = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>evil()</script><evil:script>evil()</evil:script><foreignObject><div>HTML</div></foreignObject><style>@import url(https://evil.invalid);</style><image href="https://evil.invalid/private"/><use href="#secret"/><a href="javascript:evil"><text>Order</text></a><g id="n1"><path d="M0 0L10 20" fill="url(https://evil.invalid)" style="stroke:#b42318;stroke-width:3px;background:url(https://evil.invalid)"/><text onclick='evil()'>Payment &amp; API</text></g></svg>`;
  const clean = sanitizeSvg(dirty);
  assert.match(clean, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg">/);
  assert.match(clean, /<g id="n1">/); assert.match(clean, /style="stroke:#b42318;stroke-width:3px"/);
  assert.match(clean, /Payment &amp; API/);
  assert.doesNotMatch(clean, /script|foreignObject|onload|onclick|https:|javascript|<style|<image|<use|href/);
  assert.equal(sanitizeSvg('<svg><defs><marker id="m"/></defs><path marker-end="url(#m)"/></svg>').includes('url(#m)'), true);
  assert.throws(() => sanitizeSvg('<!DOCTYPE svg><svg></svg>'), /safe SVG/);
  assert.throws(() => sanitizeSvg('<html>error</html>'), /safe SVG/);
});

test('render stays offline by default and accepts a configured Kroki endpoint', async t => {
  const exported = await render(model);
  assert.equal(exported.rendered, false); assert.match(exported.reason, /Configure/); assert.match(exported.source, /@startuml/);
  assert.equal((await render(model, { format: 'mermaid' })).rendered, false);
  assert.equal((await render(model, { format: 'structurizr' })).rendered, false);
  const requests = [];
  const server = http.createServer((req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { requests.push({ method:req.method, body:JSON.parse(body) }); res.setHeader('content-type','image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"><text onclick="evil()">Refund</text></svg>'); }); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => server.close());
  const result = await render(model, { renderer:{ krokiUrl:`http://127.0.0.1:${server.address().port}/` } });
  assert.equal(result.rendered, true); assert.equal(result.renderer, 'kroki'); assert.doesNotMatch(result.svg, /onclick/);
  assert.equal(requests[0].method, 'POST'); assert.equal(requests[0].body.diagram_type, 'plantuml'); assert.equal(requests[0].body.output_format, 'svg');
  assert.equal(requests[0].body.diagram_source, result.source);
  await assert.rejects(() => render(model, { krokiUrl:'file:///tmp/out.svg' }), /HTTP\(S\)/);
  await assert.rejects(() => render(model, { krokiUrl:'http://user:pass@127.0.0.1' }), /credentials/);
});

test('runner receives generated source as environment data and enables the SANDBOX security profile', async () => {
  let captured;
  const runner = { async exec(cmd, args, opts) { captured = { cmd, args, opts }; return { code:0, out:'<svg><text>Refund</text></svg>' }; } };
  const result = await render(model, { plantumlJar:'/opt/plantuml.jar', java:'/opt/jdk/bin/java', runner });
  assert.equal(result.renderer, 'runner'); assert.equal(captured.cmd, 'sh');
  assert.equal(captured.opts.env.DT_DIAGRAM_SOURCE, result.source);
  assert.equal(captured.opts.cwd,require('../lib/config').PATHS.build);
  assert.equal(captured.opts.env.PLANTUML_SECURITY_PROFILE, 'SANDBOX');
  assert.match(captured.args[1], /-DPLANTUML_SECURITY_PROFILE=SANDBOX/);
  assert.ok(!captured.args[1].includes('Payment service'), 'source is never interpolated into shell code');
  await assert.rejects(() => render(model, { jar:'/tmp/absent', runner:{ async exec() { return {code:1,out:'bad JAR'}; } } }), /runner failed/);
});

test('local renderer uses bounded child process stdin, fixed args, secure env and timeout', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(),'dt-diagram-')); t.after(() => fs.rmSync(home,{recursive:true,force:true}));
  const java = path.join(home,'java');
  fs.writeFileSync(java, '#!/usr/bin/env node\nlet input="";process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>{if(process.env.PLANTUML_SECURITY_PROFILE!=="SANDBOX"||!process.argv.includes("-pipe")||!input.startsWith("@startuml"))process.exit(2);process.stdout.write("<svg><text>Rendered</text></svg>");});'); fs.chmodSync(java,0o755);
  const result = await render(model, { java, jar:'unused.jar' }); assert.equal(result.rendered,true); assert.match(result.svg,/Rendered/);
  fs.writeFileSync(java, '#!/usr/bin/env node\nsetInterval(()=>{},1000);');
  await assert.rejects(() => render(model, { java, jar:'unused.jar', timeoutMs:100 }), /timed out/);
});

test('diagram view registers sample model and scripts remain syntactically valid inside sandbox', () => {
  const V = require('../lib/views'); const view = V.get('diagram');
  assert.equal(view.builtin,true); assert.ok(view.sample.model.nodes.length);
  for (const script of view.html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(script[1]));
  const html = V.render('diagram', { model, diagrams: generate(model) }, {}, { metaCsp:true });
  assert.match(html, /connect-src/); // CSP is provided as a response header; source also documents zero network.
});

test('viewer config disables Mermaid HTML labels globally before rendering multiline C4 labels', async () => {
  // Mermaid 11's browser serialization includes HTML void <br> inside a <p> when
  // top-level htmlLabels is unset, even with flowchart.htmlLabels:false. That SVG
  // is not XML and was rejected by the viewer's strict DOMParser. Exercise the
  // viewer initialization/render integration, including the observed bad output.
  const vm = require('node:vm');
  const view = require('../lib/views').get('diagram');
  const elements = new Map();
  class Element {
    constructor(name = 'div') { this.localName = name; this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.clientWidth = 900; this.clientHeight = 500; this.textContent = ''; this.namespaceURI = 'http://www.w3.org/2000/svg'; }
    get attributes() { return Object.entries(this.attrs).map(([name,value]) => ({name,value})); }
    removeAttribute(key) { delete this.attrs[key]; }
    setAttribute(key,value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] || null; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    prepend(...children) { this.children.unshift(...children); }
    querySelectorAll() { return []; }
    addEventListener() {}
  }
  const lookup = selector => { if (!elements.has(selector)) elements.set(selector,new Element()); return elements.get(selector); };
  let config, renderedInput, parsedSvg, parsedLabel;
  const malformedHtmlSvg = '<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Order service<br>Java</p></span></div></foreignObject></g></svg>';
  const xmlSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><g class="node"><text><tspan>Order service</tspan><tspan>Java</tspan></text></g></svg>';
  const context = {
    DATA:{ model:view.sample.model, diagrams:[{name:'Context',format:'mermaid',source:write(view.sample.model,{view:'context'})}] }, META:{},
    dt:{ $:lookup, title() {} }, window:{},
    document:{createElement:name => new Element(name),createElementNS:(_ns,name) => new Element(name),importNode:node => node},
    matchMedia:() => ({matches:false}), ResizeObserver:class { observe() {} },
    DOMParser:class { parseFromString(value) { parsedSvg = value; const invalid = value.includes('<br>'); const svg = new Element('svg'); svg.setAttribute('viewBox','0 0 300 150'); parsedLabel = new Element('text'); parsedLabel.textContent = '&#91;HTTP&#93; &amp; &#60;script&#62;'; svg.querySelectorAll = selector => selector === '*' || selector === 'text,tspan' ? [parsedLabel] : []; return { documentElement:svg, querySelector:() => invalid ? {textContent:'Opening and ending tag mismatch: br line 1 and p'} : null }; } },
    mermaid:{ initialize(value) {config = value;}, async render(_id,input) { renderedInput = input; return {svg:config.htmlLabels === false ? xmlSvg : malformedHtmlSvg}; } },
  };
  context.window.mermaid = context.mermaid;
  vm.runInNewContext([...view.html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],context);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(renderedInput.includes('<br/>Java'), 'real C4 multiline labels are exercised');
  assert.equal(config.htmlLabels,false,'Mermaid 11 reads the global option');
  assert.ok(config.secure.includes('htmlLabels'),'diagram directives cannot re-enable HTML labels');
  assert.equal(parsedSvg,xmlSvg,'only XML-compatible SVG reaches the strict parser');
  assert.equal(parsedLabel.textContent,'[HTTP] & <script>','Mermaid escape artifacts become text, never parsed markup');
  assert.equal(lookup('#diagram-download-svg').disabled,false,'rendering completed and enables SVG export');
  assert.equal(lookup('#diagram-message').hidden,true,'no render error remains');
  const sanitized = sanitizeSvg(malformedHtmlSvg);
  assert.doesNotMatch(sanitized, /foreignObject|<br>|<p>/, 'imported HTML labels cannot survive the server SVG allowlist');
});
