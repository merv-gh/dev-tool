// Deterministic diagram structure and exports. Parsing never evaluates diagram source.
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const MAX_INPUT = 8 * 1024 * 1024;
const MAX_ITEMS = 10000;
const str = value => String(value ?? '');
function entities(value) {
  return str(value).replace(/&#(x[\da-f]+|\d+);/gi, (all, n) => {
    const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n]);
}
function plain(value) { return entities(str(value).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')).trim(); }
function attrs(tag) {
  const out = Object.create(null);
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = entities(m[2] ?? m[3]);
  return out;
}
function collector() {
  const nodes = new Map(), relations = [];
  return {
    node(id, label = id, kind) {
      id = str(id); if (!id || nodes.size >= MAX_ITEMS) return;
      const old = nodes.get(id);
      if (!old || old.label === id) nodes.set(id, { id, label: plain(label) || id, ...(kind ? { kind } : {}) });
    },
    edge(from, to, label = '', technology) {
      if (!from || !to || relations.length >= MAX_ITEMS) return;
      this.node(from); this.node(to);
      relations.push({ from: str(from), to: str(to), label: plain(label), ...(technology ? { technology: plain(technology) } : {}) });
    },
    result() { return { nodes: [...nodes.values()], relations }; },
  };
}
function drawio(text, c, depth = 0) {
  if (depth > 8) throw new Error('draw.io nesting limit exceeded');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML entities are not supported');
  for (const m of text.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram\s*>/gi)) {
    const body = m[1].trim();
    if (!body || body.startsWith('<')) continue;
    let xml;
    try {
      if (body.startsWith('&lt;')) xml = entities(body);
      else {
        if (!/^[\w+/=\s-]+$/.test(body)) throw new Error('invalid base64');
        xml = zlib.inflateRawSync(Buffer.from(body, 'base64'), { maxOutputLength: MAX_INPUT }).toString('utf8');
        if (!xml.trim().startsWith('<')) xml = decodeURIComponent(xml);
      }
    } catch (e) { throw new Error(`invalid compressed draw.io diagram: ${e.message}`); }
    drawio(xml, c, depth + 1);
  }
  // UserObject/Object wraps a cell and supplies its id and visible label.
  const wrappers = [];
  for (const m of text.matchAll(/<(?:UserObject|object)\b([^>]*)>([\s\S]*?)<\/(?:UserObject|object)\s*>/gi)) {
    const a = attrs(m[1]), cell = m[2].match(/<mxCell\b([^>]*)(?:\/?>)/i);
    if (cell) wrappers.push({ ...attrs(cell[1]), ...a, value: a.label || a.value || attrs(cell[1]).value });
  }
  const cells = [...wrappers, ...[...text.matchAll(/<mxCell\b([^>]*)(?:\/?>)/gi)].map(m => attrs(m[1]))];
  for (const a of cells) if (a.vertex === '1' && a.id) c.node(a.id, a.value || a.label || a.id);
  for (const a of cells) if ((a.edge === '1' || a.source || a.target) && a.source && a.target) c.edge(a.source, a.target, a.value || a.label || '');
}
function gliffy(text, c) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  const objects = [], visit = (v, depth = 0) => {
    if (!v || typeof v !== 'object' || depth > 100) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (v.id != null && (v.graphic || v.uid || v.children || v.type)) objects.push(v);
    for (const [k, x] of Object.entries(v)) if (k !== 'graphic') visit(x, depth + 1);
  };
  visit(data);
  const childIds = new Set(objects.flatMap(o => (o.children || []).map(child => child.id)));
  function label(o) {
    const own = o.text ?? o.graphic?.Text?.text ?? o.graphic?.Text?.html ?? o.graphic?.text;
    return own || (o.children || []).map(label).filter(Boolean).join(' ') || o.name || '';
  }
  const endpoint = value => value?.nodeId ?? value?.id ?? value?.objectId;
  for (const o of objects) {
    const line = o.graphic?.Line || o.line;
    const from = endpoint(o.constraints?.startConstraint?.startPositionConstraint) ?? endpoint(o.constraints?.startConstraint) ?? endpoint(line?.startConstraint) ?? o.source;
    const to = endpoint(o.constraints?.endConstraint?.endPositionConstraint) ?? endpoint(o.constraints?.endConstraint) ?? endpoint(line?.endConstraint) ?? o.target;
    if (from != null && to != null) c.edge(str(from), str(to), label(o));
    else if (!line && !(o.graphic?.Text && childIds.has(o.id)) && (label(o) || o.graphic?.Shape)) c.node(str(o.id), label(o) || str(o.id));
  }
}
function args(text) {
  const out = []; let value = '', quoted = false, escaped = false;
  for (const ch of text) {
    if (escaped) { value += ch === 'n' ? '\n' : ch; escaped = false; }
    else if (ch === '\\' && quoted) escaped = true;
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(value.trim()); value = ''; }
    else value += ch;
  }
  out.push(value.trim()); return out;
}
const ident = '[\\w.:-]+';
function uml(text, c) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || /^['!@]/.test(line)) continue;
    let m = line.match(/^(Person(?:_Ext)?|System(?:Db|Queue)?(?:_Ext)?|Container(?:Db|Queue)?(?:_Ext)?|Component(?:Db|Queue)?)\s*\((.*)\)\s*$/i);
    if (m) {
      const a = args(m[2]); c.node(a[0], a[1], /Person/i.test(m[1]) ? 'person' : /Db/i.test(m[1]) ? 'database' : /Queue/i.test(m[1]) ? 'topic' : /_Ext/i.test(m[1]) ? 'external' : /System/i.test(m[1]) ? 'system' : 'service'); continue;
    }
    m = line.match(/^Rel(?:_[\w]+)?\s*\((.*)\)\s*$/i);
    if (m) { const a = args(m[1]); c.edge(a[0], a[1], a[2], a[3]); continue; }
    m = line.match(/^(participant|actor|database|queue|component|rectangle|cloud|boundary|control|entity|collections)\s+(?:"((?:\\.|[^"\\])*)"\s+as\s+([\w.:-]+)|([\w.:-]+)(?:\s+as\s+"((?:\\.|[^"\\])*)")?)/i);
    if (m) { c.node(m[3] || m[4], (m[2] || m[5] || m[4]).replace(/\\n/g, '\n').replace(/\\"/g, '"'), m[1].toLowerCase()); continue; }
    m = line.match(new RegExp(`^("[^"]+"|${ident})\\s*(<?[-.=]+(?:\\[[^\\]]*\\])?[-.=]*[<>]?)\\s*("[^"]+"|${ident})(?:\\s*:\\s*(.*))?$`));
    if (m) { const unquote = x => x.replace(/^"|"$/g, ''); const reverse = m[2].startsWith('<') && !m[2].endsWith('>'); c.edge(unquote(m[reverse ? 3 : 1]), unquote(m[reverse ? 1 : 3]), m[4]); }
  }
}
function mermaid(text, c) {
  // Remove directives/comments: source is data, never configuration or executable callbacks.
  text = text.replace(/%%\{[\s\S]*?\}%%/g, '').replace(/^\s*%%.*$/gm, '');
  const sequence = /\bsequenceDiagram\b/.test(text);
  for (const raw of text.split(/[\r\n]+/)) {
    const line = raw.trim(); let m;
    if (sequence) {
      m = line.match(/^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/);
      if (m) { c.node(m[2], m[3] || m[2], m[1]); continue; }
      m = line.match(/^([\w.:-]+)\s*(?:--?>>?|--?x|--?\))\s*([\w.:-]+)\s*:\s*(.*)$/);
      if (m) c.edge(m[1], m[2], m[3]);
      continue;
    }
    m = line.match(/^(Person|System|Container|ContainerDb|ContainerQueue|System_Ext)\s*\((.*)\)/);
    if (m) { const a = args(m[2]); c.node(a[0], a[1], m[1].toLowerCase()); continue; }
    m = line.match(/^Rel\s*\((.*)\)/); if (m) { const a = args(m[1]); c.edge(a[0], a[1], a[2], a[3]); continue; }
    // Read node definitions separately, including those inline on an arrow.
    for (const n of line.matchAll(/([\w.:-]+)\s*(\[\[|\[\(|\(\(|\[|\(|\{)([^\n]*?)(?:\]\]|\)\]|\)\)|\]|\)|\})/g)) {
      const label = n[3].replace(/^"|"$/g, ''); c.node(n[1], label, n[2] === '[(' ? 'database' : undefined);
    }
    const bare = line.replace(/([\w.:-]+)\s*(?:\[\[|\[\(|\(\(|\[|\(|\{)[^\n]*?(?:\]\]|\)\]|\)\)|\]|\)|\})/g, '$1');
    const re = /(?=([\w.:-]+)\s*(?:-->|---|==>|-\.->)(?:\s*\|([^|]*)\|)?\s*([\w.:-]+))/g;
    for (const e of bare.matchAll(re)) if (e.index === 0 || !/[\w.:-]/.test(bare[e.index - 1])) c.edge(e[1], e[3], e[2] || '');
    m = bare.match(/^([\w.:-]+)\s*--\s+(.+?)\s*-->\s*([\w.:-]+)/);
    if (m) c.edge(m[1], m[3], m[2]);
  }
}
function svgStructure(text, c) {
  let count = 0;
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML entities are not supported');
  for (const m of text.matchAll(/<(text|title)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const a = attrs(m[2]), label = plain(m[3]); if (label) c.node(a['data-node-id'] || a.id || `text${++count}`, label);
  }
  for (const m of text.matchAll(/<(?:path|line|g)\b([^>]*)>/gi)) {
    const a = attrs(m[1]); if (a['data-source'] && a['data-target']) c.edge(a['data-source'], a['data-target'], a['aria-label'] || a['data-label']);
  }
}
function parseDiagram(kind, input) {
  kind = str(kind).toLowerCase().replace(/^.*\//, '').replace(/\+xml$/, '');
  const text = typeof input === 'object' && !Buffer.isBuffer(input) ? input : str(input);
  if ((typeof text === 'string' ? Buffer.byteLength(text) : Buffer.byteLength(JSON.stringify(text))) > MAX_INPUT) throw new Error('diagram exceeds 8 MiB');
  const c = collector();
  if (/^(drawio|draw\.io|diagrams\.net|mxgraph|xml)$/.test(kind)) drawio(str(text), c);
  else if (/^(gliffy|json|vnd\.gliffy.*)$/.test(kind)) gliffy(text, c);
  else if (/^(plantuml|puml|uml|x-plantuml)$/.test(kind)) uml(str(text), c);
  else if (/^(mermaid|mmd)$/.test(kind)) mermaid(str(text), c);
  else if (kind === 'svg') svgStructure(str(text), c);
  else throw new Error(`unsupported diagram format: ${kind}`);
  return c.result();
}

function normalize(model = {}) {
  const nodes = [], byId = new Map();
  for (const n of model.nodes || []) {
    const id = str(n.id); if (!id || byId.has(id)) continue;
    const node = { ...n, id, label: str(n.name || n.label || id), kind: str(n.kind || 'service').toLowerCase(), alias: `n${nodes.length + 1}` };
    byId.set(id, node); nodes.push(node);
  }
  const fix = r => ({ ...r, from: str(r.from ?? r.source), to: str(r.to ?? r.target), label: str(r.label || r.name || r.description || '') });
  const relations = (model.relations || []).map(fix);
  const flows = (model.flows || []).map(f => ({ ...f, name: str(f.name || 'Flow'), steps: (f.steps || []).map(fix) }));
  for (const r of [...relations, ...flows.flatMap(f => f.steps)]) for (const id of [r.from, r.to]) if (id && !byId.has(id)) { const node = { id, label: id, kind: 'service', alias: `n${nodes.length + 1}` }; byId.set(id, node); nodes.push(node); }
  if (nodes.length > MAX_ITEMS || relations.length > MAX_ITEMS) throw new Error('diagram exceeds 10000 elements');
  return { ...model, nodes, byId, relations: relations.filter(r => r.from && r.to), flows: flows.map(f => ({ ...f, steps: f.steps.filter(r => r.from && r.to) })) };
}
function provenance(r) {
  if (r.conflict) return 'conflict';
  const sources = (Array.isArray(r.provenance) ? r.provenance : [r.provenance]).filter(Boolean);
  return sources.some(p => /verified|code|passport|catalog/i.test(typeof p === 'string' ? p : `${p.source || p.kind || p.type || ''} ${p.weight || p.confidence || p.status || ''}`)) || r.verified || r.confidence === 'verified' ? 'verified' : 'stated';
}
const oneLine = value => str(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
const mm = value => oneLine(value).replace(/[&"<>\[\]{}|;:#\\]/g, ch => `#${ch.codePointAt(0)};`);
// Inside a quoted edge label brackets, braces and colons are plain text; some Mermaid builds (Open WebUI's)
// show their #NN; codes literally there, so edge labels escape only what could end or break the quote.
const mmEdge = value => oneLine(value).replace(/[&"<>#\\]/g, ch => `#${ch.codePointAt(0)};`);
const pu = value => oneLine(value).replace(/&/g, '&amp;').replace(/[<>\[\]]/g, ch => `&#${ch.codePointAt(0)};`).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const dsl = value => JSON.stringify(oneLine(value));
const isPerson = n => /^(person|actor|user)$/.test(n.kind);
const isSystem = n => /^(system|external|external-system)$/.test(n.kind);
const isDatabase = n => /database|^db$|table/.test(n.kind);
const isTopic = n => /topic|queue|kafka/.test(n.kind);
function metadata(n) {
  const parts = [n.technology, n.owner ? `Owner: ${n.owner}` : '', n.version ? `Version: ${n.version}` : ''];
  if (isTopic(n)) {
    let schema = n.schema || {}; if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = { name: schema }; } }
    let definition = schema.schema || {}; if (typeof definition === 'string') { try { definition = JSON.parse(definition); } catch { definition = {}; } }
    const name = schema.name || schema.subject || definition.name || definition.title || schema.type;
    if (name) parts.push(`Schema: ${name}${schema.version != null ? ` v${schema.version}` : ''}`);
    if (n.partitions != null) parts.push(`Partitions: ${n.partitions}`);
    if (n.lastMessageAge != null) parts.push(`Last message age: ${n.lastMessageAge}`);
    else if (n.lastMessageAt) parts.push(`Last message: ${n.lastMessageAt}`);
  }
  parts.push(...(n.tables || []).map(t => typeof t === 'string' ? t : t.name));
  return parts.filter(Boolean);
}

function selected(m, opts) {
  const flow = typeof opts.flow === 'number' ? m.flows[opts.flow] : m.flows.find(f => f.name === opts.flow);
  return flow || m.flows[0] || { name: m.title || 'Flow', steps: m.relations };
}
function mermaidWrite(m, opts) {
  const alias = id => m.byId.get(id)?.alias;
  if (/sequence|dynamic/.test(opts.view)) {
    const flow = selected(m, opts), ids = new Set(flow.steps.flatMap(r => [r.from, r.to]));
    const lines = ['sequenceDiagram', '    autonumber'];
    for (const n of m.nodes.filter(n => ids.has(n.id))) lines.push(`    ${isPerson(n) ? 'actor' : 'participant'} ${n.alias} as ${mm(n.label)}`);
    for (const r of flow.steps) {
      const state = provenance(r), text = `${r.label}${r.technology ? ` [${r.technology}]` : ''}${state === 'conflict' ? ' [CONFLICT]' : ''}`;
      if (state === 'conflict') lines.push('    rect rgb(255, 228, 225)');
      lines.push(`    ${alias(r.from)}${state === 'verified' ? '->>' : '-->>'}${alias(r.to)}: ${mm(text)}`); // conflicts are documented, so dashed too
      if (state === 'conflict') lines.push('    end');
    }
    if (ids.size) lines.push(`    Note over ${[...ids].slice(0, 2).map(alias).join(',')}: Solid: verified in code. Dashed: docs only. Red: conflict.`);
    return lines.join('\n');
  }
  const lines = ['flowchart LR'];
  for (const n of m.nodes) {
    const kind = isPerson(n) ? 'person' : isDatabase(n) ? 'database' : isTopic(n) ? 'topic' : isSystem(n) || opts.view === 'context' ? 'system' : 'service';
    const detail = [n.label, ...metadata(n)].filter(Boolean).map(mm).join('<br/>');
    lines.push(`    ${n.alias}${kind === 'database' ? '[("' : kind === 'person' ? '(["' : '["'}${detail}${kind === 'database' ? '")]' : kind === 'person' ? '"])' : '"]'}:::${kind}`);
  }
  m.relations.forEach((r, i) => {
    const state = provenance(r), label = mmEdge(`${r.label}${r.technology ? ` [${r.technology}]` : ''}`);
    lines.push(`    ${alias(r.from)} ${state === 'verified' ? '-->' : '-.->'}${label ? `|"${label}"|` : ''} ${alias(r.to)}`);
    if (state === 'conflict') lines.push(`    linkStyle ${i} stroke:#b42318,stroke-width:3px,color:#b42318`);
  });
  lines.push('    classDef person fill:#17365d,color:#fff,stroke:#17365d', '    classDef system fill:#2457c5,color:#fff,stroke:#173d8b', '    classDef service fill:#e8eefb,color:#17365d,stroke:#2457c5', '    classDef database fill:#e3f1e4,color:#185c1b,stroke:#2f7d32', '    classDef topic fill:#fdf0d5,color:#7a4a00,stroke:#8a5300', '    subgraph legend["Legend"]', '        legend_code["Verified in code"] --> legend_docs["Docs only"] -.-> legend_conflict["Conflict: red line"]', '    end');
  return lines.join('\n');
}
function plantumlWrite(m, opts) {
  const alias = id => m.byId.get(id)?.alias;
  const lines = ['@startuml'];
  if (opts.view === 'sequence') {
    const flow = selected(m, opts), ids = new Set(flow.steps.flatMap(r => [r.from, r.to]));
    lines.push(`title ${pu(flow.name)}`, 'autonumber');
    for (const n of m.nodes.filter(n => ids.has(n.id))) lines.push(`${isPerson(n) ? 'actor' : isDatabase(n) ? 'database' : isTopic(n) ? 'queue' : 'participant'} "${pu(n.label)}" as ${n.alias}`);
    for (const r of flow.steps) lines.push(`${alias(r.from)} ${provenance(r) === 'conflict' ? '-[#b42318,dashed]>' : provenance(r) === 'stated' ? '-->' : '->'} ${alias(r.to)} : ${pu(r.label)}${r.technology ? ` [${pu(r.technology)}]` : ''}`);
  } else {
    const type = opts.view === 'context' ? 'Context' : opts.view === 'dynamic' ? 'Dynamic' : 'Container';
    lines.push(`!include <C4/C4_${type}>`, '!pragma layout smetana', `title ${pu(m.title || m.name || 'Architecture')}`, 'LAYOUT_LEFT_RIGHT()', 'AddRelTag("stated", $lineStyle=DashedLine())', 'AddRelTag("conflict", $lineColor="#b42318", $textColor="#b42318", $lineStyle=DashedLine())');
    for (const n of m.nodes) {
      const macro = isPerson(n) ? 'Person' : opts.view === 'context' ? (isSystem(n) && n.kind !== 'system' ? 'System_Ext' : 'System') : isSystem(n) ? 'System_Ext' : isDatabase(n) ? 'ContainerDb' : isTopic(n) ? 'ContainerQueue' : 'Container';
      const detail = [n.description, ...metadata(n).filter(value => value !== n.technology)].filter(Boolean).join('; ');
      lines.push(`${macro}(${n.alias}, "${pu(n.label)}"${macro.startsWith('Container') ? `, "${pu(n.technology || (isTopic(n) ? 'Kafka' : ''))}"` : ''}, "${pu(detail)}")`);
    }
    const relations = opts.view === 'dynamic' ? selected(m, opts).steps : m.relations;
    for (const r of relations) lines.push(`Rel(${alias(r.from)}, ${alias(r.to)}, "${pu(r.label)}", "${pu(r.technology)}", $tags="${provenance(r)}")`);
  }
  lines.push('legend right', '<color:#666666>Solid: verified in code</color>', '<color:#666666>Dashed: docs only</color>', '<color:#b42318>Red: conflict</color>', 'endlegend', '@enduml');
  return lines.join('\n');
}
function structurizrWrite(m) {
  const alias = id => m.byId.get(id)?.alias;
  const lines = [`workspace ${dsl(m.title || m.name || 'Architecture')} {`, '    model {'];
  for (const n of m.nodes.filter(n => isPerson(n) || isSystem(n))) lines.push(`        ${n.alias} = ${isPerson(n) ? 'person' : 'softwareSystem'} ${dsl(n.label)} ${dsl([n.description, ...metadata(n).filter(value => value !== n.technology)].filter(Boolean).join('; '))}`);
  lines.push(`        architecture = softwareSystem ${dsl(m.title || m.name || 'System')} {`);
  for (const n of m.nodes.filter(n => !isPerson(n) && !isSystem(n))) lines.push(`            ${n.alias} = container ${dsl(n.label)} ${dsl([n.description, ...metadata(n).filter(value => value !== n.technology)].filter(Boolean).join('; '))} ${dsl(n.technology)} {`, `                tags ${dsl(isDatabase(n) ? 'Database' : isTopic(n) ? 'Topic' : 'Service')}`, '            }');
  lines.push('        }');
  const edges = [...m.relations], pairs = new Set(edges.map(r => `${r.from}\0${r.to}`));
  for (const r of m.flows.flatMap(f => f.steps)) if (!pairs.has(`${r.from}\0${r.to}`)) { pairs.add(`${r.from}\0${r.to}`); edges.push(r); }
  for (const r of edges) lines.push(`        ${alias(r.from)} -> ${alias(r.to)} ${dsl(r.label)} ${dsl(r.technology)} {`, `            tags ${dsl(provenance(r))}`, '        }');
  lines.push('    }', '    views {', '        systemContext architecture Context {', '            include *', '            autoLayout lr', '        }', '        container architecture Container {', '            include *', '            autoLayout lr', '        }');
  m.flows.forEach((flow, i) => {
    lines.push(`        dynamic architecture Flow${i + 1} ${dsl(flow.name)} {`);
    for (const r of flow.steps) lines.push(`            ${alias(r.from)} -> ${alias(r.to)} ${dsl(r.label)}`);
    lines.push('            autoLayout lr', '        }');
  });
  lines.push('        styles {', '            element "Database" {', '                shape Cylinder', '                background #e3f1e4', '                color #185c1b', '            }', '            element "Topic" {', '                shape Pipe', '            }', '            relationship "stated" {', '                dashed true', '            }', '            relationship "verified" {', '                dashed false', '            }', '            relationship "conflict" {', '                color #b42318', '                thickness 3', '            }', '        }', '    }', '}');
  return lines.join('\n');
}
function write(model, { format = 'mermaid', view = 'container', ...rest } = {}) {
  const m = normalize(model), opts = { view: str(view).replace(/^c4[-_]?/i, '').toLowerCase(), ...rest };
  const sequence = opts.view.match(/^(sequence|dynamic):(\d+)$/);
  if (sequence) { opts.view = sequence[1]; if (opts.flow === undefined) opts.flow = Number(sequence[2]); }
  if (!['context', 'container', 'sequence', 'dynamic'].includes(opts.view)) throw new Error(`unsupported diagram view: ${view}`);
  if (format === 'mermaid') return mermaidWrite(m, opts);
  if (format === 'plantuml' || format === 'c4-plantuml') return plantumlWrite(m, opts);
  if (format === 'structurizr' || format === 'dsl') return structurizrWrite(m);
  throw new Error(`unsupported diagram format: ${format}`);
}

// SVG is untrusted even when returned by a configured renderer. Keep geometry/text only:
// no active content, external resources, embedded HTML, CSS URLs, links or event attributes.
function sanitizeSvg(svg) {
  svg = str(svg);
  if (Buffer.byteLength(svg) > MAX_INPUT) throw new Error('rendered SVG exceeds 8 MiB');
  if (!/<svg\b/i.test(svg) || /<!DOCTYPE|<!ENTITY/i.test(svg)) throw new Error('renderer did not return safe SVG');
  // A positive allowlist also rejects namespaced active elements and malformed attribute tricks.
  const tags = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs marker linearGradient radialGradient stop clipPath mask pattern title desc'.split(' '));
  const attributes = new Set('id class x y x1 x2 y1 y2 cx cy r rx ry dx dy d points width height viewBox preserveAspectRatio transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline letter-spacing textLength lengthAdjust marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient gradientUnits gradientTransform offset stop-color stop-opacity clip-path clip-rule clipPathUnits mask maskUnits patternUnits patternTransform role aria-label aria-labelledby aria-describedby data-node-id'.split(' '));
  const escape = value => str(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  svg = svg.replace(/<!--[\s\S]*?-->|<\?[^>]*\?>/g, '');
  svg = svg.replace(/<(?:[\w.-]+:)?(?:script|style|foreignObject|iframe|object|embed|image|animate|animateTransform|animateMotion|set)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:script|style|foreignObject|iframe|object|embed|image|animate|animateTransform|animateMotion|set)\s*>/gi, '');
  const start = svg.search(/<svg\b/i), end = svg.toLowerCase().lastIndexOf('</svg>');
  if (end < start) throw new Error('renderer returned incomplete SVG');
  svg = svg.slice(start, end + 6);
  const output = [];
  for (const token of svg.matchAll(/<[^>]*>|[^<]+/g)) {
    const text = token[0];
    if (!text.startsWith('<')) { output.push(escape(entities(text))); continue; }
    const match = text.match(/^<(\/?)([\w:.-]+)([\s\S]*?)>$/);
    if (!match || !tags.has(match[2])) continue;
    const [, close, name, body] = match;
    if (close) { output.push(`</${name}>`); continue; }
    const values = [];
    for (const [key, value] of Object.entries(attrs(body))) {
      if (key === 'style') {
        const safe = value.split(';').map(part => part.trim()).filter(part => /^(?:fill|fill-opacity|stroke|stroke-width|stroke-opacity|stroke-dasharray|font-family|font-size|font-weight|font-style|text-anchor|opacity)\s*:\s*[-#(),.%\w\s]+$/.test(part) && !/url\s*\(|expression\s*\(|javascript/i.test(part));
        if (safe.length) values.push(`style="${escape(safe.join(';'))}"`);
        continue;
      }
      if (!attributes.has(key)) continue;
      if (/url\s*\(/i.test(value) && !/^url\(#[\w:.-]+\)$/.test(value.trim())) continue;
      if (/javascript:|data:|https?:|@import|expression\s*\(|[\\]/i.test(value)) continue;
      values.push(`${key}="${escape(value)}"`);
    }
    if (name === 'svg') values.push('xmlns="http://www.w3.org/2000/svg"');
    output.push(`<${name}${values.length ? ' ' + values.join(' ') : ''}${/\/\s*$/.test(body) ? '/' : ''}>`);
  }
  return output.join('');
}
function localRender(java, jar, source, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(java, ['-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=SANDBOX', '-jar', jar, '-tsvg', '-pipe', '-charset', 'UTF-8'], { env: { ...process.env, PLANTUML_SECURITY_PROFILE: 'SANDBOX' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', error = '', size = 0, failed = false;
    const stop = why => { if (failed) return; failed = true; child.kill('SIGKILL'); reject(new Error(why)); };
    const timer = setTimeout(() => stop('PlantUML render timed out'), timeoutMs); timer.unref?.();
    child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_INPUT) stop('rendered SVG exceeds 8 MiB'); else out += chunk; });
    child.stderr.on('data', chunk => { if (error.length < 4096) error += chunk; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (!failed) code === 0 ? resolve(out) : reject(new Error(`PlantUML exited ${code}: ${error.slice(0, 1000)}`)); });
    child.stdin.on('error', () => {}); child.stdin.end(source);
  });
}
async function render(model, opts = {}) {
  const format = opts.format || 'plantuml', source = write(model, { ...opts, format });
  const result = { format, view: opts.view || 'container', source, rendered: false };
  const cfg = opts.renderer || opts.config || {};
  const kroki = opts.krokiUrl || cfg.krokiUrl || cfg.kroki;
  const jar = opts.plantumlJar || opts.jar || cfg.plantumlJar || cfg.jar || process.env.DT_PLANTUML_JAR;
  const timeoutMs = Math.max(100, Math.min(Number(opts.timeoutMs) || 30000, 120000));
  if (format === 'structurizr' || format === 'dsl') return { ...result, reason: 'Structurizr DSL is an export format' };
  if (kroki) {
    const url = new URL(str(kroki));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Kroki requires an HTTP(S) URL without embedded credentials');
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'image/svg+xml' }, body: JSON.stringify({ diagram_source: source, diagram_type: format === 'mermaid' ? 'mermaid' : 'plantuml', output_format: 'svg' }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Kroki HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_INPUT) throw new Error('rendered SVG exceeds 8 MiB');
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > MAX_INPUT) throw new Error('rendered SVG exceeds 8 MiB'); chunks.push(chunk); }
    return { ...result, rendered: true, svg: sanitizeSvg(Buffer.concat(chunks).toString('utf8')), renderer: 'kroki' };
  }
  if (format === 'mermaid') return { ...result, reason: 'Mermaid renders in the sandboxed diagram view or chat' };
  if (!jar) return { ...result, reason: 'Configure diagrams.plantumlJar or diagrams.krokiUrl to render SVG; source is ready to export' };
  const java = opts.java || cfg.java || 'java';
  let svg;
  if (opts.runner || cfg.runner) {
    const runner = typeof opts.runner === 'object' ? opts.runner : require('./runner');
    const cwd = opts.cwd || cfg.cwd || require('./config').PATHS.build;
    if (!opts.cwd && !cfg.cwd) require('node:fs').mkdirSync(cwd, { recursive: true });
    const r = await runner.exec('sh', ['-c', 'printf %s "$DT_DIAGRAM_SOURCE" | "$DT_DIAGRAM_JAVA" -Djava.awt.headless=true -DPLANTUML_SECURITY_PROFILE=SANDBOX -jar "$DT_DIAGRAM_JAR" -tsvg -pipe -charset UTF-8'], { cwd, env: { DT_DIAGRAM_SOURCE: source, DT_DIAGRAM_JAVA: java, DT_DIAGRAM_JAR: jar, PLANTUML_SECURITY_PROFILE: 'SANDBOX' }, timeoutMs });
    if (r.code !== 0) throw new Error(`PlantUML runner failed: ${str(r.out).slice(0, 1000)}`);
    svg = r.out;
  } else svg = await localRender(java, jar, source, timeoutMs);
  return { ...result, rendered: true, svg: sanitizeSvg(svg), renderer: opts.runner || cfg.runner ? 'runner' : 'plantuml' };
}
function generate(model, { formats = ['mermaid', 'plantuml', 'structurizr'], views = ['context', 'container'], ...opts } = {}) {
  const result = [];
  for (const format of formats) {
    for (const view of format === 'structurizr' ? ['container'] : views) result.push({ name: view[0].toUpperCase() + view.slice(1), format, view, source: write(model, { ...opts, format, view }) });
    if (format !== 'structurizr') for (const [i, flow] of (model.flows || []).entries()) result.push({ name: `Sequence: ${flow.name || i + 1}`, format, view: 'sequence', flow: i, source: write(model, { ...opts, format, view: 'sequence', flow: i }) });
  }
  return result;
}
module.exports = { parseDiagram, write, render, generate, sanitizeSvg };
