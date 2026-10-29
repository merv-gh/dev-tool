// Field trace: every field of a Postgres function result (or table) from its source expression to the code
// that reads it. DB side: the function's select list mapped to its result columns, the tables/columns each
// reads, and deprecations stated in its comment. Code side, in the repos that call it: the SQL that selects
// the field, the row mapper argument (rs.getX("col") inside new Model(...)) or @Column field it lands in, and
// every call of that model's accessor (call edges of the code graph, so impact and this agree).
// Static and cached: dynamic SQL, reflection and generated mappers are not seen; the answer says what it covers.
const CI = require('./codeindex');

// ── SQL helpers (parentheses and quotes only; enough for select lists) ──
function splitSql(s) {
  const out = []; let d = 0, start = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"') { j++; while (j < s.length && s[j] !== c) j++; continue; }
    if (s.startsWith('--', j)) { while (j < s.length && s[j] !== '\n') j++; continue; }
    if (c === '(') d++; else if (c === ')') d--;
    else if (c === ',' && d === 0) { out.push([start, j]); start = j + 1; }
  }
  out.push([start, s.length]);
  return out.map(([a, b]) => ({ text: s.slice(a, b).trim(), at: a + (s.slice(a, b).length - s.slice(a, b).trimStart().length) })).filter(x => x.text);
}
// first top-level keyword at or after `from` (depth 0, outside quotes); -1 when none
function topLevel(s, word, from = 0) {
  const re = new RegExp(`^${word}\\b`, 'i'); let d = 0;
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"') { j++; while (j < s.length && s[j] !== c) j++; continue; }
    if (c === '(') d++; else if (c === ')') d--;
    else if (d === 0 && /\W/.test(s[j - 1] || ' ') && re.test(s.slice(j, j + word.length + 1))) return j;
  }
  return -1;
}
// the outer select list of a SQL function body (plpgsql: after RETURN QUERY), with offsets
function selectList(body) {
  const rq = body.search(/\breturn\s+query\b/i), start = topLevel(body, 'select', rq < 0 ? 0 : rq);
  if (start < 0) return null;
  const from = topLevel(body, 'from', start + 6), end = from < 0 ? body.length : from;
  return { items: splitSql(body.slice(start + 6, end)).map(x => ({ ...x, at: x.at + start + 6 })), rest: body.slice(end) };
}
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
const stripAlias = e => e.replace(/\s+as\s+"?\w+"?\s*$/i, '').replace(/\s+"?\w+"?\s*$/, m => /\)|\w\s+\w+$/.test(e) && !/\b(end|null|true|false)\s*$/i.test(e) && /^\s+\w+$/.test(m) && !/[.(]/.test(m) ? '' : m).trim();
const aliasOf = e => (e.match(/\s+as\s+"?(\w+)"?\s*$/i) || [])[1];

function aliases(sql) {
  const map = {};
  for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_][\w]*\.[a-z_]\w*|[a-z_]\w*)(?:\s*\([^)]*\))?(?:\s+(?:as\s+)?(?!on\b|where\b|join\b|left\b|right\b|inner\b|cross\b|group\b|order\b|limit\b)([a-z_]\w*))?/gi)) map[(m[2] || m[1].split('.').pop()).toLowerCase()] = m[1].toLowerCase();
  return map;
}
// what an expression reads: alias.column -> table.column, schema.fn( -> function, a sub-select's tables
function reads(expr, map) {
  const out = new Set();
  for (const m of expr.matchAll(/\b([a-z_]\w*)\.([a-z_]\w*)\b(?!\s*\()/gi)) if (map[m[1].toLowerCase()]) out.add(`${map[m[1].toLowerCase()]}.${m[2].toLowerCase()}`);
  for (const m of expr.matchAll(/\b([a-z_]\w*\.[a-z_]\w*)\s*\(/gi)) out.add(`${m[1].toLowerCase()}()`);
  for (const m of expr.matchAll(/\bfrom\s+([a-z_]\w*\.[a-z_]\w*)/gi)) if (![...out].some(x => x.startsWith(m[1].toLowerCase() + '.'))) out.add(m[1].toLowerCase());
  return [...out];
}
// "DEPRECATED ...: field -> replacement; other -> no replacement (...)" in a comment
function deprecations(comment, names) {
  const out = {};
  if (!/deprecat|obsolete|legacy/i.test(comment || '')) return out;
  for (const n of names) {
    // up to the next ";" or the end of the sentence ("... v2). Read the others ..." stops before "Read")
    const m = comment.match(new RegExp(`\\b${n}\\b\\s*(?:->|→|=>|:\\s*use)\\s*(.+?)(?=\\s*;|\\.\\s+[A-Z]|\\.?\\s*$)`, 'i'));
    if (m) out[n] = { replacement: m[1].trim().replace(/\.$/, ''), status: /^(no replacement|none|removed|drop)/i.test(m[1].trim()) ? 'removed' : 'deprecated' };
  }
  return out;
}

function dbFields(env, name) {
  const P = require('./pgindex'), found = P.describe(env, name).filter(o => o.kind !== 'unknown');
  if (!found.length) throw new Error(`${name} is not in the ${env} catalog; find it first (find "pgfn: ${name}" or "pg: ${name}")`);
  if (found.length > 1) throw new Error(`${name} is ambiguous: ${found.map(o => `${o.db}:${o.object}`).join(', ')}; pass db`);
  const o = found[0], isFn = ['function', 'procedure'].includes(o.kind);
  let fields;
  if (isFn) {
    const cols = (o.arg_list || []).filter(a => ['table', 'out', 'inout'].includes(a.mode));
    const body = o.body || '', list = selectList(body), map = aliases(body);
    fields = cols.map((c, i) => {
      const item = list?.items.find(x => aliasOf(x.text)?.toLowerCase() === c.name.toLowerCase()) || list?.items[i];
      const expression = item ? stripAlias(item.text).replace(/\s+/g, ' ') : null;
      return { field: c.name, type: c.type, expression, line: item ? lineAt(body, item.at) : null, reads: expression ? reads(expression, map) : [], ...(item ? {} : { gap: 'expression not found in the body (dynamic SQL or a construct this reader does not parse)' }) };
    });
  } else fields = (o.columns || []).map(c => ({ field: c.name, type: c.type, expression: c.name, line: null, reads: [`${o.object}.${c.name}`], ...(/deprecat/i.test(c.comment || '') ? { comment: c.comment } : {}) }));
  const dep = deprecations(o.comment, fields.map(f => f.field));
  for (const f of fields) {
    if (dep[f.field]) Object.assign(f, dep[f.field], { said: 'comment of ' + o.object });
    else if (f.comment) Object.assign(f, { status: 'deprecated', replacement: f.comment, said: `comment of ${o.object}.${f.field}` });
    else f.status = 'keep';
  }
  const callers = o.usedBy.filter(e => e.source === 'code' && e.userKind === 'service').map(e => ({ service: e.user, where: e.where, sql: String(e.detail || '').replace(/^sql:\s*/, '') }));
  return { source: { db: o.db, name: o.object, kind: o.kind, lang: o.lang, comment: o.comment || null, returns: o.returns }, fields, callers };
}

// columns a statement selects from the source: all for "*", else the listed ones (alias.col, col, col as x)
function selected(sql, source, names) {
  const s = selectList(sql);
  if (!s) return [];
  if (s.items.some(x => /^(\w+\.)?\*$/.test(x.text))) return names;
  return s.items.map(x => (stripAlias(x.text).match(/(?:^|\.)(\w+)$/) || [])[1]).filter(n => names.includes(n));
}

function link(key, file, line) {
  const [project, repo] = String(key).split('/'), bb = require('./config').getPersonal().bitbucket.url;
  return bb && !String(key).startsWith('work/') ? `${bb}/projects/${project}/repos/${repo}/browse/${file}${line ? `#${line}` : ''}` : undefined;
}
const place = (key, where, text) => { const [file, line] = String(where).split(':'); return { repo: key, where, file, line: Number(line) || null, ...(text ? { text: text.trim().slice(0, 200) } : {}), url: link(key, file, Number(line)) }; };

// Code side for one repo: SQL places, mapper arguments into a model, @Column fields, and accessor calls.
function codeFields(key, sourceName, names) {
  const idx = CI.load(key); if (!idx) return null;
  const g = idx.graph_(), out = Object.fromEntries(names.map(n => [n, { sql: [], mapper: [], model: [], uses: [] }]));
  const methodsUsing = (g.sql || []).filter(x => (x.tables || []).some(t => t.toLowerCase() === sourceName.toLowerCase()));
  const classOf = m => g.classes.find(c => m.startsWith(c.id + '#'));
  const files = new Set(methodsUsing.map(m => classOf(m.m)?.file).filter(Boolean));
  for (const m of methodsUsing) {
    const c = classOf(m.m), meth = c?.methods.find(x => `${c.id}#${x.name}` === m.m);
    for (const n of selected(m.sql, sourceName, names)) out[n].sql.push({ ...place(key, `${c?.file}:${meth?.line || c?.line}`), method: m.m.split('.').pop(), sql: m.sql.slice(0, 300) });
  }
  const models = new Map();
  for (const rel of files) {
    const lines = CI.read(key, rel).text.split('\n').map(l => l.replace(/^\s*\d+\s{2}/, '')), text = lines.join('\n');
    for (const [i, l] of lines.entries()) for (const m of l.matchAll(/\.get\w*\(\s*"(\w+)"/g)) {
      const n = names.find(x => x.toLowerCase() === m[1].toLowerCase()); if (!n) continue;
      // which argument of which "new Model(" this rs.getX("col") is
      const offset = lines.slice(0, i).join('\n').length + 1 + m.index, open = text.lastIndexOf('new ', offset), ctor = text.slice(open).match(/^new\s+([\w.]+)\s*\(/);
      let model = null, component = null;
      if (ctor && open > text.lastIndexOf(';', offset)) {
        const args = splitSql(text.slice(open + ctor[0].length, offset)).length - 1, cls = g.classes.find(c => c.name === ctor[1].split('.').pop());
        model = cls?.id || ctor[1]; component = cls?.ctor?.[args]?.name || cls?.fields?.filter(f => !f.static)[args]?.name || null;
        if (cls) models.set(cls.id, cls);
      }
      out[n].mapper.push({ ...place(key, `${rel}:${i + 1}`, l), ...(model ? { model, component } : {}) });
    }
  }
  // JPA/@Column mappings anywhere in the repo, and snake -> camel fields of the models found above
  for (const c of g.classes) for (const f of c.fields || []) {
    const col = (f.annos || []).join(' ').match(/Column\(\s*(?:name\s*=\s*)?"(\w+)"/)?.[1];
    const n = col && names.find(x => x.toLowerCase() === col.toLowerCase());
    if (n) { out[n].mapper.push({ ...place(key, `${c.file}:${f.line}`), model: c.id, component: f.name, via: '@Column' }); models.set(c.id, c); }
  }
  for (const n of names) for (const mp of out[n].mapper.filter(m => m.component)) {
    const cls = models.get(mp.model); if (!cls) continue;
    const f = (cls.fields || []).find(x => x.name === mp.component);
    if (f && !out[n].model.some(x => x.model === cls.id && x.field === f.name)) out[n].model.push({ ...place(key, `${cls.file}:${f.line}`), model: cls.id, field: f.name, type: f.type });
    // accessor calls: the record component() or Lombok/JavaBean getX()/isX() (call edges, so not every .status() in the repo)
    const cap = mp.component[0].toUpperCase() + mp.component.slice(1), accessors = new Set([mp.component, `get${cap}`, `is${cap}`]);
    for (const e of g.edges) if (e[2] === 'calls' && String(e[1]).startsWith(cls.id + '#') && accessors.has(String(e[1]).split('#')[1]) && !out[n].uses.some(u => u.where === e[3]))
      out[n].uses.push({ ...place(key, e[3]), method: String(e[0]).split('.').pop(), accessor: String(e[1]).split('.').pop() });
  }
  return out;
}

function trace({ env, name, fields: only, repos, max = 40 } = {}) {
  env = env || require('./config').envNames()[0];
  const db = dbFields(env, name), names = db.fields.map(f => f.field);
  const pick = only ? String(only).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
  if (pick) db.fields = db.fields.filter(f => pick.includes(f.field.toLowerCase()));
  // the repos of the services that call it (their passports' code indexes), or the ones asked for
  const keys = repos ? CI.select(repos) : [...new Set(db.callers.map(c => { try { return require('./passport').load(c.service)?.codeIndex; } catch { return null; } }).filter(Boolean))];
  const gaps = [];
  if (!keys.length) gaps.push({ kind: 'no-code-index', detail: 'No indexed repo calls it: build the callers\' passports (passport service=...) or pass repos' });
  const perRepo = keys.map(k => [k, codeFields(k, db.source.name, names)]).filter(([k, v]) => v || !gaps.push({ kind: 'no-code-index', repo: k }));
  for (const f of db.fields) {
    f.code = { sql: [], mapper: [], model: [], uses: [] };
    for (const [, v] of perRepo) for (const k of Object.keys(f.code)) f.code[k].push(...v[f.field][k]);
    for (const k of Object.keys(f.code)) if (f.code[k].length > max) { f.code[k] = f.code[k].slice(0, max); f.truncated = true; }
    if (f.status !== 'keep' && !f.code.sql.length && !f.code.mapper.length) f.unread = true;
    if (f.code.mapper.length && !f.code.uses.length && f.code.mapper.some(m => m.component)) f.mappedNotUsed = true;
  }
  const changing = db.fields.filter(f => f.status !== 'keep');
  return {
    env, ...db, repos: keys, gaps,
    summary: { fields: db.fields.length, deprecated: changing.length, deprecatedReadInCode: changing.filter(f => !f.unread).length, places: db.fields.reduce((n, f) => n + Object.values(f.code).reduce((m, x) => m + x.length, 0), 0) },
    coverage: 'Static: cached catalog and code indexes. SQL built at runtime, reflection, BeanPropertyRowMapper/ORM projections by name and generated code are not traced; check them with code_search.',
  };
}

// One row per field for a table view: links to each place.
function rows(r) {
  const links = xs => xs.map(p => ({ text: `${p.file.split('/').pop()}:${p.line}`, url: p.url || p.where }));
  return r.fields.map(f => ({
    field: f.field, status: f.status, source: f.expression ? `${f.expression}${f.line ? ` (line ${f.line})` : ''}` : '?', reads: f.reads.join(', '),
    replacement: f.replacement || '', sql: links(f.code.sql), 'row mapper': links(f.code.mapper),
    model: f.code.model.map(m => `${m.model.split('.').pop()}.${m.field}`).join(', '), 'used in': links(f.code.uses),
  }));
}

// An architecture model for the diagram view: classes -> source -> tables, deprecated reads in red, replacements dashed.
function model(r) {
  const nodes = new Map(), relations = [], add = (id, n) => { if (!nodes.has(id)) nodes.set(id, { id, ...n }); return id; };
  const src = add(`pg:${r.source.name}`, { name: `${r.source.name}${r.source.kind === 'function' ? '()' : ''}`, kind: 'external', technology: `${r.source.kind}, ${r.fields.filter(f => f.status !== 'keep').length} deprecated fields`, provenance: { source: 'catalog:pg', status: 'verified', comment: r.source.comment } });
  const reads = new Map();
  for (const f of r.fields) for (const x of f.reads) { const t = x.endsWith('()') ? x : x.split('.').slice(0, 2).join('.'); (reads.get(t) || reads.set(t, []).get(t)).push(f.field); }
  for (const [t, fs] of reads) relations.push({ from: src, to: add(`pg:${t}`, { name: t, kind: t.endsWith('()') ? 'external' : 'database', technology: 'PostgreSQL', provenance: { source: 'catalog:pg', status: 'verified' } }), label: fs.slice(0, 6).join(', '), technology: 'SQL', confidence: 'verified', provenance: { source: 'catalog:pg', status: 'verified' } });
  const cls = (p, id) => add(`code:${id}`, { name: id.split('.').pop(), kind: 'service', technology: p.repo, provenance: { source: 'code', status: 'verified', file: p.file, line: p.line, url: p.url } });
  const edge = (from, to, label, p, extra = {}) => { const k = `${from}|${to}`, old = relations.find(x => `${x.from}|${x.to}` === k); if (old) { old.fields.add(label); old.label = [...old.fields].slice(0, 6).join(', ') + (old.fields.size > 6 ? ', …' : ''); Object.assign(old, extra.conflict ? { conflict: true } : {}); return; } relations.push({ from, to, label, fields: new Set([label]), technology: 'Java', confidence: 'verified', provenance: { source: 'code', status: 'verified', file: p.file, line: p.line, url: p.url }, ...extra }); };
  for (const f of r.fields) {
    const old = f.status !== 'keep' ? { conflict: true } : {};
    for (const p of [...f.code.sql, ...f.code.mapper.filter(m => !m.via)]) edge(cls(p, p.method ? p.method.split('#')[0].replace(/^/, (p.repo ? '' : '')) : p.file.split('/').pop().replace(/\.\w+$/, '')), src, f.field, p, old);
    for (const m of f.code.model) for (const p of f.code.mapper.filter(x => x.model === m.model)) edge(cls(p, p.file.split('/').pop().replace(/\.\w+$/, '')), cls(m, m.model), `maps ${f.field}`, p);
    for (const u of f.code.uses) for (const m of f.code.model) edge(cls(u, u.method.split('#')[0]), cls(m, m.model), `${u.accessor.split('#')[1]}()`, u, old);
    if (f.replacement && f.status === 'deprecated') { const t = (f.replacement.match(/[a-z_]\w*\.[a-z_]\w*(?=\s*\()/i) || [f.replacement])[0]; relations.push({ from: src, to: add(`pg:${t}()`, { name: `${t}()`, kind: 'external', technology: 'replacement', provenance: { source: 'docs', status: 'stated', said: f.said } }), label: `${f.field} moves here`, technology: 'SQL', confidence: 'stated', provenance: { source: 'docs', status: 'stated', said: f.said } }); }
  }
  return { name: `${r.source.name} field trace`, title: `${r.source.name} field trace`, nodes: [...nodes.values()], relations: relations.map(({ fields, ...x }) => x), flows: [] };
}

module.exports = { trace, rows, model, splitSql, selectList, aliases, reads, deprecations, selected, stripAlias };
