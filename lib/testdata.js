// Test data for what enters and leaves a service: one generated helper class per module (TestData) with a
// valid object for each type at its edges, built through the type's own constructor:
//   request bodies and path variables of the controllers, payloads of the Kafka listeners and of what the
//   service sends (KafkaTemplate<K, V>), the entities its repositories read (a row as the database holds
//   it: id and database defaults set), and what its Feign clients return.
// Values come from what is known, most binding first: Bean Validation on the component, the database
// column the name maps to (type, length, scale, CHECK lists and ranges, an FK to a dictionary table: a
// real row of it), how the code parses the value (Long.parseLong(id) -> a number as text), the name
// (email, country, zip...), the Java type. Ids of one concept are one constant (ORDER_ID), so the body,
// the event and the row agree. Types validated at an endpoint (@Valid) get cases: each constraint just
// broken (invalid) and the edges that pass (valid), for a @ParameterizedTest.
const fs = require('fs');
const path = require('path');
const W = require('./workspace');

// ── reading Java declarations: annotations with their arguments, record components, fields, enum constants ──

// comments out (strings kept, so annotation arguments survive)
function noComments(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === '"' || c === "'") {
      if (c === '"' && s.startsWith('"""', i)) { const e = s.indexOf('"""', i + 3); const j = e < 0 ? s.length : e + 3; out += s.slice(i, j); i = j; continue; }
      let j = i + 1;
      while (j < s.length && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && n === '/') { const e = s.indexOf('\n', i); const j = e < 0 ? s.length : e; out += ' '.repeat(j - i); i = j; continue; }
    if (c === '/' && n === '*') { const e = s.indexOf('*/', i + 2); const j = e < 0 ? s.length : e + 2; out += s.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue; }
    out += c; i++;
  }
  return out;
}

// index after the bracket that closes the one at i (strings skipped)
function closing(s, i) {
  const open = s[i], close = { '(': ')', '{': '}', '[': ']', '<': '>' }[open];
  let d = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") { j++; while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1; continue; }
    if (c === open) d++;
    else if (c === close && --d === 0) return j;
  }
  return s.length - 1;
}

// split at sep where no bracket is open and outside strings
function splitTop(s, sep = ',') {
  const out = [];
  let d = 0, start = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") { j++; while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1; continue; }
    if ('({[<'.includes(c)) d++;
    else if (')}]>'.includes(c)) d--;
    else if (c === sep && d === 0) { out.push(s.slice(start, j)); start = j + 1; }
  }
  out.push(s.slice(start));
  return out.map(x => x.trim()).filter(Boolean);
}

const unquote = (v) => {
  const t = String(v).trim();
  if (/^".*"$/s.test(t)) return t.slice(1, -1).replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t' }[c] || c));
  if (/^\{.*\}$/s.test(t)) return splitTop(t.slice(1, -1)).map(unquote);
  if (/^-?\d+(\.\d+)?[LlFfDd]?$/.test(t)) return Number(t.replace(/[LlFfDd]$/, ''));
  if (t === 'true' || t === 'false') return t === 'true';
  return t;
};

// "@A @B(x = 1) @C("v") rest" -> { annos: { A: {}, B: { x: 1 }, C: { value: 'v' } }, rest }
function annotations(text) {
  const annos = {};
  let s = text.trim();
  for (;;) {
    const m = s.match(/^@([\w.]+)\s*/);
    if (!m) break;
    const name = m[1].split('.').pop();
    let args = {};
    let k = m[0].length;
    if (s[k] === '(') {
      const e = closing(s, k);
      const inner = s.slice(k + 1, e).trim();
      if (inner) for (const part of splitTop(inner)) {
        const kv = part.match(/^(\w+)\s*=\s*([\s\S]+)$/);
        if (kv && !/^["{]/.test(part)) args[kv[1]] = unquote(kv[2]); else args.value = unquote(part);
      }
      k = e + 1;
    }
    annos[name] = args;
    s = s.slice(k).trim();
  }
  return { annos, rest: s };
}

// "@NotEmpty @Size(max = 20) List<@Valid Parcel> parcels" -> { annos, type: 'List<Parcel>', name, elemAnnos: { Valid } }
function declaration(text) {
  const { annos, rest } = annotations(text);
  const r = rest.replace(/^((public|protected|private|static|final|transient|volatile)\s+)+/, '');
  const m = r.match(/^([\s\S]+?)\s+(\w+)\s*(?:=\s*([\s\S]*))?$/);
  if (!m) return null;
  const elemAnnos = {};
  const type = m[1].replace(/@([\w.]+)(\s*\([^)]*\))?\s*/g, (all, n) => { Object.assign(elemAnnos, annotations(all).annos); return ''; }).replace(/\s+/g, ' ').replace(/\s*([<>,])\s*/g, '$1').replace(/,/g, ', ').trim();
  return { annos, type, name: m[2], init: m[3] ? m[3].trim() : null, elemAnnos };
}

// The declaration of a class of the graph in its file: record components, fields, enum constants, constructors
function shape(text, c) {
  const s = noComments(text);
  const lines = s.split('\n');
  const from = lines.slice(0, Math.max(0, c.line - 1)).join('\n').length;
  const re = new RegExp(`\\b(record|class|enum|interface)\\s+${c.name}\\b`, 'g');
  re.lastIndex = Math.max(0, from - 1);
  const m = re.exec(s);
  if (!m) return null;
  let i = m.index + m[0].length;
  const out = { kind: m[1], components: [], fields: [], constants: [], ctors: [], methods: new Set() };
  while (/\s/.test(s[i])) i++;
  if (s[i] === '<') i = closing(s, i) + 1;
  while (/\s/.test(s[i])) i++;
  if (m[1] === 'record' && s[i] === '(') {
    const e = closing(s, i);
    out.components = splitTop(s.slice(i + 1, e)).map(declaration).filter(Boolean);
    i = e + 1;
  }
  const open = s.indexOf('{', i);
  if (open < 0) return out;
  const close = closing(s, open);
  const body = s.slice(open + 1, close);
  // the body's members at depth 0: up to ';' or a block
  let start = 0, enumDone = m[1] !== 'enum';
  for (let j = 0; j < body.length; j++) {
    const ch = body[j];
    if (ch === '"' || ch === "'") { j++; while (j < body.length && body[j] !== ch) j += body[j] === '\\' ? 2 : 1; continue; }
    if (ch === '(' || ch === '[' ) { j = closing(body, j); continue; }
    if (!enumDone && (ch === ';' || j === body.length - 1)) {
      out.constants = splitTop(body.slice(start, ch === ';' ? j : j + 1)).map(x => (annotations(x).rest.match(/^(\w+)/) || [])[1]).filter(Boolean);
      enumDone = true; start = j + 1; continue;
    }
    if (!enumDone) continue;
    if (ch === '{') {
      const e = closing(body, j);
      const head = body.slice(start, j).trim();
      const mm = annotations(head).rest.match(/(?:^|\s)(\w+)\s*\(([\s\S]*)\)\s*(throws[\s\S]*)?$/);
      if (mm) {
        const mods = annotations(head).rest;
        if (mm[1] === c.name && !/\b(class|record|interface|enum)\b/.test(mods)) out.ctors.push({ params: splitTop(mm[2]).map(declaration).filter(Boolean), visibility: (mods.match(/^(public|protected|private)\b/) || [])[1] || 'package' });
        else out.methods.add(mm[1]);
      }
      // "= new X() {...};" or an array initializer stays in the statement
      if (/=\s*[^;]*$/.test(head) && !/\)\s*$/.test(head)) { j = e; continue; }
      start = e + 1; j = e; continue;
    }
    if (ch === ';') {
      const stmt = body.slice(start, j).trim();
      start = j + 1;
      if (!stmt || /\(\s*[^)]*\)\s*(throws[\s\S]*)?$/.test(annotations(stmt).rest.split('=')[0])) {
        const am = annotations(stmt).rest.match(/(\w+)\s*\(/);
        if (am) out.methods.add(am[1]);
        continue;
      }
      const d = declaration(stmt);
      if (d && !/\bstatic\b/.test(annotations(stmt).rest)) out.fields.push(d);
    }
  }
  return out;
}

// ── types: resolve names in the context of a class ──
// the type's name without generics and package (java.math.BigDecimal -> BigDecimal; OrderPaid.Line stays)
const base = (t) => String(t || '').replace(/<[\s\S]*$/, '').replace(/\[\]$/, '').trim().replace(/^([a-z_][\w]*\.)+(?=[A-Z])/, '');
const generics = (t) => { const s = String(t); const i = s.indexOf('<'); return i < 0 ? [] : splitTop(s.slice(i + 1, closing(s, i))); };
const SIMPLE = new Set(['String', 'CharSequence', 'Long', 'long', 'Integer', 'int', 'Short', 'short', 'Byte', 'byte', 'Double', 'double', 'Float', 'float', 'Boolean', 'boolean', 'Character', 'char', 'BigDecimal', 'BigInteger', 'UUID', 'Instant', 'LocalDate', 'LocalDateTime', 'OffsetDateTime', 'ZonedDateTime', 'LocalTime', 'Duration', 'Object']);
const COLLECTION = /^(List|Set|Collection|Iterable|SortedSet|LinkedList|ArrayList|HashSet)$/;
const WRAPPER = /^(Optional|ResponseEntity|Mono|CompletableFuture|Page|Slice|Stream|Message|ConsumerRecord|Flux)$/;

function resolver(g) {
  const byId = new Map(g.classes.filter(c => !c.test).map(c => [c.id, c]));
  const bySimple = new Map();
  for (const c of byId.values()) (bySimple.get(c.name) || bySimple.set(c.name, []).get(c.name)).push(c);
  const imports = new Map();
  return (name, from, readFile) => {
    const n = base(name);
    if (!n || SIMPLE.has(n)) return null;
    if (n.includes('.')) {
      const hit = [...byId.values()].find(c => c.id === n || c.id.endsWith(`.${n}`));
      if (hit) return hit;
    }
    const first = n.split('.')[0];
    const cands = bySimple.get(n.split('.').pop()) || [];
    if (!cands.length) return null;
    if (cands.length === 1 && !n.includes('.')) return cands[0];
    // nested in the class or its outer classes, then imports, then the package
    for (let o = from?.id; o; o = o.includes('.') ? o.slice(0, o.lastIndexOf('.')) : null) { const c = byId.get(`${o}.${n}`); if (c) return c; }
    if (from) {
      if (!imports.has(from.file)) imports.set(from.file, [...noComments(readFile(from) || '').matchAll(/^\s*import\s+([\w.]+)\s*;/gm)].map(x => x[1]));
      const imp = imports.get(from.file).find(i => i.endsWith(`.${first}`));
      if (imp) { const c = byId.get(n.includes('.') ? `${imp}${n.slice(first.length)}` : imp); if (c) return c; }
      const pkg = from.pkg ?? from.id.slice(0, from.id.length - from.name.length - 1);
      const c = byId.get(`${pkg}.${n}`);
      if (c) return c;
    }
    return cands[0];
  };
}

// ── values ──
const snake = (n) => String(n).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const camel = (n) => n.charAt(0).toLowerCase() + n.slice(1);
const UPPER = (n) => snake(n).toUpperCase();
const javaStr = (s) => JSON.stringify(String(s));

// the shortest string that matches a (simple) regex; null when it cannot tell
function sample(re) {
  let i = 0;
  const src = String(re).replace(/^\^/, '').replace(/\$$/, '');
  const atom = () => {
    const c = src[i];
    if (c === '(') {
      let d = 0, j = i; const alts = []; let st = i + 1;
      for (; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '(') d++; else if (src[j] === ')' && --d === 0) break; else if (src[j] === '|' && d === 1) { alts.push(src.slice(st, j)); st = j + 1; } }
      alts.push(src.slice(st, j));
      i = j + 1;
      const r = sample(alts[0].replace(/^\?:/, ''));
      return r == null ? null : () => r;
    }
    if (c === '[') {
      const j = src.indexOf(']', i + 2);
      const set = src.slice(i + 1, j); i = j + 1;
      if (set.startsWith('^')) return () => 'a';
      const r = set.match(/^\\?(.)(?:-(.))?/);
      return () => (r[1] === 'd' && set.startsWith('\\d') ? '1' : r[1]);
    }
    if (c === '\\') { const e = src[i + 1]; i += 2; return () => ({ d: '1', w: 'a', s: ' ', D: 'a', W: '-', S: 'a' }[e] ?? e); }
    if (c === '.') { i++; return () => 'a'; }
    i++;
    return () => c;
  };
  let out = '';
  while (i < src.length) {
    if (src[i] === '|') break;
    const a = atom();
    if (!a) return null;
    let n = 1;
    const q = src.slice(i).match(/^(\{(\d+)(?:,(\d*))?\}|[?*+])\??/);
    if (q) { i += q[0].length; n = q[1] === '?' || q[1] === '*' ? 0 : q[1] === '+' ? 1 : Number(q[2]); }
    for (let k = 0; k < n; k++) out += a();
  }
  try { return new RegExp(`^(?:${src})$`).test(out) ? out : null; } catch { return out; }
}

// what a CHECK says about a column: IN list, lower and upper bounds
function checksOf(table, column) {
  const out = { in: null, min: null, minExclusive: false, max: null };
  for (const k of table?.constraints || []) {
    if (k.type !== 'c' || !new RegExp(`\\b${column}\\b`).test(k.def)) continue;
    const any = k.def.match(/ANY \(ARRAY\[([^\]]+)\]/) || k.def.match(/\bIN \(([^)]+)\)/i);
    if (any) out.in = [...any[1].matchAll(/'((?:[^']|'')*)'/g)].map(x => x[1].replace(/''/g, "'"));
    const gt = k.def.match(new RegExp(`${column}\\)?\\s*(>=?)\\s*\\(?(-?[\\d.]+)`));
    if (gt) { out.min = Number(gt[2]); out.minExclusive = gt[1] === '>'; }
    const lt = k.def.match(new RegExp(`${column}\\)?\\s*(<=?)\\s*\\(?(-?[\\d.]+)`));
    if (lt) out.max = Number(lt[2]) - (lt[1] === '<' ? 1e-9 : 0);
  }
  return out;
}

// how the code reads a String named name: Long.parseLong(x), new BigDecimal(x.weightKg()), UUID.fromString(...)
const PARSE = [
  [/(?:Long\.(?:parseLong|valueOf)|Integer\.(?:parseInt|valueOf)|Short\.parseShort)\(\s*([\w.]+?)(?:\(\))?(?:\.trim\(\))?\s*\)/g, 'integer'],
  [/(?:new\s+BigDecimal|Double\.(?:parseDouble|valueOf)|Float\.parseFloat|BigDecimal\.valueOf)\(\s*([\w.]+?)(?:\(\))?(?:\.trim\(\))?\s*\)/g, 'decimal'],
  [/UUID\.fromString\(\s*([\w.]+?)(?:\(\))?(?:\.trim\(\))?\s*\)/g, 'uuid'],
  [/(?:Instant|OffsetDateTime|ZonedDateTime)\.parse\(\s*([\w.]+?)(?:\(\))?\s*\)/g, 'instant'],
  [/LocalDate\.parse\(\s*([\w.]+?)(?:\(\))?\s*\)/g, 'date'],
];
function parsedNames(sources) {
  const out = new Map();
  for (const text of sources) for (const [re, kind] of PARSE) for (const m of text.matchAll(re)) {
    const last = m[1].split('.').pop().replace(/^get([A-Z])/, (a, c) => c.toLowerCase());
    if (!out.has(last)) out.set(last, kind);
  }
  return out;
}

const MONEY = /(amount|price|total|fee|sum|balance|cost)$/i;
const idConcept = (name, owner) => {
  if (/^id$/i.test(name)) return owner ? UPPER(owner) : null;
  const m = String(name).match(/^(\w+?)_?Id$/i) || String(name).match(/^(\w+?)_id$/);
  return m ? UPPER(m[1]) : null;
};

// ── the model of a module's edges and the generated class ──
function build(id, { env, db: dbName } = {}) {
  const m = W.checkId(id);
  const root = m.path;
  const g = W.index(id).graph_();
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
  // the internal libraries' classes too (their indexes, from the passport or workspace_open libraries=true):
  // a DictionaryModel or an event DTO often lives there
  const CI = require('./codeindex');
  const libClasses = [];
  for (const key of W.keys(id).slice(1)) {
    const ix = CI.load(key);
    if (!ix) continue;
    for (const c of ix.graph_().classes) if (!c.test && !g.classes.some(x => x.id === c.id) && !libClasses.some(x => x.id === c.id)) libClasses.push({ ...c, lib: key, libRoot: ix.root });
  }
  const readOf = (c) => { try { return fs.readFileSync(path.join(c.libRoot || root, c.file), 'utf8'); } catch { return null; } };
  const resolve = resolver({ classes: [...g.classes, ...libClasses] });
  const shapes = new Map();
  const shapeOf = (c) => { if (!shapes.has(c.id)) shapes.set(c.id, shape(readOf(c) || '', c)); return shapes.get(c.id); };
  const classes = g.classes.filter(c => !c.test);
  const byId = new Map([...classes, ...libClasses].map(c => [c.id, c]));
  const methodOf = (mid) => { const [cid, mn] = mid.split('#'); const c = byId.get(cid); return c && { c, m: c.methods.find(x => x.name === mn) }; };
  // parameters of a method from its source, with their annotations
  const paramsOf = (c, mt) => {
    const lines = (read(c.file) || '').split('\n');
    const text = noComments(lines.slice(Math.max(0, mt.startLine - 1), mt.endLine).join('\n'));
    const at = text.search(new RegExp(`\\b${mt.name}\\s*\\(`));
    if (at < 0) return [];
    const open = text.indexOf('(', at);
    return splitTop(text.slice(open + 1, closing(text, open))).map(declaration).filter(Boolean);
  };
  const bodyOf = (c, mt) => (read(c.file) || '').split('\n').slice(Math.max(0, mt.startLine - 1), mt.endLine).join('\n');

  // the database: tables of the entities, their columns, FKs and the dictionaries' rows
  let cat = null;
  const entityTables = new Set(classes.filter(c => c.table).map(c => c.table.toLowerCase()));
  if (env) {
    const cats = require('./pg').loadAll(env);
    const has = (x) => x.tables.some(t => entityTables.has(`${t.schema}.${t.name}`.toLowerCase()) || entityTables.has(t.name.toLowerCase()));
    cat = dbName ? cats.find(x => x.db === dbName) : cats.find(has);
  }
  const tableOf = (name) => cat?.tables.find(t => `${t.schema}.${t.name}`.toLowerCase() === String(name).toLowerCase() || t.name.toLowerCase() === String(name).toLowerCase());
  const fkOf = (t, col) => {
    for (const k of t?.constraints || []) {
      if (k.type !== 'f') continue;
      const mm = k.def.match(/FOREIGN KEY \(([^)]+)\) REFERENCES ([\w."]+)\(([^)]+)\)/);
      if (mm && mm[1].split(',').map(x => x.trim().replace(/"/g, '')).length === 1 && mm[1].trim().replace(/"/g, '') === col) return { table: mm[2].replace(/"/g, '').toLowerCase(), column: mm[3].trim().replace(/"/g, '') };
    }
    return null;
  };
  // a dictionary row to point at: an active one when the table has such a flag
  const dictRow = (table) => {
    const d = cat?.dictionaries?.[table];
    if (!d?.rows?.length) return null;
    return d.rows.find(r => r.active === true || r.enabled === true || r.is_active === true || (r.deleted === false)) || d.rows[0];
  };
  // a column of the service's tables by name: what a DTO field of that name holds in the database
  const columnsByName = new Map();
  for (const t of [...entityTables].map(tableOf).filter(Boolean)) for (const col of t.columns) if (!columnsByName.has(col.name)) columnsByName.set(col.name, { table: t, col });

  // ── dictionaries: each d_ table with the Java forms it takes in this service and its libraries ──
  //   enum      an enum named like the table (ServiceLevel <-> d_service_levels): its constants are the codes
  //   entity    an @Entity on the table (Carrier <-> d_carriers), read by a repository
  //   model     a class with code and name (and its subclasses): named like the table (ParcelTypeDictionary),
  //             or a general one (DictionaryModel) that a DAO or repository method fills from the table
  // and how the service reads it: the methods whose SQL or repository touches the table, with what they return
  const norm = (x) => String(x).toLowerCase().replace(/^.*\./, '').replace(/^d_/, '').replace(/_/g, '').replace(/ies$/, 'y').replace(/(ss)$/, '$1').replace(/([^s])s$/, '$1');
  const normJava = (n) => norm(String(n).replace(/(Dictionary|Dict|Model|Enum|Entity|Row|Item)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
  const keyOfT = (t) => `${t.schema}.${t.name}`.toLowerCase();
  const dicts = new Map();
  for (const [k, d] of Object.entries(cat?.dictionaries || {})) if (d.rows?.length) dicts.set(k, { table: k, rows: d.rows, enum: null, entity: null, models: [], reads: [], codeCol: null, idCol: null });
  const dictByNorm = new Map([...dicts.keys()].map(k => [norm(k), k]));
  for (const d of dicts.values()) {
    const t = tableOf(d.table);
    const pk = (t?.constraints || []).find(c => c.type === 'p');
    const pkCol = pk && (pk.def.match(/\(([^),]+)\)/) || [])[1]?.replace(/"/g, '').trim();
    d.codeCol = d.rows[0].code !== undefined ? 'code' : pkCol || Object.keys(d.rows[0])[0];
    d.idCol = d.rows[0].id !== undefined ? 'id' : pkCol;
    d.activeCol = ['active', 'is_active', 'enabled'].find(x => typeof d.rows[0][x] === 'boolean') || null;
  }
  const allClasses = [...byId.values()];
  const superOf = (c) => (c.ext ? resolve(String(c.ext).split(/[\s,]/)[0], c, readOf) : null);
  const modelLike = (c, depth = 0) => {
    if (!c || c.kind === 'enum' || c.kind === 'interface' || depth > 4) return false;
    const sh = shapeOf(c);
    const names = new Set([...(sh?.fields || []), ...(sh?.components || [])].map(f => f.name));
    return (names.has('code') && (names.has('name') || names.has('title') || names.has('value') || names.has('description'))) || modelLike(superOf(c), depth + 1);
  };
  if (dicts.size) {
    for (const c of allClasses) {
      const tk = c.table && tableOf(c.table) ? keyOfT(tableOf(c.table)) : null;
      if (tk && dicts.has(tk)) { dicts.get(tk).entity = c; continue; }
      const byName = dictByNorm.get(normJava(c.name));
      if (!byName) continue;
      if (c.kind === 'enum') dicts.get(byName).enum = c;
      else if (modelLike(c)) dicts.get(byName).models.push(c);
    }
    // what reads them: a method whose SQL (or repository) touches the table, and what it returns
    for (const [from, to] of g.edges) {
      if (!to.startsWith('table:') || !from.includes('#')) continue;
      const t = tableOf(to.slice(6));
      const d = t && dicts.get(keyOfT(t));
      const mm = d && methodOf(from);
      if (!mm?.m) continue;
      let r = mm.m.ret;
      const many = /^(List|Set|Collection|Iterable|Stream)</.test(r || '');
      while (WRAPPER.test(base(r)) || COLLECTION.test(base(r))) r = generics(r).slice(-1)[0] || '';
      const rc = resolve(r, mm.c, readOf);
      const body = bodyOf(mm.c, mm.m);
      const active = /\bwhere\b[^"]*\b(is_)?(active|enabled)\b/i.test(body) || /Active(True)?\b/.test(mm.m.name);
      d.reads.push({ method: `${mm.c.name}#${mm.m.name}`, via: mm.c.kind === 'interface' ? 'repository' : /JdbcTemplate|NamedParameterJdbcTemplate|JdbcClient/.test(read(mm.c.file) || '') ? 'jdbc' : 'code', returns: rc?.id || r, many, active });
      if (rc && rc.kind !== 'enum' && !rc.table && modelLike(rc) && !d.models.includes(rc)) d.models.push(rc);
    }
    // repositories of dictionary entities: their methods read the table
    for (const [from, to, kind] of g.edges) if (kind === 'repository') {
      const d = [...dicts.values()].find(x => x.entity?.id === to);
      const rc = byId.get(from);
      if (d && rc) for (const mt of rc.methods) d.reads.push({ method: `${rc.name}#${mt.name}`, via: 'repository', returns: to, many: /^(List|Set|Collection|Iterable)</.test(mt.ret || ''), active: /Active(True)?\b/.test(mt.name) });
    }
  }
  const activeRows = (d) => (d.activeCol ? d.rows.filter(r => r[d.activeCol] === true) : d.rows);
  const firstRow = (d) => activeRows(d)[0] || d.rows[0];
  // a field named like a dictionary (carrierCode, parcelType, country): that dictionary
  const dictForName = (name, owner) => {
    const n = String(name || '').replace(/(Code|Id|Key)$/, '');
    for (const cand of [n, `${owner || ''}${n[0]?.toUpperCase() || ''}${n.slice(1)}`]) { const k = dictByNorm.get(normJava(cand)); if (k) return dicts.get(k); }
    return null;
  };

  // ── Kafka: the topic's schema (registry) and its last messages, per field ──
  // A node per field: enum symbols from the schema, the values seen in the last messages, children for
  // records, items for arrays. Values of personal fields (names, emails, addresses, phones, accounts) are
  // never taken: only their shape is (a synthetic value stands in); ids keep the one-constant rule.
  const { CACHE, readJson, safeName } = require('./util');
  const topicCat = (topic) => (env && topic ? readJson(path.join(CACHE, env, 'kafka', `${safeName(topic)}.json`)) : null);
  const node = () => ({ symbols: null, samples: [], children: new Map(), items: null, type: null });
  function fromSchema(n, sch) {
    if (!sch) return n;
    if (Array.isArray(sch)) return fromSchema(n, sch.find(x => x !== 'null') ?? null);
    if (typeof sch === 'string') { n.type ||= sch; return n; }
    if (sch.type === 'enum' || Array.isArray(sch.enum)) n.symbols = sch.symbols || sch.enum;
    if (sch.type === 'record') for (const f of sch.fields || []) fromSchema(n.children.get(f.name) || n.children.set(f.name, node()).get(f.name), f.type);
    if (sch.type === 'object' && sch.properties) for (const [k, v] of Object.entries(sch.properties)) fromSchema(n.children.get(k) || n.children.set(k, node()).get(k), v);
    if (sch.type === 'array') fromSchema(n.items ||= node(), sch.items);
    if (Array.isArray(sch.type)) fromSchema(n, sch.type.find(x => x !== 'null'));
    if (typeof sch.type === 'string' && !['record', 'object', 'array', 'enum'].includes(sch.type)) n.type ||= sch.logicalType || sch.format || sch.type;
    return n;
  }
  function fromSample(n, v) {
    if (Array.isArray(v)) { for (const x of v) fromSample(n.items ||= node(), x); return n; }
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) fromSample(n.children.get(k) || n.children.set(k, node()).get(k), x); return n; }
    if (v !== null && v !== undefined) n.samples.push(v);
    return n;
  }
  const topicHints = (topic) => {
    const tc = topicCat(topic);
    if (!tc) return null;
    const n = node();
    const sch = tc.valueSchema?.schema;
    fromSchema(n, typeof sch === 'string' ? (() => { try { return JSON.parse(sch); } catch { return null; } })() : sch);
    for (const sm of tc.samples || []) fromSample(n, typeof sm.value === 'string' ? (() => { try { return JSON.parse(sm.value); } catch { return sm.value; } })() : sm.value);
    return { node: n, schema: tc.valueSchema ? `${tc.valueSchema.type || 'AVRO'} v${tc.valueSchema.version}` : null, samples: (tc.samples || []).length, raw: tc };
  };
  const PERSONAL = /(e?mail|phone|mobile|fax|first|last|surname|fullname|^name$|street|line\d|address|zip|postal|postcode|city|birth|dob|passport|iban|card|account|ssn|tax|token|password|secret|^ip$|lat|lon|geo)/i;
  const mostFrequent = (xs) => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0]; };

  const parsed = parsedNames(classes.map(c => read(c.file) || ''));
  const consts = new Map(); // ORDER_ID -> value
  const notes = [];
  const used = { imports: new Set(), helpers: new Set() };
  const factories = new Map(); // class id -> { name, code, type }
  const NOW = 'Instant.parse("2026-01-15T10:00:00Z")';

  const idConst = (concept, kind = 'long') => {
    if (!consts.has(concept)) consts.set(concept, { kind, value: kind === 'uuid' ? `UUID.fromString("00000000-0000-0000-0000-${String(consts.size + 1).padStart(12, '0')}")` : `${(consts.size + 1) * 1000 + 1}L` });
    return `${concept}_ID`;
  };
  const typeRef = (c) => {
    // nested classes as Outer.Inner; top-level ones imported
    const chain = [];
    for (let x = c; x; ) {
      chain.unshift(x.name);
      const outer = x.id.slice(0, x.id.length - x.name.length - 1);
      const oc = byId.get(outer);
      if (!oc) { used.imports.add(`${outer}.${chain[0]}`); break; }
      x = oc;
    }
    return chain.join('.');
  };
  const factoryName = (c) => {
    const outer = byId.get(c.id.slice(0, c.id.length - c.name.length - 1));
    let n = camel(c.name);
    const clash = [...byId.values()].some(o => o.id !== c.id && o.name === c.name);
    if (clash && outer) n = camel(outer.name) + c.name;
    else if (clash) n = camel(c.id.split('.').slice(-2, -1)[0] || '') + c.name;
    return /^(set|create|json|with|cases|valid|invalid|of|new|class|default|enum|record|int|long|char|boolean|byte|short|double|float)$/.test(n) ? `${n}Value` : n;
  };

  // a Java expression for a value of type t, known: { name, annos, elemAnnos, col: {table, col}, owner, from: class }
  function value(t, k, depth = 0) {
    const b = base(t);
    const a = k.annos || {};
    const name = k.name || '';
    const colInfo = k.col || columnsByName.get(snake(name));
    const col = colInfo?.col, table = colInfo?.table;
    const checks = col ? checksOf(table, col.name) : {};
    const fk = col ? fkOf(table, col.name) : null;
    const dict = fk && /(^|\.)d_/.test(fk.table) ? dictRow(fk.table) : null;
    if (/\[\]$/.test(t)) return b === 'byte' ? 'new byte[0]' : `new ${b}[] { ${value(b, { name }, depth + 1)} }`;
    if (COLLECTION.test(b)) {
      const el = generics(t)[0] || 'Object';
      const n = Math.max(1, Number(a.Size?.min || 0), Number(a.NotEmpty ? 1 : 0));
      const one = value(el, { name: name.replace(/s$/, ''), annos: k.elemAnnos || {}, from: k.from, owner: k.owner, hint: k.hint?.items }, depth + 1);
      return `${/Set$/.test(b) ? 'Set' : 'List'}.of(${Array(Math.min(n, 3)).fill(one).join(', ')})`;
    }
    if (/^Map$|Map$/.test(b)) return 'Map.of()';
    if (b === 'Optional') return `Optional.of(${value(generics(t)[0], { ...k, annos: {} }, depth + 1)})`;
    if (dict && fk) {
      // an enum over a dictionary column: a code of the table that the enum has, active rows first
      const ec = !SIMPLE.has(b) && resolve(t, k.from, readOf);
      if (ec && (ec.kind === 'enum' || shapeOf(ec)?.kind === 'enum')) {
        const d = dicts.get(fk.table);
        const consts_ = shapeOf(ec)?.constants || [];
        // the enum's own order (its default comes first), among the active codes, then any code
        const codes = (rows) => new Set(rows.map(r => String(r[fk.column])));
        const code = d && (consts_.find(x => codes(activeRows(d)).has(x)) || consts_.find(x => codes(d.rows).has(x)));
        if (code) return `${typeRef(ec)}.${code}`;
      } else {
        const v = dict[fk.column];
        if (v != null) return lit(b, v);
      }
    }
    const concept = idConcept(name, k.owner);
    // a field named like a dictionary (carrierCode, parcelType, countryId): a code (or id) of a real row
    const dn = !dict ? dictForName(name, k.owner) : null;
    if (dn && /^(String|CharSequence)$/.test(b) && firstRow(dn)[dn.codeCol] != null) { dn.usedBy = [...(dn.usedBy || []), `${k.owner || ''}.${name}`]; return javaStr(firstRow(dn)[dn.codeCol]); }
    if (dn && /^(long|Long|int|Integer)$/.test(b) && /Id$/.test(name) && dn.idCol && firstRow(dn)[dn.idCol] != null) { dn.usedBy = [...(dn.usedBy || []), `${k.owner || ''}.${name}`]; return lit(b, firstRow(dn)[dn.idCol]); }
    // what the topic's schema and last messages hold for it (never for personal fields)
    const h = k.hint;
    const seen = (accept) => {
      if (!h || PERSONAL.test(name)) return undefined;
      const pool = (h.symbols ? h.samples.filter(x => h.symbols.includes(x)) : h.samples).filter(accept);
      const v = mostFrequent(pool);
      return v !== undefined ? v : (h.symbols || []).find(accept);
    };
    switch (b) {
      case 'String': case 'CharSequence': {
        const kind = parsed.get(name);
        if (kind === 'integer') return concept ? `String.valueOf(${idConst(concept)})` : '"1"';
        if (kind === 'uuid') return concept ? `${idConst(concept, 'uuid')}.toString()` : '"00000000-0000-0000-0000-000000000001"';
        if (kind === 'instant') return '"2026-01-15T10:00:00Z"';
        if (kind === 'date') return '"2026-01-15"';
        if (checks.in?.length) return javaStr(checks.in[0]);
        const len = col && (col.type.match(/(?:character varying|varchar|character|char|bpchar)\((\d+)\)/) || [])[1];
        const max = Math.min(...[a.Size?.max, len].filter(x => x != null).map(Number), Infinity);
        const min = Math.max(Number(a.Size?.min || 0), a.NotBlank || a.NotEmpty ? 1 : 0, /^(character|char|bpchar)\(/.test(col?.type || '') ? Number(len) : 0);
        const pat = a.Pattern?.regexp || a.Pattern?.value;
        const fits = (x) => typeof x === 'string' && x.length <= max && x.length >= min && (!pat || (() => { try { return new RegExp(`^(?:${pat})$`).test(x); } catch { return true; } })()) && (kind !== 'decimal' || /^-?\d+(\.\d+)?$/.test(x));
        const fromTopic = concept ? undefined : seen(fits);
        if (fromTopic !== undefined) return javaStr(fromTopic);
        if (kind === 'decimal') return '"1.5"';
        let s = null;
        if (pat) s = sample(pat);
        if (s == null && (a.Email || /e?mail$/i.test(name))) s = 'test@example.com';
        if (s == null) s = byName(name);
        if (s.length > max) s = s.slice(0, max);
        while (s.length < min) s += 'x';
        return javaStr(s);
      }
      case 'long': case 'Long': case 'int': case 'Integer': case 'short': case 'Short': case 'byte': case 'Byte': {
        const L = /^[lL]ong$/.test(b) ? 'L' : '';
        if (concept && !/^(int|Integer|short|Short|byte|Byte)$/.test(b) && !a.Min && !a.Max) return idConst(concept);
        const lo = Math.max(Number(a.Min?.value ?? -Infinity), a.Positive ? 1 : -Infinity, checks.min != null ? checks.min + (checks.minExclusive ? 1 : 0) : -Infinity);
        const hi = Math.min(Number(a.Max?.value ?? Infinity), checks.max != null ? Math.floor(checks.max) : Infinity);
        const fromTopic = concept ? undefined : seen(x => Number.isInteger(x) && x >= lo && x <= hi);
        let v = fromTopic !== undefined ? fromTopic : Math.max(1, lo);
        v = Math.min(v, hi);
        const cast = /^(short|Short)$/.test(b) ? '(short) ' : /^(byte|Byte)$/.test(b) ? '(byte) ' : '';
        return `${cast}${v}${L}`;
      }
      case 'BigDecimal': {
        const scale = Number((col?.type.match(/numeric\(\d+,\s*(\d+)\)/) || [])[1] ?? a.Digits?.fraction ?? (MONEY.test(name) ? 2 : 0));
        let v = MONEY.test(name) ? 10 : 1;
        const lo = [a.DecimalMin?.value, a.Min?.value, checks.min].filter(x => x != null).map(Number);
        const hi = [a.DecimalMax?.value, a.Max?.value, checks.max].filter(x => x != null).map(Number);
        if (lo.length) v = Math.max(v, ...lo);
        if (hi.length) v = Math.min(v, ...hi);
        used.imports.add('java.math.BigDecimal');
        const fromTopic = seen(x => /^-?\d+(\.\d+)?$/.test(String(x)) && (!lo.length || Number(x) >= Math.max(...lo)) && (!hi.length || Number(x) <= Math.min(...hi)));
        if (fromTopic !== undefined) return `new BigDecimal("${fromTopic}")`;
        return `new BigDecimal("${v.toFixed(scale)}")`;
      }
      case 'BigInteger': used.imports.add('java.math.BigInteger'); return 'BigInteger.ONE';
      case 'double': case 'Double': return '1.0';
      case 'float': case 'Float': return '1.0f';
      case 'boolean': case 'Boolean': return /^(is)?(active|enabled|valid|visible|available)$/i.test(name) ? 'true' : 'false';
      case 'char': case 'Character': return "'a'";
      case 'UUID': used.imports.add('java.util.UUID'); return concept ? idConst(concept, 'uuid') : 'UUID.fromString("00000000-0000-0000-0000-000000000001")';
      case 'Instant': used.imports.add('java.time.Instant'); return a.Future || a.FutureOrPresent ? 'Instant.parse("2100-01-01T00:00:00Z")' : NOW;
      case 'OffsetDateTime': used.imports.add('java.time.OffsetDateTime'); used.imports.add('java.time.ZoneOffset'); return a.Future ? 'OffsetDateTime.of(2100, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC)' : 'OffsetDateTime.of(2026, 1, 15, 10, 0, 0, 0, ZoneOffset.UTC)';
      case 'ZonedDateTime': used.imports.add('java.time.ZonedDateTime'); return 'ZonedDateTime.parse("2026-01-15T10:00:00Z")';
      case 'LocalDate': used.imports.add('java.time.LocalDate'); return a.Future ? 'LocalDate.of(2100, 1, 1)' : 'LocalDate.of(2026, 1, 15)';
      case 'LocalDateTime': used.imports.add('java.time.LocalDateTime'); return a.Future ? 'LocalDateTime.of(2100, 1, 1, 0, 0)' : 'LocalDateTime.of(2026, 1, 15, 10, 0)';
      case 'LocalTime': used.imports.add('java.time.LocalTime'); return 'LocalTime.of(10, 0)';
      case 'Duration': used.imports.add('java.time.Duration'); return 'Duration.ofMinutes(1)';
      case 'Object': return '"x"';
    }
    const c = resolve(t, k.from, readOf);
    if (!c) return 'null';
    const sh = shapeOf(c);
    if (c.kind === 'enum' || sh?.kind === 'enum') {
      const consts_ = sh?.constants || [];
      // the database's CHECK, the dictionary the enum mirrors, the topic's values, the first constant
      const de = [...dicts.values()].find(d => d.enum?.id === c.id);
      const deCode = de && (consts_.find(x => activeRows(de).some(r => String(r[de.codeCol]) === x)) || consts_.find(x => de.rows.some(r => String(r[de.codeCol]) === x)));
      const pick = (checks.in || []).find(v => consts_.includes(v)) || deCode || seen(x => consts_.includes(x)) || consts_[0];
      return pick ? `${typeRef(c)}.${pick}` : 'null';
    }
    if (depth > 6) return 'null';
    // a dictionary's model or entity: a real row of it
    const dd = [...dicts.values()].filter(d => d.models.some(x => x.id === c.id) || d.entity?.id === c.id);
    const d1 = dd.length === 1 ? dd[0] : dd.find(d => d === dictForName(name, k.owner));
    if (d1) return `${dictFactory(d1, c).one}()`;
    return `${factory(c, depth + 1, k.hint)}()`;
  }
  const lit = (b, v) => {
    if (/^(long|Long)$/.test(b)) return `${v}L`;
    if (/^(int|Integer|short|Short|double|Double)$/.test(b)) return String(v);
    if (b === 'BigDecimal') { used.imports.add('java.math.BigDecimal'); return `new BigDecimal("${v}")`; }
    if (/^(boolean|Boolean)$/.test(b)) return String(!!v);
    return javaStr(v);
  };

  // factories of a dictionary in one of its Java forms: one (an active row), all rows, the active ones
  const dictFactories = new Map();
  const plural = (n) => (/y$/.test(n) ? n.replace(/y$/, 'ies') : /(s|x|ch|sh)$/.test(n) ? `${n}es` : `${n}s`);
  function dictFactory(d, c) {
    const key = `${d.table}|${c.id}`;
    if (dictFactories.has(key)) return dictFactories.get(key);
    const tname = d.table.split('.').pop().replace(/^d_/, '');
    let one = camel(tname.replace(/ies$/, 'y').replace(/([^s])s$/, '$1').replace(/_(\w)/g, (m, x) => x.toUpperCase()));
    const taken = (n) => [...factories.values()].some(f => f.name === n && f.cls.id !== c.id) || [...dictFactories.values()].some(f => f.one === n);
    if (taken(one)) one = `${one}${c.name}`;
    const f = { d, cls: c, one, all: plural(one), active: d.activeCol && activeRows(d).length < d.rows.length ? `active${plural(one)[0].toUpperCase()}${plural(one).slice(1)}` : null, type: typeRef(c) };
    dictFactories.set(key, f);
    // an entity has its factory already (a real row of it): the same name for one
    if (d.entity?.id === c.id) f.one = factory(c);
    return f;
  }
  // a dictionary row as an object of class c: its constructor with the row's columns by name, else its fields
  const fieldsUp = (c, depth = 0) => (!c || depth > 4 ? [] : [...(shapeOf(c)?.fields || []), ...(shapeOf(c)?.components || []), ...fieldsUp(superOf(c), depth + 1)]);
  function rowExpr(c, row) {
    const sh = shapeOf(c) || { ctors: [] };
    const T = typeRef(c);
    const colFor = (n) => [snake(n), n.toLowerCase(), n].find(x => row[x] !== undefined);
    const valOf = (type, n) => { const col = colFor(n); return col === undefined ? (/^(int|long|short|double|float|boolean)$/.test(base(type)) ? value(type, { name: n }) : 'null') : row[col] == null ? 'null' : lit(base(type), row[col]); };
    if (sh.kind === 'record') return `new ${T}(${sh.components.map(p => valOf(p.type, p.name)).join(', ')})`;
    const ctor = sh.ctors.filter(k => k.visibility === 'public').sort((x, y) => y.params.length - x.params.length)[0];
    if (ctor && ctor.params.every(p => colFor(p.name) !== undefined || !/^(int|long|short|double|float|boolean)$/.test(base(p.type)))) return `new ${T}(${ctor.params.map(p => valOf(p.type, p.name)).join(', ')})`;
    used.helpers.add('set'); used.helpers.add('instance'); used.helpers.add('dictionaryRow'); used.imports.add('java.util.function.Consumer');
    return `dictionaryRow(${T}.class, x -> { ${fieldsUp(c).filter(fl => colFor(fl.name) !== undefined).map(fl => `set(x, "${fl.name}", ${valOf(fl.type, fl.name)})`).join('; ')}; })`;
  }

  // a factory method for a class: through its canonical / richest public constructor, the rest by setter or field
  function factory(c, depth = 0, hint = null) {
    if (factories.has(c.id)) return factories.get(c.id).name;
    const name = factoryName(c);
    const entry = { name, type: typeRef(c), code: null, cls: c, ...(hint ? { fromTopic: true } : {}) };
    factories.set(c.id, entry);
    const sh = shapeOf(c) || { components: [], fields: [], ctors: [], methods: new Set() };
    const entity = !!c.table || c.annos.includes('Entity');
    const table = entity ? tableOf(c.table || snake(c.name)) : null;
    const known = (fieldDecl) => {
      const fc = (byId.get(c.id)?.fields || []).find(f => f.name === fieldDecl.name);
      const colName = fc?.column || (fieldDecl.annos.Column?.name) || snake(fieldDecl.name);
      const col = table?.columns.find(x => x.name === colName);
      return { name: fieldDecl.name, annos: fieldDecl.annos, elemAnnos: fieldDecl.elemAnnos, col: col ? { table, col } : undefined, owner: c.name, from: c, hint: hint?.children?.get(fieldDecl.name) };
    };
    // a dictionary entity: a real row of it
    const drow = table && dictRow(`${table.schema}.${table.name}`.toLowerCase());
    const colOf = (f) => known(f).col?.col.name || snake(f.name);
    const val = (f, type, k) => (drow && drow[colOf(f)] !== undefined ? (drow[colOf(f)] == null ? 'null' : lit(base(type), drow[colOf(f)])) : value(type, k, depth));
    const lines = [];
    const T = entry.type;
    if (sh.kind === 'record') {
      entry.code = `return new ${T}(${sh.components.map(p => value(p.type, known(p), depth)).join(', ')});`;
      entry.components = sh.components;
      return name;
    }
    const lombokBuilder = c.lombok?.includes('Builder');
    const fields = sh.fields;
    if (lombokBuilder) {
      entry.code = `return ${T}.builder()${fields.map(f => `\n        .${f.name}(${value(f.type, known(f), depth)})`).join('')}\n        .build();`;
      entry.fields = fields;
      return name;
    }
    const pub = sh.ctors.filter(k => k.visibility === 'public');
    const ctor = pub.sort((x, y) => y.params.length - x.params.length)[0];
    const set = new Set();
    if (ctor) {
      lines.push(`${T} x = new ${T}(${ctor.params.map(p => { const f = fields.find(ff => ff.name === p.name) || p; set.add(p.name); return val(f, p.type, { ...known(f), annos: { ...p.annos, ...f.annos } }); }).join(', ')});`);
    } else if (!sh.ctors.length || sh.ctors.some(k => !k.params.length && k.visibility !== 'public')) {
      if (sh.ctors.length) { lines.push(`${T} x = instance(${T}.class);`); used.helpers.add('instance'); } else lines.push(`${T} x = new ${T}();`);
    } else {
      lines.push(`${T} x = instance(${T}.class); // no public constructor`); used.helpers.add('instance');
    }
    // the rest: what a row of the database holds (id, not null columns, defaults) or a DTO's setters
    for (const f of fields) {
      if (set.has(f.name) || (f.init != null && !drow)) continue;
      const k = known(f);
      if (drow && drow[colOf(f)] !== undefined) {
        const setter = `set${f.name[0].toUpperCase()}${f.name.slice(1)}`;
        const v = val(f, f.type, k);
        if (sh.methods.has(setter)) lines.push(`x.${setter}(${v});`); else { lines.push(`set(x, "${f.name}", ${v});`); used.helpers.add('set'); }
        continue;
      }
      const isId = !!f.annos.Id;
      const notNull = k.col && !k.col.col.nullable;
      const dbDefault = k.col?.col.default != null;
      if (!(isId || notNull || (!entity && f.annos.NotNull) || (!entity && (f.annos.NotBlank || f.annos.NotEmpty)) || (!entity && !c.table && !ctor))) continue;
      if (entity && !isId && !notNull && !dbDefault) continue;
      const v = value(f.type, isId ? { ...k, name: 'id', owner: c.name } : k, depth);
      const setter = `set${f.name[0].toUpperCase()}${f.name.slice(1)}`;
      if (sh.methods.has(setter) || c.lombok?.some(l => /^(Data|Setter)$/.test(l))) lines.push(`x.${setter}(${v});`);
      else { lines.push(`set(x, "${f.name}", ${v});`); used.helpers.add('set'); }
    }
    lines.push('return x;');
    entry.code = lines.join('\n');
    entry.fields = fields;
    return name;
  }

  // ── the edges ──
  const edges = [];
  const add = (e) => { if (!edges.some(x => x.at === e.at && x.type === e.type && x.kind === e.kind)) edges.push(e); };
  for (const [from, to, kind] of g.edges) {
    if (kind === 'handler') {
      const mm = methodOf(to);
      if (!mm?.m) continue;
      for (const p of paramsOf(mm.c, mm.m)) {
        const at = `${from.replace(/^endpoint:/, '')} (${mm.c.name}#${mm.m.name})`;
        if (p.annos.RequestBody) { const c = resolve(p.type, mm.c, readOf); if (c) add({ kind: 'body', at, type: c.id, valid: !!(p.annos.Valid || p.annos.Validated), cls: c }); }
        else if (p.annos.PathVariable || p.annos.RequestParam) {
          const owner = (resolve(mm.m.ret, mm.c, readOf) || {}).name || mm.c.name.replace(/(Controller|Resource|Api|Endpoint)$/, '');
          add({ kind: p.annos.PathVariable ? 'path' : 'param', at, param: p.name, value: value(p.type, { name: p.name, annos: p.annos, owner, from: mm.c }) });
        }
      }
    }
    if (kind === 'consumes' && to.startsWith('topic:')) {
      const mm = methodOf(from);
      if (!mm?.m) continue;
      const p = paramsOf(mm.c, mm.m).find(x => !x.annos.Header && !x.annos.Headers && !/^(Acknowledgment|Consumer|Headers)$/.test(base(x.type)));
      if (!p) continue;
      let t = p.type;
      while (WRAPPER.test(base(t)) || COLLECTION.test(base(t))) t = generics(t).slice(-1)[0] || 'String';
      const topic = to.slice(6);
      const at = `${topic} (${mm.c.name}#${mm.m.name})`;
      const c = resolve(t, mm.c, readOf);
      if (c) add({ kind: 'kafka-in', at, topic, type: c.id, cls: c, hints: topicHints(topic) });
      else if (base(t) === 'String') {
        const body = bodyOf(mm.c, mm.m);
        const kinds = parsedNames([body]);
        // JSON text the listener reads into a DTO: mapper.readValue(payload, ParcelScanned.class)
        const rv = noComments(body).match(new RegExp(`readValue\\(\\s*${p.name}\\s*,\\s*([\\w.]+)\\.class`));
        const dto = rv && resolve(rv[1], mm.c, readOf);
        if (dto) add({ kind: 'kafka-in', at, topic, param: p.name, text: true, json: true, type: dto.id, cls: dto, hints: topicHints(topic) });
        else {
          // no DTO: the last message's shape, personal values replaced
          const th = topicHints(topic);
          const last = th?.raw.samples?.[0]?.value;
          add({ kind: 'kafka-in', at, topic, param: p.name, text: true, value: kinds.has(p.name) ? value('String', { name: p.name }) : last && typeof last === 'object' ? javaStr(JSON.stringify(masked(last))) : null, hints: th });
        }
      }
    }
    if (kind === 'repository') {
      const c = byId.get(to);
      if (c) add({ kind: 'repository', at: from.split('.').pop(), type: c.id, cls: c });
    }
  }
  // what the service sends: KafkaTemplate<K, V> with a V of its own
  for (const c of classes) for (const f of [...c.fields, ...c.ctor]) {
    if (!/^(KafkaTemplate|ReactiveKafkaProducerTemplate|Producer|KafkaProducer)$/.test(base(f.type))) continue;
    const v = generics(f.type)[1];
    const vc = v && resolve(v, c, readOf);
    if (!vc) continue;
    const topic = g.edges.find(e => e[2] === 'produced-by' && e[1].startsWith(`${c.id}#`))?.[0]?.slice(6) || null;
    add({ kind: 'kafka-out', at: `${c.name}.${f.name}`, topic, type: vc.id, cls: vc, hints: topic ? topicHints(topic) : null });
  }
  // what other services answer: Feign clients' return types
  for (const c of classes.filter(x => x.annos.includes('FeignClient') || x.annos.includes('HttpExchange'))) {
    for (const mt of c.methods) {
      let t = mt.ret;
      while (WRAPPER.test(base(t)) || COLLECTION.test(base(t))) t = generics(t).slice(-1)[0] || '';
      const rc = resolve(t, c, readOf);
      if (rc) add({ kind: 'http-in', at: `${c.name}#${mt.name}`, type: rc.id, cls: rc });
    }
  }
  // the edges with a topic's schema or messages first: their classes take the values from there
  for (const e of [...edges].sort((x, y) => (y.hints ? 1 : 0) - (x.hints ? 1 : 0))) if (e.cls) e.factory = factory(e.cls, 0, e.hints?.node);
  // a DTO against its topic's schema: fields one has and the other lacks
  for (const e of edges.filter(x => x.hints?.node.children.size && x.cls)) {
    const names = new Set(fieldsUp(e.cls).map(f => f.name));
    const schemaNames = new Set(e.hints.node.children.keys());
    const notInDto = [...schemaNames].filter(n => !names.has(n)), notInTopic = [...names].filter(n => !schemaNames.has(n));
    if (notInDto.length || notInTopic.length) e.differs = { ...(notInDto.length ? { notInDto } : {}), ...(notInTopic.length ? { notInTopic } : {}), from: e.hints.schema ? `schema ${e.hints.schema}` : `the last ${e.hints.samples} messages` };
  }
  // the dictionaries this service has a Java form or a read of: their factories, and how enum and table agree
  const dictionaries = [];
  for (const d of dicts.values()) {
    if (!d.entity && !d.models.length && !d.enum && !d.reads.length && !d.usedBy) continue;
    const forms = [d.entity, ...d.models].filter(Boolean).map(c => dictFactory(d, c));
    let enumCheck = null;
    if (d.enum) {
      const consts_ = shapeOf(d.enum)?.constants || [];
      const codes = d.rows.map(r => String(r[d.codeCol]));
      const notInEnum = codes.filter(x => !consts_.includes(x)), notInTable = consts_.filter(x => !codes.includes(x));
      if (notInEnum.length || notInTable.length) enumCheck = { ...(notInEnum.length ? { notInEnum } : {}), ...(notInTable.length ? { notInTable } : {}) };
    }
    dictionaries.push({ ...d, forms, enumCheck });
  }
  const rows = cat ? rowsOf() : [];
  return { id, root, g, edges, factories, consts, dictionaries, rows, used, notes, cat, cases: casesFor, value, read, resolve, shapeOf, rowExpr, activeRows, firstRow };

  // ── rows for database tests: the service's tables and the parents they need, as plain SQL inserts ──
  // Each required column (not null, no default) gets a value: an FK to a dictionary a loaded row, an FK to
  // another table that table's row (a parameter, or inserted first), a CHECK list its first value, a unique
  // column a running number. Dictionaries are in the snapshot already: no methods for them.
  function rowsOf() {
    const isDict = (k) => /(^|\.)d_/.test(k) || !!cat.dictionaries?.[k];
    const keyOf = (t) => `${t.schema}.${t.name}`.toLowerCase();
    const wanted = new Set();
    for (const [, to] of g.edges) if (to.startsWith('table:')) { const t = tableOf(to.slice(6)); if (t) wanted.add(keyOf(t)); }
    for (const t of entityTables) { const tt = tableOf(t); if (tt) wanted.add(keyOf(tt)); }
    const order = [], seen = new Set();
    const visit = (k, depth = 0) => {
      if (seen.has(k) || isDict(k) || depth > 20) return;
      const t = tableOf(k);
      if (!t || t.kind !== 'table') return;
      seen.add(k);
      for (const c of t.columns) { const fk = fkOf(t, c.name); if (fk && fk.table !== k && !c.nullable && !c.default) visit(fk.table, depth + 1); }
      order.push(k);
    };
    [...wanted].sort().forEach(k => visit(k));
    const types = new Map((cat.types || []).map(t => [`${t.schema}.${t.name}`.toLowerCase(), t]));
    const uniques = (t) => new Set((t.constraints || []).filter(k => k.type === 'u' || k.type === 'p').map(k => (k.def.match(/\(([^)]+)\)/) || [])[1]).filter(x => x && !x.includes(',')).map(x => x.replace(/"/g, '').trim()));
    const methodName = (t) => {
      let n = t.name.replace(/^(t|tbl)_/, '');
      n = n.replace(/ies$/, 'y').replace(/(sses|xes|ches|shes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, '$1');
      n = n.replace(/_(\w)/g, (m, c) => c.toUpperCase());
      return /^(id|next|insert|jdbc|rows|class|new|default|case|order|for|do|if|int|long|char)$/.test(n) ? `${n}Row` : n;
    };
    const names = new Map(order.map(k => [k, methodName(tableOf(k))]));
    // two tables of one name in two schemas: the schema in the name
    for (const [k, n] of names) if ([...names.values()].filter(x => x === n).length > 1) names.set(k, `${k.split('.')[0]}${n[0].toUpperCase()}${n.slice(1)}`);
    return order.map(k => {
      const t = tableOf(k);
      const uq = uniques(t);
      const pk = (t.constraints || []).find(c => c.type === 'p');
      const pkCols = pk ? (pk.def.match(/\(([^)]+)\)/) || [])[1].split(',').map(x => x.replace(/"/g, '').trim()) : [];
      const cols = [], params = [], why = [];
      for (const c of t.columns) {
        if (c.nullable || c.default != null || c.identity || c.generated) continue;
        const fk = fkOf(t, c.name);
        const dom = types.get(String(c.type).toLowerCase());
        const ptype = dom?.kind === 'domain' ? dom.base : c.type;
        const cast = dom ? `cast(? as ${c.type})` : /^jsonb?$/.test(c.type) ? `cast(? as ${c.type})` : '?';
        let v;
        if (fk && isDict(fk.table)) {
          const r = dictRow(fk.table);
          v = r && r[fk.column] != null ? sqlLit(ptype, r[fk.column]) : 'null';
          why.push(`${c.name} -> ${fk.table} (a loaded row)`);
        } else if (fk && fk.table !== k && names.has(fk.table)) {
          const pn = camel(c.name.replace(/_(\w)/g, (m, x) => x.toUpperCase()));
          params.push({ name: pn, type: /int|serial/.test(ptype) ? 'long' : 'Object', parent: names.get(fk.table) });
          v = pn;
          why.push(`${c.name} -> ${fk.table}`);
        } else {
          const ch = checksOf(t, c.name);
          if (dom?.kind === 'enum') v = javaStr(dom.labels[0]);
          else if (ch.in?.length) v = javaStr(ch.in[0]);
          else if (uq.has(c.name) || pkCols.includes(c.name)) {
            v = /int|serial|numeric/.test(ptype) ? 'next()' : /uuid/.test(ptype) ? 'UUID.randomUUID()' : /e?mail/.test(c.name) ? `"${c.name}-" + next() + "@example.com"` : `"${c.name}-" + next()`;
            if (/uuid/.test(ptype)) used.imports.add('java.util.UUID');
            why.push(`${c.name} unique`);
          } else v = colValue(ptype, c.name, t, dom);
          if (ch.in?.length) why.push(`${c.name} in (${ch.in.join(', ')})`);
        }
        cols.push({ name: c.name, value: v, cast });
      }
      const ret = pkCols.length === 1 ? pkCols[0] : null;
      const retCol = ret && t.columns.find(c => c.name === ret);
      const retType = retCol && /int|serial/.test(retCol.type) ? 'long' : retCol && /uuid/.test(retCol.type) ? 'UUID' : retCol ? 'Object' : null;
      return { table: k, name: names.get(k), cols, params, why, returning: ret, retType };
    });
  }
  function colValue(type, name, t, dom) {
    const ch = checksOf(t, name);
    if (/^(bigint|integer|smallint|int\d?)$/.test(type)) return String(Math.max(1, ch.min != null ? ch.min + (ch.minExclusive ? 1 : 0) : 1)) + (type === 'bigint' ? 'L' : '');
    if (/^(numeric|decimal|real|double)/.test(type) || /^money$/.test(type)) {
      const scale = Number((type.match(/\(\d+,\s*(\d+)\)/) || [])[1] || 0);
      const domMin = dom ? checksOf({ constraints: (dom.checks || []).map(def => ({ type: 'c', def: def.replace(/VALUE/g, name) })) }, name).min : null;
      let v = MONEY.test(name.replace(/_/g, '')) ? 10 : 1;
      if (ch.min != null) v = Math.max(v, ch.min + (ch.minExclusive ? 1 : 0));
      if (domMin != null) v = Math.max(v, domMin);
      used.imports.add('java.math.BigDecimal');
      return `new BigDecimal("${v.toFixed(scale)}")`;
    }
    if (/^bool/.test(type)) return /active|enabled/.test(name) ? 'true' : 'false';
    if (/^timestamp/.test(type)) { used.imports.add('java.time.OffsetDateTime'); used.imports.add('java.time.ZoneOffset'); return 'OffsetDateTime.of(2026, 1, 15, 10, 0, 0, 0, ZoneOffset.UTC)'; }
    if (/^date$/.test(type)) { used.imports.add('java.time.LocalDate'); return 'LocalDate.of(2026, 1, 15)'; }
    if (/^uuid$/.test(type)) { used.imports.add('java.util.UUID'); return 'UUID.randomUUID()'; }
    if (/^jsonb?$/.test(type)) return '"{}"';
    if (/\[\]$/.test(type)) return 'new String[0]';
    const len = Number((type.match(/\((\d+)\)/) || [])[1] || 0);
    let s = byName(name.replace(/_(\w)/g, (m, c) => c.toUpperCase()));
    if (len && s.length > len) s = s.slice(0, len);
    if (/^(character|char|bpchar)\(/.test(type)) while (s.length < len) s += 'x';
    return javaStr(s);
  }

  // ── cases of a validated type: each constraint just broken, and the edges that still pass ──
  function casesFor(c, depth = 0) {
    const sh = shapeOf(c);
    const comps = sh?.kind === 'record' ? sh.components : (sh?.fields || []);
    const f = factories.get(c.id)?.name || factory(c);
    const out = [];
    const wrap = (prop, v) => `with(${f}(), "${prop}", ${v})`;
    for (const p of comps) {
      const a = p.annos, b = base(p.type), k = { name: p.name, annos: a, elemAnnos: p.elemAnnos, from: c, owner: c.name };
      const tag = (n) => `@${n}${Object.keys(a[n] || {}).length ? `(${Object.entries(a[n]).map(([x, y]) => (x === 'value' ? JSON.stringify(y) : `${x} = ${JSON.stringify(y)}`)).join(', ')})` : ''}`;
      const isStr = b === 'String' || b === 'CharSequence';
      const isColl = COLLECTION.test(b) || /Map$/.test(b);
      if (!/^(int|long|short|byte|double|float|boolean|char)$/.test(b)) {
        const req = a.NotNull || a.NotBlank || a.NotEmpty;
        out.push({ name: `${p.name} null`, valid: !req, why: req ? tag(a.NotNull ? 'NotNull' : a.NotBlank ? 'NotBlank' : 'NotEmpty') : 'no constraint: accepted', expr: wrap(p.name, 'null') });
      }
      if (isStr && a.NotBlank) out.push({ name: `${p.name} blank`, valid: false, why: tag('NotBlank'), expr: wrap(p.name, '" "') });
      if ((isStr || isColl) && a.NotEmpty) out.push({ name: `${p.name} empty`, valid: false, why: tag('NotEmpty'), expr: wrap(p.name, isStr ? '""' : /Set$/.test(b) ? 'Set.of()' : /Map$/.test(b) ? 'Map.of()' : 'List.of()') });
      if (a.Size?.max != null) {
        const n = Number(a.Size.max);
        if (isStr) { out.push({ name: `${p.name} ${n} long`, valid: true, why: tag('Size'), expr: wrap(p.name, `"x".repeat(${n})`) }); out.push({ name: `${p.name} ${n + 1} long`, valid: false, why: tag('Size'), expr: wrap(p.name, `"x".repeat(${n + 1})`) }); }
        else if (COLLECTION.test(b)) { const el = value(p.type, k).replace(/^(List|Set)\.of\(([\s\S]*?)(, [\s\S]*)?\)$/, '$2'); out.push({ name: `${p.name} ${n + 1} items`, valid: false, why: tag('Size'), expr: wrap(p.name, `Collections.nCopies(${n + 1}, ${el})`) }); used.imports.add('java.util.Collections'); }
      }
      if (a.Size?.min > 0) out.push({ name: `${p.name} under ${a.Size.min}`, valid: false, why: tag('Size'), expr: wrap(p.name, isStr ? `"x".repeat(${a.Size.min - 1})` : 'List.of()') });
      if (COLLECTION.test(b) && !a.Size?.max) { const el = value(p.type, k).replace(/^(List|Set)\.of\(([\s\S]*?)(, [\s\S]*)?\)$/, '$2'); out.push({ name: `${p.name} 3 items`, valid: true, why: 'many', expr: wrap(p.name, `List.of(${el}, ${el}, ${el})`) }); }
      const num = /^(int|Integer|long|Long|short|Short|BigDecimal|double|Double)$/.test(b);
      const nv = (x) => (b === 'BigDecimal' ? `new BigDecimal("${x}")` : /^(long|Long)$/.test(b) ? `${x}L` : /^(double|Double)$/.test(b) ? `${Number(x).toFixed(1)}` : String(x));
      if (num) {
        if (a.Positive) { out.push({ name: `${p.name} 0`, valid: false, why: tag('Positive'), expr: wrap(p.name, nv(0)) }); }
        if (a.PositiveOrZero) out.push({ name: `${p.name} -1`, valid: false, why: tag('PositiveOrZero'), expr: wrap(p.name, nv(-1)) });
        if (a.Min?.value != null) { out.push({ name: `${p.name} ${a.Min.value}`, valid: true, why: tag('Min'), expr: wrap(p.name, nv(a.Min.value)) }); out.push({ name: `${p.name} ${a.Min.value - 1}`, valid: false, why: tag('Min'), expr: wrap(p.name, nv(a.Min.value - 1)) }); }
        if (a.Max?.value != null) out.push({ name: `${p.name} ${a.Max.value + 1}`, valid: false, why: tag('Max'), expr: wrap(p.name, nv(a.Max.value + 1)) });
        if (a.DecimalMax?.value != null) { const mx = String(a.DecimalMax.value); out.push({ name: `${p.name} ${mx}`, valid: a.DecimalMax.inclusive !== false, why: tag('DecimalMax'), expr: wrap(p.name, nv(mx)) }); const over = (Number(mx) + Math.pow(10, -((mx.split('.')[1] || '').length || 0))).toFixed((mx.split('.')[1] || '').length); out.push({ name: `${p.name} ${over}`, valid: false, why: tag('DecimalMax'), expr: wrap(p.name, nv(over)) }); }
        if (a.DecimalMin?.value != null) { const mn = String(a.DecimalMin.value); const under = (Number(mn) - Math.pow(10, -((mn.split('.')[1] || '').length || 0))).toFixed((mn.split('.')[1] || '').length); out.push({ name: `${p.name} ${under}`, valid: false, why: tag('DecimalMin'), expr: wrap(p.name, nv(under)) }); }
      }
      const pd = isStr && dictForName(p.name, c.name);
      if (pd) {
        // a code shaped like a real one (DE -> ZZ, BOX -> ZZZ), so the field's own constraints still pass
        const real = String(firstRow(pd)[pd.codeCol] ?? 'X');
        const codes = new Set(pd.rows.map(r => String(r[pd.codeCol])));
        const unknown = [real.replace(/[A-Z]/g, 'Z').replace(/[a-z]/g, 'z').replace(/\d/g, '9'), real.replace(/[A-Z]/g, 'Q').replace(/[a-z]/g, 'q').replace(/\d/g, '8')].find(x => !codes.has(x));
        if (unknown) out.push({ name: `${p.name} not in ${pd.table}`, valid: true, why: `no such row in ${pd.table}: validation passes, the service decides`, expr: wrap(p.name, javaStr(unknown)) });
      }
      if (isStr && (a.Pattern?.regexp || a.Pattern?.value)) out.push({ name: `${p.name} not matching`, valid: false, why: tag('Pattern'), expr: wrap(p.name, '"#"') });
      if (isStr && a.Email) out.push({ name: `${p.name} not an email`, valid: false, why: tag('Email'), expr: wrap(p.name, '"not-an-email"') });
      // nested: validated only with @Valid on the component (or its element type)
      if (depth < 2) {
        const nestedValid = a.Valid || p.elemAnnos?.Valid;
        const elT = COLLECTION.test(b) ? generics(p.type)[0] : p.type;
        const nc = nestedValid && resolve(elT, c, readOf);
        if (nc && shapeOf(nc)?.kind !== 'enum') {
          for (const sub of casesFor(nc, depth + 1)) {
            if (sub.name === 'valid') continue;
            const inner = COLLECTION.test(b) ? `List.of(${sub.expr})` : sub.expr;
            out.push({ name: `${p.name}${COLLECTION.test(b) ? '[0]' : ''}.${sub.name}`, valid: sub.valid, why: sub.why, expr: wrap(p.name, inner) });
          }
        }
      }
    }
    return [{ name: 'valid', valid: true, why: 'as generated', expr: `${f}()` }, ...out];
  }
}

// a message with its personal values replaced by synthetic ones of the same kind (the shape stays)
const PERSONAL_KEY = /(e?mail|phone|mobile|fax|first|last|surname|fullname|^name$|street|line\d|address|zip|postal|postcode|city|birth|dob|passport|iban|card|account|ssn|tax|token|password|secret|^ip$|lat|lon|geo)/i;
function masked(v, key = '') {
  if (Array.isArray(v)) return v.map(x => masked(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, masked(x, k)]));
  if (key && PERSONAL_KEY.test(key) && v != null) return typeof v === 'number' ? 1 : /e?mail/i.test(key) ? 'test@example.com' : byName(key);
  return v;
}

// names: a readable value that fits what the field is
function byName(name) {
  const n = String(name).toLowerCase();
  const table = [
    [/country/, 'DE'], [/currency/, 'EUR'], [/(zip|postcode|postal)/, '10115'], [/city|town/, 'Berlin'], [/(line1|street|address)/, 'Main Street 1'], [/line2/, 'Floor 2'],
    [/phone|mobile/, '+4930123456'], [/url|uri|link/, 'https://example.com'], [/^(first)?name$|fullname|firstname/, 'Test Name'], [/lastname|surname/, 'Tester'],
    [/(note|comment|description|reason|message|text)/, 'test'], [/lang|locale/, 'en'], [/iban/, 'DE89370400440532013000'], [/sku/, 'SKU-1'],
    [/(tracking|reference|ref)/, 'REF-1'], [/code$/, 'CODE1'], [/token|secret|password/, 'test-only'], [/status|state/, 'NEW'],
  ];
  for (const [re, v] of table) if (re.test(n)) return v;
  return `${name}-1`;
}

const cap = (x) => x[0].toUpperCase() + x.slice(1);
// the factory of a topic's text message: parcels.scanned -> parcelsScannedMessage
const messageName = (topic) => `${camel(String(topic).replace(/[^\w]+(\w)/g, (a, c) => c.toUpperCase()).replace(/[^\w]/g, ''))}Message`;

// The Java source of TestData for a model; package: the application's
function java(model, { pkg }) {
  const { edges, factories, consts, used, dictionaries } = model;
  const blocks = [];
  const kinds = { body: 'Request body', 'kafka-in': 'Kafka message', 'kafka-out': 'Kafka message the service sends', repository: 'Row read by', 'http-in': 'Answer of' };
  const byFactory = new Map();
  for (const e of edges.filter(x => x.factory)) (byFactory.get(e.factory) || byFactory.set(e.factory, []).get(e.factory)).push(`${kinds[e.kind]} ${e.at}`);
  for (const f of factories.values()) {
    const why = byFactory.get(f.name);
    const dictOf = dictionaries.find(d => d.entity?.id === f.cls.id);
    blocks.push([
      dictOf ? `    // dictionary ${dictOf.table}: an active row${why ? ` (${why.join('; ')})` : ''}` : why ? `    // ${why.join('; ')}${f.fromTopic ? ' (values from the topic\'s schema and last messages)' : ''}` : `    // part of ${[...factories.values()].filter(x => x.code?.includes(`${f.name}()`)).map(x => x.type).join(', ') || 'the above'}`,
      `    public static ${f.type} ${f.name}() {`,
      f.code.split('\n').map(l => `        ${l}`).join('\n'),
      '    }',
    ].join('\n'));
  }
  // dictionaries: an active row, all rows, the active ones, in each Java form the service reads them in.
  // The "// dictionary <table>:" lines tell test_context which factory answers a read of that table.
  for (const d of dictionaries) for (const f of d.forms) {
    const lines = [];
    const how = d.reads.filter(r => r.returns === f.cls.id || base(r.returns) === f.cls.name).map(r => `${r.method} (${r.via})`);
    const head = `${d.table}${how.length ? `, read by ${how.join(', ')}` : ''}`;
    const rowsJava = (rows) => rows.slice(0, 50).map(r => `            ${model.rowExpr(f.cls, r)}`).join(',\n');
    used.imports.add('java.util.List');
    if (!factories.has(f.cls.id) || factories.get(f.cls.id).name !== f.one) lines.push([`    // dictionary ${d.table}: an active row (${head})`, `    public static ${f.type} ${f.one}() {`, `        return ${model.rowExpr(f.cls, model.firstRow(d))};`, '    }'].join('\n'));
    lines.push([`    // dictionary ${d.table}: all rows${d.rows.length > 50 ? ' (the first 50)' : ''}, as the database holds them (${head})`, `    public static List<${f.type}> ${f.all}() {`, `        return List.of(\n${rowsJava(d.rows)});`, '    }'].join('\n'));
    if (f.active) lines.push([`    // dictionary ${d.table}: the active rows (${d.activeCol})`, `    public static List<${f.type}> ${f.active}() {`, `        return List.of(\n${rowsJava(model.activeRows(d))});`, '    }'].join('\n'));
    blocks.push(...lines);
  }
  // cases of the validated bodies
  for (const e of edges.filter(x => x.kind === 'body' && x.valid)) {
    const cs = model.cases(e.cls);
    used.imports.add('java.util.stream.Stream'); used.imports.add('org.junit.jupiter.params.provider.Arguments');
    blocks.push([
      `    // ${e.at} validates the body: each constraint broken (false: 400) and the edges that pass (true)`,
      `    // @ParameterizedTest(name = "{0}") @MethodSource("${pkg ? pkg + '.' : ''}TestData#${e.factory}Cases")`,
      `    public static Stream<Arguments> ${e.factory}Cases() {`,
      '        return Stream.of(',
      cs.map(x => `            Arguments.of("${x.name.replace(/"/g, '\\"')}", ${x.expr}, ${x.valid})${x.why && x.name !== 'valid' ? ` // ${x.why}` : ''}`).join(',\n').replace(/,( \/\/[^\n]*)\n/g, ',$1\n').replace(/( \/\/[^\n]*),\n/g, ',$1\n'),
      '        );',
      '    }',
    ].join('\n'));
  }
  // rows for database tests, as a nested class over the test's JdbcTemplate
  if (model.rows.length && model.jdbc) {
    used.imports.add('org.springframework.jdbc.core.JdbcTemplate');
    used.imports.add('java.util.concurrent.atomic.AtomicLong');
    if (model.rows.some(r => r.cols.some(c => /BigDecimal/.test(c.value)))) used.imports.add('java.math.BigDecimal');
    const methods = [];
    for (const r of model.rows) {
      const sql = `insert into ${r.table} (${r.cols.map(c => c.name).join(', ')}) values (${r.cols.map(c => c.cast).join(', ')})${r.returning ? ` returning ${r.returning}` : ''}`;
      const sqlNoCols = `insert into ${r.table} default values${r.returning ? ` returning ${r.returning}` : ''}`;
      const args = r.cols.map(c => c.value);
      const body = r.returning
        ? `return jdbc.queryForObject(${JSON.stringify(r.cols.length ? sql : sqlNoCols)}, ${r.retType === 'long' ? 'Long' : r.retType}.class${args.length ? ', ' + args.join(', ') : ''});`
        : `jdbc.update(${JSON.stringify(r.cols.length ? sql : sqlNoCols)}${args.length ? ', ' + args.join(', ') : ''});`;
      const ret = r.returning ? r.retType : 'void';
      const doc = `        // ${r.table}${r.why.length ? `: ${r.why.join(', ')}` : ''}`;
      if (r.params.length) {
        methods.push([doc + ', its parents inserted first',
          `        public ${ret} ${r.name}() {`,
          `            ${r.returning ? 'return ' : ''}${r.name}(${r.params.map(p => `${p.parent}()`).join(', ')});`,
          '        }'].join('\n'));
        methods.push([`        public ${ret} ${r.name}(${r.params.map(p => `${p.type} ${p.name}`).join(', ')}) {`, `            ${body}`, '        }'].join('\n'));
      } else methods.push([doc, `        public ${ret} ${r.name}() {`, `            ${body}`, '        }'].join('\n'));
    }
    blocks.push([
      '    // Rows for tests against the database (the DDL snapshot, its dictionaries loaded): every required column',
      '    // has a value, parents are inserted first, unique columns count up (from a new start each run, so tests that',
      '    // commit do not collide). Plain SQL: change it as the schema does.',
      '    //   var rows = new TestData.Rows(jdbc); long customer = rows.customer(); rows.payment(customer);',
      '    public static final class Rows {',
      '        private static final AtomicLong SEQ = new AtomicLong(System.nanoTime() % 1_000_000);',
      '        private final JdbcTemplate jdbc;',
      '',
      '        public Rows(JdbcTemplate jdbc) {',
      '            this.jdbc = jdbc;',
      '        }',
      '',
      methods.join('\n\n'),
      '',
      '        private static long next() {',
      '            return SEQ.incrementAndGet();',
      '        }',
      '    }',
    ].join('\n'));
  }
  const imports = new Set(used.imports);
  const all = blocks.join('\n');
  if (/\bList\.of\(|List</.test(all)) imports.add('java.util.List');
  if (/\bSet\.of\(/.test(all)) imports.add('java.util.Set');
  if (/\bMap\.of\(/.test(all)) imports.add('java.util.Map');
  if (/\bOptional\.of\(/.test(all)) imports.add('java.util.Optional');
  if (/Instant\.parse/.test(all) || [...consts.values()].some(v => /Instant/.test(v.value))) imports.add('java.time.Instant');
  if ([...consts.values()].some(v => v.kind === 'uuid')) imports.add('java.util.UUID');
  const jackson = model.jackson;
  imports.add('java.lang.reflect.Field');
  imports.add('java.lang.reflect.RecordComponent');
  if (jackson) { imports.add('com.fasterxml.jackson.databind.ObjectMapper'); imports.add('com.fasterxml.jackson.databind.SerializationFeature'); }
  const helpers = [
    '    // a copy with one property changed: records through their constructor, other classes on the object itself',
    '    public static <T> T with(T value, String property, Object to) {',
    '        try {',
    '            if (value.getClass().isRecord()) {',
    '                RecordComponent[] cs = value.getClass().getRecordComponents();',
    '                Object[] args = new Object[cs.length];',
    '                Class<?>[] types = new Class<?>[cs.length];',
    '                boolean found = false;',
    '                for (int i = 0; i < cs.length; i++) {',
    '                    types[i] = cs[i].getType();',
    '                    found |= cs[i].getName().equals(property);',
    '                    args[i] = cs[i].getName().equals(property) ? to : cs[i].getAccessor().invoke(value);',
    '                }',
    '                if (!found) throw new IllegalArgumentException(value.getClass().getSimpleName() + " has no " + property);',
    '                var ctor = value.getClass().getDeclaredConstructor(types);',
    '                ctor.setAccessible(true);',
    '                @SuppressWarnings("unchecked") T copy = (T) ctor.newInstance(args);',
    '                return copy;',
    '            }',
    '            set(value, property, to);',
    '            return value;',
    '        } catch (ReflectiveOperationException e) {',
    '            throw new IllegalStateException(e);',
    '        }',
    '    }',
    '',
    '    // a field set as the database or the framework would (no setter needed)',
    '    public static void set(Object target, String field, Object value) {',
    '        for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {',
    '            try {',
    '                Field f = c.getDeclaredField(field);',
    '                f.setAccessible(true);',
    '                f.set(target, value);',
    '                return;',
    '            } catch (NoSuchFieldException e) {',
    '                // the superclass may have it',
    '            } catch (IllegalAccessException e) {',
    '                throw new IllegalStateException(e);',
    '            }',
    '        }',
    '        throw new IllegalArgumentException(target.getClass().getSimpleName() + " has no field " + field);',
    '    }',
  ];
  if (used.helpers.has('instance')) helpers.push(
    '',
    '    // an object through its non-public no-argument constructor (entities: protected for JPA)',
    '    static <T> T instance(Class<T> type) {',
    '        try {',
    '            var ctor = type.getDeclaredConstructor();',
    '            ctor.setAccessible(true);',
    '            return ctor.newInstance();',
    '        } catch (ReflectiveOperationException e) {',
    '            throw new IllegalStateException(e);',
    '        }',
    '    }',
  );
  if (used.helpers.has('dictionaryRow')) helpers.push(
    '',
    '    private static <T> T dictionaryRow(Class<T> type, Consumer<T> fill) {',
    '        T x = instance(type);',
    '        fill.accept(x);',
    '        return x;',
    '    }',
  );
  if (jackson) helpers.push(
    '',
    '    // JSON as the endpoint and the listeners read it (dates as ISO text)',
    '    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);',
    '',
    '    public static String json(Object value) {',
    '        try {',
    '            return JSON.writeValueAsString(value);',
    '        } catch (Exception e) {',
    '            throw new IllegalStateException(e);',
    '        }',
    '    }',
  );
  const idLines = [...consts.entries()].map(([k, v]) => `    public static final ${v.kind === 'uuid' ? 'UUID' : 'long'} ${k}_ID = ${v.value};`);
  const textEdges = edges.filter(e => e.kind === 'kafka-in' && e.text).map(e => {
    const n = messageName(e.topic);
    const v = e.json ? `json(${e.factory}())` : e.value || '"test"';
    const why = e.json ? `JSON the listener reads into ${e.cls.name}` : e.value && /^"\{/.test(e.value) ? 'the last message on the topic, personal values replaced' : e.value ? 'the code parses it' : 'plain text';
    return `    // Kafka message ${e.at}: ${why}\n    public static String ${n}() {\n        return ${v};\n    }`;
  });
  const own = (i) => pkg && i.startsWith(`${pkg}.`) && !i.slice(pkg.length + 1).includes('.');
  return [
    pkg ? `package ${pkg};\n` : '',
    [...imports].filter(i => !own(i) && !/^java\.lang\.[A-Z]\w*$/.test(i)).sort().map(i => `import ${i};`).join('\n'),
    '',
    '// Valid data for what enters and leaves the service, generated by dt (test_data) from its code and',
    '// database: built through each type\'s constructor; values from Bean Validation, the columns the names',
    '// map to (length, scale, CHECKs, dictionary rows), how the code parses them. The ids of one concept are',
    '// one constant, so a body, an event and a row agree. Plain Java, yours to change: once edited, dt no',
    '// longer overwrites it (test_data then shows what it would generate instead).',
    '// dt-generated: HASH',
    'public final class TestData {',
    ...(idLines.length ? [...idLines, ''] : []),
    '    private TestData() {}',
    '',
    [...blocks, ...textEdges].join('\n\n'),
    '',
    helpers.join('\n'),
    '}',
    '',
  ].join('\n');
}

// a value of a database row as a Java argument for JDBC
const sqlLit = (type, v) => {
  if (/^(bigint)$/.test(type)) return `${v}L`;
  if (/^(integer|smallint|int\d?)$/.test(type)) return String(v);
  if (/^bool/.test(type)) return String(v === true || v === 't');
  if (/^(numeric|decimal)/.test(type)) return `new BigDecimal("${v}")`;
  return javaStr(v);
};

const lit2 = (b, v, used) => {
  if (/^(long|Long)$/.test(b)) return `${v}L`;
  if (/^(int|Integer|short|Short)$/.test(b)) return String(v);
  if (/^(double|Double)$/.test(b)) return String(Number(v));
  if (b === 'BigDecimal') { used.imports.add('java.math.BigDecimal'); return `new BigDecimal("${v}")`; }
  if (/^(boolean|Boolean)$/.test(b)) return String(v === true || v === 't' || v === 'true');
  return javaStr(v);
};

// Build TestData for the module of the application (or of file), write it, compile-check it
async function generate(id, { env, db, write = true, module: modDir } = {}) {
  const model = build(id, { env, db });
  const g = model.g;
  const app = g.classes.find(c => c.role === 'application' && !c.test && (!modDir || c.file.startsWith(`${modDir}/`))) || g.classes.find(c => !c.test);
  if (!app) throw new Error(`no Java classes in workspace ${id}`);
  const pkg = app.id.slice(0, app.id.length - app.name.length - 1);
  const T = require('./testgen');
  const mod = T.moduleOf(model.root, app.file);
  const s = T.setup(model.root, mod, g.app);
  const buildText = mod.text + (model.read('pom.xml') || '') + (model.read('build.gradle') || '') + (model.read('build.gradle.kts') || '');
  model.jackson = /spring-boot-starter-(web|json|webflux)|jackson-databind/.test(buildText);
  model.jdbc = /spring-boot-starter-(jdbc|data-jpa)|spring-jdbc/.test(buildText);
  const text = stamp(java(model, { pkg }));
  const rel = app.file.replace(/(^|\/)src\/main\/(java|kotlin)\/.*$/, '$1src/test/java/') + (pkg ? `${pkg.replace(/\./g, '/')}/` : '') + 'TestData.java';
  // a TestData someone changed is theirs: written only when absent or exactly what dt wrote last time
  let existing = null;
  try { existing = fs.readFileSync(path.join(model.root, rel), 'utf8'); } catch {}
  const kept = existing != null && !untouched(existing) && existing !== text;
  let compile = null;
  if (write && !kept) {
    W.write(id, rel, { content: text });
    compile = await require('./javacheck').check(id, [rel]).catch(e => ({ skipped: e.message }));
  }
  return {
    workspace: id, path: rel, class: `${pkg ? pkg + '.' : ''}TestData`, written: write && !kept,
    ...(kept ? { kept: `${rel} was changed by hand (or not written by dt): left as it is; source has what dt would generate now, to take parts of it` } : {}),
    edges: model.edges.map(e => ({ kind: e.kind, at: e.at, ...(e.hints ? { topic: [e.hints.schema && `schema ${e.hints.schema}`, e.hints.samples && `${e.hints.samples} last messages`].filter(Boolean).join(', ') || 'synced, empty' } : {}), ...(e.differs ? { differs: e.differs } : {}), ...(e.type ? { type: e.type } : {}), ...(e.factory ? { use: `TestData.${e.factory}()` } : {}), ...(e.param ? { param: e.param } : {}), ...(e.text ? { message: `TestData.${messageName(e.topic)}()` } : {}), ...(e.value ? { value: e.value } : {}), ...(e.valid ? { cases: `TestData#${e.factory}Cases` } : e.kind === 'body' ? { validated: false } : {}) })),
    ids: Object.fromEntries([...model.consts].map(([k, v]) => [`${k}_ID`, v.value])),
    dictionaries: model.dictionaries.map(d => ({
      table: d.table, rows: d.rows.length,
      java: [d.enum && `enum ${d.enum.id}`, d.entity && `entity ${d.entity.id}`, ...d.models.map(c => `model ${c.id}${c.lib ? ` (${c.lib})` : ''}`)].filter(Boolean),
      ...(d.reads.length ? { reads: d.reads.map(r => `${r.method} (${r.via}${r.active ? ', active only' : ''})`) } : {}),
      ...(d.forms.length ? { use: d.forms.map(f => `TestData.${f.one}(), TestData.${f.all}()${f.active ? `, TestData.${f.active}()` : ''}`) } : {}),
      ...(d.usedBy ? { valuesFor: [...new Set(d.usedBy)] } : {}),
      ...(d.enumCheck ? { enumDiffers: d.enumCheck } : {}),
    })),
    rows: model.jdbc ? model.rows.map(r => ({ table: r.table, use: `new TestData.Rows(jdbc).${r.name}(${r.params.map(p => p.name).join(', ')})`, ...(r.why.length ? { why: r.why } : {}) })) : undefined,
    database: model.cat ? model.cat.db : (env ? `no synced database in ${env} has the entity tables` : 'pass env to take lengths, CHECKs and dictionary rows from the database'),
    setup: { springBoot: s.springBoot, jackson: model.jackson },
    compile: compile || undefined,
    source: write && !kept ? undefined : text,
    usage: [
      'given: when(repo.findById(SHIPMENT_ID)).thenReturn(Optional.of(TestData.shipment()))',
      'a variant: TestData.with(TestData.createShipment(), "level", ServiceLevel.EXPRESS)',
      'a body: mvc.perform(post(...).contentType(APPLICATION_JSON).content(TestData.json(TestData.createShipment())))',
      'validation: @ParameterizedTest(name = "{0}") @MethodSource("<pkg>.TestData#<body>Cases") void rejects(String name, Body body, boolean valid)',
    ],
  };
}
// The hash in the "dt-generated:" line is of the rest of the file: equal means nobody changed it since
const crypto = require('crypto');
const bodyHash = (text) => crypto.createHash('sha256').update(text.replace(/^\/\/ dt-generated: \S+\n/m, '')).digest('hex').slice(0, 16);
const stamp = (text) => text.replace('// dt-generated: HASH', `// dt-generated: ${bodyHash(text)}`);
const untouched = (text) => { const m = text.match(/^\/\/ dt-generated: (\S+)$/m); return !!m && m[1] === bodyHash(text); };


module.exports = { generate, untouched, build, java, shape, declaration, annotations, sample, checksOf, parsedNames, noComments, splitTop };
