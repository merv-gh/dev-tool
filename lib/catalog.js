// cache/<env>/catalog.txt: one line per table / function / index / topic / service.
// It is the cheap search surface: grep it, or use `dt find`.
const fs = require('fs');
const path = require('path');
const { CACHE, readJson } = require('./util');
const notes = require('./notes');

function list(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')); } catch { return []; }
}

const note = (name, db) => { const n = notes.get(name, db); return n ? `  # ${n.replace(/\s+/g, ' ')}` : ''; };

function build(env) {
  const lines = [];
  const root = path.join(CACHE, env);

  // Postgres: usage index first, so each table/function line says who uses it (db objects + services)
  try { require('./pgindex').build(env); } catch (e) { console.error(`pg usage index: ${e.message}`); }
  const usedBy = require('./pgindex').usedBySummary(env);
  for (const data of require('./pg').loadAll(env)) {
    for (const t of data.tables) {
      const k = `${t.schema}.${t.name}`;
      const kind = t.kind === 'table' ? '' : ` [${t.kind}]`;
      const u = usedBy.get(`${data.db}|${k.toLowerCase()}`);
      lines.push(`pg ${data.db} ${k}${kind} ~${t.est_rows}: ${t.columns.map(c => `${c.name} ${c.type}`).join(', ')}${u ? ` | used by: ${u}` : ''}${note(k, data.db)}`);
    }
    for (const fn of data.functions || []) {
      const k = `${fn.schema}.${fn.name}`;
      const u = usedBy.get(`${data.db}|${k.toLowerCase()}`);
      const ret = fn.returns ? ` -> ${fn.returns}` : '';
      lines.push(`pgfn ${data.db} ${k}(${fn.signature ?? fn.args})${ret} [${fn.kind || 'function'} ${fn.lang}]${u ? ` | used by: ${u}` : ''}${note(k, data.db)}`);
    }
  }

  const esDir = path.join(root, 'es');
  for (const f of list(esDir)) {
    const d = readJson(path.join(esDir, f));
    if (!d) continue;
    const al = d.aliases.length ? ` [${d.aliases.join(',')}]` : '';
    lines.push(`es ${d.index}${al} ${d.docs}: ${Object.entries(d.fields).map(([k, v]) => `${k} ${v}`).join(', ')}${note(d.index)}`);
  }

  const kDir = path.join(root, 'kafka');
  for (const f of list(kDir)) {
    const d = readJson(path.join(kDir, f));
    if (!d) continue;
    const schema = d.valueSchema ? ` schema:${d.valueSchema.type}v${d.valueSchema.version}` : '';
    lines.push(`kafka ${d.topic} ${d.messages}${schema}: ${Object.keys(d.fields).join(', ')}${note(d.topic)}`);
  }

  const consul = readJson(path.join(root, 'consul.json'));
  for (const [name, s] of Object.entries(consul?.services || {})) {
    const inst = s.instances || [];
    lines.push(`consul ${name} ${inst.filter(i => i.status === 'passing').length}/${inst.length}: ${inst.map(i => `${i.address}:${i.port}`).join(', ')}`);
  }

  // Service passports (static code analysis) are env-independent; listed in every env's catalog.
  for (const p of require('./passport').list()) {
    const parts = [
      p.consumes.length && `consumes ${p.consumes.join(', ')}`,
      p.produces.length && `produces ${p.produces.join(', ')}`,
      p.tables.length && `tables ${p.tables.join(', ')}`,
      p.calls.length && `calls ${p.calls.join(', ')}`,
      `endpoints ${p.endpoints}`,
    ].filter(Boolean);
    lines.push(`svc ${p.service} ${p.repo}@${(p.sha || '').slice(0, 10)}: ${parts.join('; ')}${note(p.service)}`);
  }

  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'catalog.txt'), lines.join('\n') + '\n');
  return lines.length;
}

// Every word must appear in the line (case-insensitive). Words may be prefixed
// with a kind filter: "pg:", "es:", "kafka:", "consul:", "pgfn:".
function find(env, q, { limit = 200 } = {}) {
  let text;
  try { text = fs.readFileSync(path.join(CACHE, env, 'catalog.txt'), 'utf8'); } catch { return []; }
  let kind = null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).filter(w => {
    const m = w.match(/^(pg|pgfn|es|kafka|consul|svc):$/);
    if (m) kind = m[1];
    return !m;
  });
  // lines where the words hit the object itself rank before lines that only mention them in "used by"
  const direct = [], related = [];
  for (const line of text.split('\n')) {
    if (!line || (kind && !line.startsWith(kind + ' '))) continue;
    const l = line.toLowerCase();
    if (!words.every(w => l.includes(w))) continue;
    const cut = l.indexOf(' | used by: ');
    const main = cut < 0 ? l : l.slice(0, cut);
    (words.every(w => main.includes(w)) ? direct : related).push(line);
    if (direct.length >= limit) break;
  }
  const out = [...direct, ...related].slice(0, limit);
  return out;
}

// Is anything synced for this env? Tools use it to send the model to find/catalog_sync first.
function status(env) {
  const root = path.join(CACHE, env);
  return {
    catalog: fs.existsSync(path.join(root, 'catalog.txt')),
    schemas: readJson(path.join(root, 'pg', '_index.json'))?.schemas || null,
    indices: readJson(path.join(root, 'es', '_index.json'))?.indices || null,
    topics: readJson(path.join(root, 'kafka', '_index.json'))?.topics || null,
  };
}

module.exports = { build, find, status };
