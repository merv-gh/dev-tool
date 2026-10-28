// Symbols and dependencies of a Java/Kotlin source tree, for impact radius and test generation.
// Regex/brace level like the passport (no compiler): classes, fields, constructors, methods with line
// ranges; calls typed through fields, parameters and locals; Spring roles; plus the passport's findings
// (tables, SQL, topics, endpoints, Feign calls, ES indices) attached to the method they are in.
//
// Edges mean "from uses to"; impact(x) walks them backwards (who is affected when x changes):
//   C#m -> D#n calls        C -> D extends/implements/injects/uses     C#m -> C member
//   I#m -> Impl#m dispatch (an interface call reaches the implementations)
//   C#m -> table:s.t read|write|...   Entity -> table:s.t entity   Entity.field -> column:s.t.c
//   Repo -> Entity repository         C#m -> pgfn:s.f calls        C#m -> es:index
//   C#m -> topic:t consumes           topic:t -> C#m produced-by (consumers depend on what producers send)
//   endpoint:GET /p/{} -> C#m handler  Client#m -> endpoint:POST /p calls-http (Feign, across services)
// Node ids: classes by FQN, methods "fqn#name", fields "fqn.name", data nodes "<kind>:<name>".
const path = require('path');
const X = require('./passport/extract');

const KEYWORDS = new Set('if for while switch catch return synchronized new super this assert throw try else do case default when in is as fun val var it typeof sizeof yield await'.split(' '));
const STEREO = { RestController: 'controller', Controller: 'controller', Service: 'service', Repository: 'repository', Component: 'component', Configuration: 'configuration', Entity: 'entity', FeignClient: 'feign', KafkaListener: 'listener', Document: 'document', Embeddable: 'embeddable', MappedSuperclass: 'entity', ControllerAdvice: 'controller-advice', RestControllerAdvice: 'controller-advice', SpringBootApplication: 'application', ConfigurationProperties: 'properties' };
const INJECT = new Set(['Autowired', 'Inject', 'Resource', 'Value']);
const LOMBOK_CTOR = new Set(['RequiredArgsConstructor', 'AllArgsConstructor']);
const BEAN = new Set(['controller', 'service', 'repository', 'component', 'configuration', 'listener', 'controller-advice', 'application', 'feign']);

// Blank string and char literal contents (positions and newlines kept) so braces in strings don't count.
function blankStrings(t) {
  const parts = [];
  let i = 0, from = 0;
  const blank = (a, b) => t.slice(a, b).replace(/[^\n]/g, ' ');
  while (i < t.length) {
    const c = t[i];
    if (c === '"' && t.startsWith('"""', i)) {
      const e = t.indexOf('"""', i + 3); const end = e < 0 ? t.length : e;
      parts.push(t.slice(from, i + 3), blank(i + 3, end)); i = from = end;
      if (e >= 0) { parts.push('"""'); i = from = e + 3; }
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < t.length && t[j] !== c && t[j] !== '\n') { if (t[j] === '\\') j++; j++; }
      j = Math.min(j, t.length);
      parts.push(t.slice(from, i + 1), blank(i + 1, j)); i = from = j;
      if (t[j] === c) i++, parts.push(c), from = i;
      continue;
    }
    i++;
  }
  parts.push(t.slice(from));
  return parts.join('');
}

function lineIndex(s) {
  const nl = [];
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) nl.push(i);
  return (idx) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < idx) lo = m + 1; else hi = m; } return lo + 1; };
}

function closeBrace(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return i; }
  return s.length - 1;
}

function closeParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) return i; }
  return s.length - 1;
}

// "@A @B(x = 1) public final" -> { annos: ['A', 'B'], rest: 'public final' }
function stripAnnotations(h) {
  const annos = [];
  let out = '', i = 0;
  while (i < h.length) {
    if (h[i] === '@' && /[A-Za-z]/.test(h[i + 1] || '')) {
      const m = h.slice(i).match(/^@([\w.]+)/);
      annos.push(m[1].split('.').pop());
      i += m[0].length;
      const p = h.slice(i).match(/^\s*\(/);
      if (p) i = closeParen(h, i + p[0].length - 1) + 1;
      continue;
    }
    out += h[i++];
  }
  return { annos, rest: out };
}

// Split on top-level commas, also outside <...> (Map<String, Long> a, int b)
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s || '') {
    if ('(<[{'.includes(c)) d++;
    else if (')>]}'.includes(c)) d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim());
}

// "List<Order> a, @Valid final Foo b" (Java) or "a: Int, private val b: Foo = x" (Kotlin)
function params(text, kt) {
  return splitTop((text || '').replace(/->/g, '  ')).map(p => {
    const r = stripAnnotations(p).rest.replace(/\b(final|private|protected|public|internal|override|val|var|vararg)\b/g, ' ').trim();
    if (!r) return null;
    if (kt) { const m = r.match(/^([\w$]+)\s*:\s*([^=]+?)\s*(=.*)?$/s); return m ? { name: m[1], type: m[2].trim() } : null; }
    const m = r.match(/^([\s\S]+?)\s*(?:\.\.\.)?\s+([\w$]+)$/);
    return m ? { name: m[2], type: m[1].replace(/\s+/g, ' ').trim() } : null;
  }).filter(Boolean);
}

const baseType = (t) => String(t || '').replace(/<[\s\S]*$/, '').replace(/\[\]|\?|\.\.\./g, '').trim();
const typeArgs = (t) => { const m = String(t || '').match(/<([\s\S]*)>/); return m ? splitTop(m[1]).map(x => baseType(x.replace(/^\?\s*(extends|super)\s+/, ''))) : []; };

// Kotlin: a statement ends at a newline unless the line clearly continues
const ktComplete = (h) => { const t = h.trim(); return t && !/[,(=.:+\-*/&|?]$|->$/.test(t) && !/^(@[\w.]+(\([^)]*\))?\s*)+$/.test(t); };

// Members of a class body (s from..to, exclusive of the braces)
function segments(s, from, to, kt) {
  const out = [];
  let depth = 0, paren = 0, seg = from, open = -1;
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{') { if (depth === 0 && paren === 0) open = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && open >= 0 && paren === 0) {
        out.push({ header: s.slice(seg, open), start: seg, open, close: i });
        seg = i + 1; open = -1;
        // "= { ... };" style initializer: the ';' after it closes nothing new
        const after = s.slice(i + 1).match(/^\s*;/);
        if (after) { i += after[0].length; seg = i + 1; }
      }
    } else if (depth === 0 && paren === 0 && (c === ';' || (kt && c === '\n'))) {
      const h = s.slice(seg, i);
      if (c === ';' || ktComplete(h)) { if (h.trim()) out.push({ header: h, start: seg, open: -1, close: i }); seg = i + 1; }
    }
  }
  if (s.slice(seg, to).trim()) out.push({ header: s.slice(seg, to), start: seg, open: -1, close: to });
  return out;
}

const TYPE_RE = /(?<![\w$.@])(class|interface|enum|record|object|@interface)\s+([A-Za-z_$][\w$]*)/g;

function parseFile(rel, text) {
  const kt = /\.kts?$/.test(rel);
  const clean = X.stripComments(text);
  const s = blankStrings(clean);
  const lineOf = lineIndex(s);
  const pkg = (s.match(/^\s*package\s+([\w.]+)/m) || [])[1] || '';
  const imports = {}, wild = [];
  for (const m of s.matchAll(/^\s*import\s+(static\s+)?([\w.]+?)(\.\*)?(?:\s+as\s+(\w+))?\s*;?\s*$/gm)) {
    if (m[3]) { if (!m[1]) wild.push(m[2]); continue; }
    imports[m[4] || m[2].split('.').pop()] = m[1] ? m[2].split('.').slice(0, -1).join('.') : m[2];
  }
  const test = /(^|\/)src\/(test|it|integrationTest|testFixtures)\//.test(rel);
  const types = [];
  for (const m of s.matchAll(TYPE_RE)) {
    if (m[2] === 'object' || (m[1] === 'object' && /companion\s*$/.test(s.slice(Math.max(0, m.index - 12), m.index)))) continue;
    // header: back to the previous ; { } (annotations and modifiers)
    let h = m.index;
    while (h > 0 && !';{}'.includes(s[h - 1])) h--;
    const { annos, rest } = stripAnnotations(s.slice(h, m.index));
    let j = m.index + m[0].length;
    const g = s.slice(j).match(/^\s*</);
    if (g) { let d = 0; for (j += g[0].length - 1; j < s.length; j++) { if (s[j] === '<') d++; else if (s[j] === '>' && --d === 0) { j++; break; } } }
    let ctor = null;
    const p = s.slice(j).match(/^\s*(?:(?:private|protected|internal|public)\s+)?(?:constructor\s*)?(?:@\w+\s*)*\(/);
    if (p) { const close = closeParen(s, j + p[0].length - 1); ctor = params(clean.slice(j + p[0].length, close), kt); j = close + 1; }
    let k = j, supers = '';
    for (; k < s.length; k++) {
      if (s[k] === '{' || s[k] === ';') break;
      if (kt && s[k] === '\n' && ktComplete(supers) && !/^\s*[:,{]/.test(s.slice(k + 1, k + 40)) && supers.trim()) break;
      if (s[k] === '(') { const c = closeParen(s, k); supers += s.slice(k, c + 1).replace(/[^\n]/g, ' '); k = c; continue; }
      supers += s[k];
    }
    const hasBody = s[k] === '{';
    const bodyEnd = hasBody ? closeBrace(s, k) : k;
    const ext = [], impl = [];
    if (kt) {
      for (const part of splitTop(supers.replace(/^\s*:/, ''))) { const n = baseType(part.replace(/\(.*$/, '').replace(/\bby\b[\s\S]*$/, '')); if (/^[A-Z][\w.]*$/.test(n)) (/\(/.test(part) ? ext : impl).push(n); }
    } else {
      const em = supers.match(/\bextends\s+([\s\S]+?)(?=\bimplements\b|$)/);
      const im = supers.match(/\bimplements\s+([\s\S]+)$/);
      if (em) for (const part of splitTop(em[1])) ext.push(baseType(part));
      if (im) for (const part of splitTop(im[1])) impl.push(baseType(part));
      // generic arguments of supertypes are uses (JpaRepository<Order, Long> -> Order)
    }
    const superArgs = [...supers.matchAll(/<([^{]*)>/g)].flatMap(x => splitTop(x[1]).map(baseType)).filter(x => /^[A-Z]/.test(x));
    types.push({
      name: m[2], kind: m[1] === '@interface' ? 'annotation' : m[1], annos, mods: rest.trim().split(/\s+/).filter(Boolean), start: h, nameAt: m.index,
      line: lineOf(m.index), endLine: lineOf(bodyEnd), body: hasBody ? [k, bodyEnd] : null, ctor, ext, impl, superArgs,
    });
  }
  // nesting: the innermost type that contains each one
  for (const t of types) {
    const outer = types.filter(o => o !== t && o.body && o.body[0] < t.nameAt && t.nameAt < o.body[1]).sort((a, b) => b.body[0] - a.body[0])[0];
    t.outer = outer || null;
  }
  const fqn = (t) => (t.outer ? `${fqn(t.outer)}.${t.name}` : pkg ? `${pkg}.${t.name}` : t.name);

  const classes = [];
  for (const t of types) {
    const c = {
      id: fqn(t), name: t.name, pkg, file: rel, line: t.line, endLine: t.endLine, kind: t.kind, annos: t.annos, mods: t.mods,
      role: t.annos.map(a => STEREO[a]).find(Boolean) || (test ? 'test' : null), test, ext: t.ext, impl: t.impl, superArgs: t.superArgs,
      fields: [], ctorParams: [], methods: [], uses: new Set(),
    };
    if (/Repository$/.test(t.name) && t.kind === 'interface' && t.ext.some(e => /Repository$|CrudRepository|JpaRepository/.test(e))) c.role = 'repository';
    if (t.ctor) {
      if (kt || t.kind === 'record') for (const p of t.ctor) c.fields.push({ name: p.name, type: p.type, annos: [], final: true, line: t.line });
      c.ctorParams.push(...t.ctor);
    }
    if (t.body) {
      for (const seg of segments(s, t.body[0] + 1, t.body[1], kt)) member(c, seg, s, clean, lineOf, kt, t.name);
    }
    const lombokCtor = t.annos.some(a => LOMBOK_CTOR.has(a));
    const bean = BEAN.has(c.role) || t.annos.some(a => /^(Service|Component|Repository|Controller|RestController|Configuration)$/.test(a));
    for (const f of c.fields) {
      if (f.annos.some(a => INJECT.has(a)) || (bean && ((lombokCtor && f.final && !f.static) || c.ctorParams.some(p => p.name === f.name && baseType(p.type) === baseType(f.type))))) f.inject = true;
    }
    c.bean = bean;
    c.lombok = t.annos.filter(a => /^(Data|Getter|Setter|Builder|Value|RequiredArgsConstructor|AllArgsConstructor|NoArgsConstructor|Slf4j)$/.test(a));
    classes.push(c);
  }
  return { file: rel, pkg, imports, wild, kt, test, classes, text: s, clean };
}

function member(c, seg, s, clean, lineOf, kt, className) {
  const { annos, rest } = stripAnnotations(seg.header);
  const h = rest.trim();
  if (!h || /(?<![\w$.@])(class|interface|enum|record|object)\s+[A-Za-z_$]/.test(h) || /^(companion\s+object|init|static)$/.test(h)) return;
  const words = h.split(/\s+/);
  const mods = words.filter(w => /^(public|protected|private|internal|static|final|abstract|default|synchronized|override|open|suspend|transient|volatile|native|lateinit|const)$/.test(w));
  let m;
  const block = seg.open >= 0;
  if (kt && (m = h.match(/\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([\w$]+)\s*\(/))) {
    const po = seg.start + seg.header.indexOf('(', seg.header.indexOf(m[0]) + m[0].length - 1);
    const pc = closeParen(s, po);
    const ret = (s.slice(pc + 1, block ? seg.open : seg.close).match(/^\s*:\s*([^={]+)/) || [])[1];
    const at = seg.start + seg.header.indexOf(m[1], seg.header.indexOf('fun'));
    c.methods.push(method(m[1], params(clean.slice(po + 1, pc), true), ret ? ret.trim() : 'Unit', annos, mods, seg, lineOf, at, block ? [seg.open, seg.close] : [pc, seg.close]));
    return;
  }
  if (kt && (m = h.match(/\b(val|var)\s+([\w$]+)\s*(?::\s*([^=]+?))?\s*(?:=\s*([\s\S]*))?$/))) {
    let type = m[3] && m[3].trim();
    if (!type && m[4]) { const call = m[4].match(/^([A-Z][\w$.]*)\s*[(<]/); if (call) type = call[1]; }
    c.fields.push({ name: m[2], type: type || '?', annos, final: m[1] === 'val', static: false, line: lineOf(seg.start + seg.header.indexOf(m[2])), lateinit: mods.includes('lateinit') });
    return;
  }
  if (!kt) {
    // method or constructor: "... name(params) [throws ...]" followed by a body, or abstract with ';'
    const eq = h.indexOf('=');
    m = h.match(/(?:^|[\s>\]])([\w$]+)\s*\(([\s\S]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*(?:default\s+[\s\S]*)?$/);
    if (m && (eq < 0 || eq > h.indexOf(m[1] + '(')) && !/\bnew\s*$/.test(h.slice(0, h.lastIndexOf(m[1], h.indexOf('('))))) {
      const name = m[1];
      if (KEYWORDS.has(name)) return;
      const before = h.slice(0, h.indexOf(name + (h[h.indexOf(name) + name.length] === '(' ? '(' : ''))).trim();
      let ret = before;
      for (let changed = true; changed;) { const r2 = ret.replace(/^\s*(public|protected|private|static|final|abstract|default|synchronized|native|strictfp)\b/, '').replace(/^\s*<[^()]*?>(?=\s)/, ''); changed = r2 !== ret; ret = r2; }
      ret = ret.trim();
      const pIdx = seg.start + seg.header.indexOf('(', seg.header.indexOf(name));
      const pc = closeParen(s, pIdx);
      const ps = params(clean.slice(pIdx + 1, pc), false);
      const at = seg.start + seg.header.indexOf(name);
      if (name === className && (!ret || ret === className || mods.includes(ret))) { c.ctorParams.push(...ps); c.methods.push({ ...method('<init>', ps, '', annos, mods, seg, lineOf, at, block ? [seg.open, seg.close] : null), ctor: true }); return; }
      c.methods.push(method(name, ps, ret, annos, mods, seg, lineOf, at, block ? [seg.open, seg.close] : null));
      return;
    }
    m = h.match(/^((?:(?:public|protected|private|static|final|transient|volatile)\s+)*)([\w$.]+(?:\s*<[\s\S]*>)?(?:\s*\[\])*)\s+([\w$]+)\s*(=[\s\S]*)?$/);
    if (m && !KEYWORDS.has(m[3]) && !/^(return|throw|package|import)$/.test(m[2])) {
      c.fields.push({ name: m[3], type: m[2].replace(/\s+/g, ''), annos, final: /\bfinal\b/.test(m[1]), static: /\bstatic\b/.test(m[1]), line: lineOf(seg.start + seg.header.lastIndexOf(m[3])) });
    }
  }
}

function method(name, ps, ret, annos, mods, seg, lineOf, at, body) {
  return { name, params: ps, ret: (ret || '').trim(), annos, mods, line: lineOf(at), startLine: lineOf(seg.start + seg.header.search(/\S/)), endLine: lineOf(seg.close), body };
}

// ── linking ──────────────────────────────────────────────────────────────
function build(root, texts, meta = {}, extracted = null) {
  const files = [];
  for (const [rel, text] of texts) { try { files.push(parseFile(rel, text)); } catch (e) { files.push({ file: rel, error: e.message, classes: [] }); } }
  const byId = new Map(), bySimple = new Map();
  for (const f of files) for (const c of f.classes) {
    byId.set(c.id, c);
    (bySimple.get(c.name) || bySimple.set(c.name, []).get(c.name)).push(c.id);
  }
  const edges = [];
  const edge = (from, to, kind, where) => edges.push([from, to, kind, where || '']);

  for (const f of files) {
    const local = new Map(f.classes.map(c => [c.name, c.id]));
    const resolveType = (name) => {
      const n = baseType(name);
      if (!n || !/^[A-Z_$]/.test(n.split('.').pop())) return null;
      if (n.includes('.')) {
        if (byId.has(n)) return n;
        const [head, ...tail] = n.split('.');
        const h = resolveType(head);
        if (h && byId.has(`${h}.${tail.join('.')}`)) return `${h}.${tail.join('.')}`;
        return /^[a-z]/.test(n) ? `ext:${n}` : null;
      }
      if (local.has(n)) return local.get(n);
      if (f.imports[n]) return byId.has(f.imports[n]) ? f.imports[n] : `ext:${f.imports[n]}`;
      if (f.pkg && byId.has(`${f.pkg}.${n}`)) return `${f.pkg}.${n}`;
      for (const w of f.wild) if (byId.has(`${w}.${n}`)) return `${w}.${n}`;
      const all = bySimple.get(n);
      if (all && all.length === 1) return all[0];
      return null;
    };
    f.resolveType = resolveType;
    for (const c of f.classes) {
      const where = `${f.file}:${c.line}`;
      for (const e of c.ext) { const id = resolveType(e); if (id) { edge(c.id, id, 'extends', where); c.extIds = [...(c.extIds || []), id]; } }
      for (const e of c.impl) { const id = resolveType(e); if (id) { edge(c.id, id, 'implements', where); c.implIds = [...(c.implIds || []), id]; } }
      for (const a of c.superArgs) { const id = resolveType(a); if (id && byId.has(id)) edge(c.id, id, c.role === 'repository' ? 'repository' : 'uses', where); }
      for (const fl of c.fields) {
        fl.typeId = resolveType(fl.type);
        for (const t of [fl.typeId, ...typeArgs(fl.type).map(resolveType)]) if (t) edge(c.id, t, fl.inject ? 'injects' : 'uses', `${f.file}:${fl.line}`);
      }
      for (const p of c.ctorParams) { p.typeId = resolveType(p.type); if (p.typeId) edge(c.id, p.typeId, c.bean ? 'injects' : 'uses', where); }
      for (const m of c.methods) {
        m.id = `${c.id}#${m.name}`;
        edge(m.id, c.id, 'member', `${f.file}:${m.line}`);
        for (const p of m.params) { p.typeId = resolveType(p.type); for (const t of [p.typeId, ...typeArgs(p.type).map(resolveType)]) if (t) edge(m.id, t, 'uses', `${f.file}:${m.line}`); }
        const r = resolveType(m.ret); if (r) edge(m.id, r, 'uses', `${f.file}:${m.line}`);
        if (m.body) calls(f, c, m, byId, resolveType, edge);
      }
    }
  }

  // interface/superclass methods reach their implementations
  for (const c of byId.values()) {
    for (const sup of [...(c.implIds || []), ...(c.extIds || [])]) {
      const sc = byId.get(sup);
      if (!sc) continue;
      for (const m of c.methods) if (sc.methods.some(x => x.name === m.name)) edge(`${sup}#${m.name}`, m.id, 'dispatch', `${c.file}:${m.line}`);
    }
  }

  // calls to inherited / generated methods (repo.save, repo.findById): members of that class too
  const declared = new Set(edges.filter(e => e[2] === 'member').map(e => e[0]));
  for (const e of [...edges]) if (e[2] === 'calls' && !declared.has(e[1])) { const cls = e[1].split('#')[0]; if (byId.has(cls)) { declared.add(e[1]); edge(e[1], cls, 'member', 'inherited'); } }

  // entity fields -> columns; getters/setters -> fields (lombok or written)
  const entityTable = new Map();
  for (const f of files) for (const c of f.classes) {
    if (!c.annos.includes('Entity') && !c.annos.includes('MappedSuperclass') && !c.annos.includes('Embeddable')) continue;
    const ann = annoArgsOf(f.clean, c.line, 'Table');
    const table = ((ann.schema ? `${ann.schema}.` : '') + (ann.name || snake(c.name))).toLowerCase();
    if (c.annos.includes('Entity')) { entityTable.set(c.id, table); edge(c.id, `table:${table}`, 'entity', `${f.file}:${c.line}`); }
    c.table = table;
    for (const fl of c.fields) {
      if (fl.static || fl.annos.includes('Transient')) continue;
      const col = annoArgsOf(f.clean, fl.line, 'Column', 'JoinColumn').name || snake(fl.name) + (fl.annos.some(a => /^(ManyToOne|OneToOne)$/.test(a)) ? '_id' : '');
      if (fl.annos.some(a => /^(OneToMany|ManyToMany)$/.test(a))) continue;
      fl.column = col.toLowerCase();
      edge(`${c.id}.${fl.name}`, `column:${table}.${fl.column}`, 'column', `${f.file}:${fl.line}`);
    }
  }

  // the passport's findings, attached to the enclosing method (or class)
  let passport = null;
  try { passport = extracted || X.extract(root); } catch (e) { passport = { error: e.message }; }
  const enclosing = memberAt(files);
  const at = (x) => (x.file && x.file !== 'config' ? enclosing(x.file, x.line) : null);
  const norm = (p) => String(p || '').replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';
  if (passport && !passport.error) {
    for (const e of passport.endpoints || []) { const m = at(e); if (m) edge(`endpoint:${e.method} ${norm(e.path)}`, m, 'handler', `${e.file}:${e.line}`); }
    for (const e of passport.feign || []) { const m = at(e); if (m) edge(m, `endpoint:${e.method} ${norm(e.path)}`, 'calls-http', `${e.file}:${e.line}`); }
    for (const k of passport.kafka?.consumes || []) { const m = at(k); if (m && !/^\?/.test(k.topic)) edge(m, `topic:${k.topic}`, 'consumes', `${k.file}:${k.line}`); }
    for (const k of passport.kafka?.produces || []) { const m = at(k); if (m && !/^\?|^\(/.test(k.topic)) edge(`topic:${k.topic}`, m, 'produced-by', `${k.file}:${k.line}`); }
    for (const t of passport.db?.tables || []) {
      if (!t.table || t.access === 'entity' || t.access === 'repository') continue;
      const m = at(t);
      if (t.access === 'function') { if (m) edge(m, `pgfn:${t.table}`, 'calls', `${t.file}:${t.line}`); continue; }
      edge(m || `file:${t.file}`, `table:${t.table}`, t.access, `${t.file}:${t.line}`);
    }
    for (const c of passport.db?.calls || []) { const m = at(c); if (m) edge(m, `pgfn:${c.name}`, 'calls', `${c.file}:${c.line}`); }
    for (const e of passport.es || []) { const m = at(e); if (m && !/^\?/.test(e.index)) edge(m, `es:${e.index}`, 'es', `${e.file}:${e.line}`); }
  }

  // SQL text per method: columns are matched at query time against the synced catalog
  const sql = [];
  for (const f of files) for (const c of f.classes) for (const m of c.methods) {
    if (!m.body) continue;
    for (const lit of X.stringLiterals(f.clean.slice(m.body[0], m.body[1] + 1))) {
      if (/\b(select|insert|update|delete|merge|call)\b/i.test(lit.value) && lit.value.length > 12) sql.push({ m: m.id, sql: lit.value.slice(0, 2000), tables: X.sqlRefs(lit.value).map(r => r.table.toLowerCase()) });
    }
  }

  const classes = [];
  for (const f of files) for (const c of f.classes) {
    classes.push({
      id: c.id, name: c.name, file: c.file, line: c.line, endLine: c.endLine, kind: c.kind, role: c.role, bean: !!c.bean, test: c.test, annos: c.annos, lombok: c.lombok, table: c.table,
      ext: c.extIds || [], impl: c.implIds || [],
      fields: c.fields.map(x => ({ name: x.name, type: x.type, typeId: x.typeId || null, annos: x.annos, inject: !!x.inject, final: !!x.final, static: !!x.static, line: x.line, column: x.column })),
      ctor: c.ctorParams.map(p => ({ name: p.name, type: p.type, typeId: p.typeId || null })),
      methods: c.methods.map(m => ({ name: m.name, params: m.params.map(p => ({ name: p.name, type: p.type, typeId: p.typeId || null })), ret: m.ret, annos: m.annos, mods: m.mods, line: m.line, startLine: m.startLine, endLine: m.endLine, ctor: !!m.ctor, abstract: !m.body })),
    });
  }
  return {
    ...meta, builtAt: new Date().toISOString(),
    classes, edges: dedupe(edges), sql,
    app: passport && !passport.error ? { ...passport.app, dependencies: passport.dependencies } : null,
    errors: files.filter(f => f.error).map(f => ({ file: f.file, error: f.error })),
  };
}

function calls(f, c, m, byId, resolveType, edge) {
  const body = f.text.slice(m.body[0], m.body[1] + 1);
  const where = `${f.file}:${m.line}`;
  // receiver types: fields (this class and outer ones), parameters, locals
  const vars = new Map();
  for (const fl of c.fields) vars.set(fl.name, fl.type);
  for (const p of c.ctorParams) if (!vars.has(p.name)) vars.set(p.name, p.type);
  for (const p of m.params) vars.set(p.name, p.type);
  for (const x of body.matchAll(/(?<![\w$.])([A-Z][\w$.]*(?:<[^;(){}=]*?>)?(?:\[\])?)\s+([a-z_$][\w$]*)\s*[=;:,)]/g)) vars.set(x[2], x[1]);
  for (const x of body.matchAll(/\b(?:val|var)\s+([a-z_$][\w$]*)\s*(?::\s*([A-Z][\w$.<>?, ]*?))?\s*=\s*([A-Z][\w$.]*)?/g)) vars.set(x[1], x[2] || x[3] || '?');
  const self = new Set(c.methods.map(x => x.name));
  const seen = new Set();
  const once = (to, kind) => { const k = to + kind; if (!seen.has(k)) { seen.add(k); edge(m.id, to, kind, where); } };
  for (const x of body.matchAll(/(?<![\w$])([\w$]+)\s*(?:\?\.|\.|::)\s*([\w$]+)\s*(\(|\{)?/g)) {
    const [, recv, name, paren] = x;
    if (recv === 'this' || recv === 'super') { if (paren && self.has(name)) once(`${c.id}#${name}`, 'calls'); continue; }
    const t = vars.has(recv) ? vars.get(recv) : /^[A-Z]/.test(recv) ? recv : null;
    if (!t) continue;
    const id = resolveType(t);
    if (!id) continue;
    if (paren || x[0].includes('::')) once(`${id}#${name}`, 'calls');
    else if (!/^[A-Z]/.test(name) && name !== 'class') once(`${id}.${name}`, 'reads');
    // getters/setters of entity fields
    const g = name.match(/^(get|set|is)([A-Z][\w$]*)$/);
    if (g && byId.has(id)) { const fn = g[2][0].toLowerCase() + g[2].slice(1); if (byId.get(id).fields.some(fl => fl.name === fn)) once(`${id}.${fn}`, g[1] === 'set' ? 'writes' : 'reads'); }
  }
  for (const x of body.matchAll(/(?<![\w$.])([a-z_$][\w$]*)\s*\(/g)) if (self.has(x[1]) && !KEYWORDS.has(x[1])) once(`${c.id}#${x[1]}`, 'calls');
  for (const x of body.matchAll(/\bnew\s+([A-Z][\w$.]*)\s*(?:<[^>]*>)?\s*(\()?/g)) {
    const id = resolveType(x[1]);
    if (!id) continue;
    once(id, 'uses');
    // new Foo(...).bar(...): a call on the new object
    if (x[2]) { const close = closeParen(body, x.index + x[0].length - 1); const after = body.slice(close + 1).match(/^\s*\.\s*([\w$]+)\s*\(/); if (after) once(`${id}#${after[1]}`, 'calls'); }
  }
  for (const x of body.matchAll(/(?<![\w$.])([A-Z][\w$]*)\b/g)) { const id = resolveType(x[1]); if (id && byId.has(id) && id !== c.id) once(id, 'uses'); }
}

// Named args of an annotation on (or just above) a line: @Table(name = "orders", schema = "shop")
function annoArgsOf(clean, line, ...names) {
  const lines = clean.split('\n');
  // only the annotations of this declaration: after the previous statement ends
  const before = lines.slice(Math.max(0, line - 8), line).join('\n');
  const cut = Math.max(before.lastIndexOf(';', before.length - lines[line - 1].length - 1), before.lastIndexOf('}', before.length - lines[line - 1].length - 1), before.lastIndexOf('{', before.length - lines[line - 1].length - 1));
  const chunk = before.slice(cut + 1);
  for (const n of names) {
    const re = new RegExp(`@${n}\\s*\\(([^)]*)\\)`, 'g');
    let m, last = null;
    while ((m = re.exec(chunk))) last = m;
    if (last) {
      const out = {};
      for (const a of last[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[a[1]] = a[2];
      const bare = last[1].match(/^\s*"([^"]*)"\s*$/);
      if (bare && !out.name) out.name = bare[1];
      return out;
    }
  }
  return {};
}

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function memberAt(files) {
  const by = new Map();
  for (const f of files) {
    const ranges = [];
    for (const c of f.classes) {
      ranges.push({ id: c.id, from: c.line, to: c.endLine, size: c.endLine - c.line });
      for (const m of c.methods) ranges.push({ id: `${c.id}#${m.name}`, from: m.startLine, to: m.endLine, size: m.endLine - m.startLine });
    }
    by.set(f.file, ranges);
  }
  return (file, line) => {
    const r = (by.get(file) || []).filter(x => x.from <= line && line <= x.to).sort((a, b) => a.size - b.size)[0];
    if (r) return r.id;
    // annotation lines just above a method
    const next = (by.get(file) || []).filter(x => x.id.includes('#') && x.from > line && x.from - line <= 3).sort((a, b) => a.from - b.from)[0];
    return next ? next.id : null;
  };
}

function dedupe(edges) {
  const seen = new Set();
  return edges.filter(e => { const k = `${e[0]}|${e[1]}|${e[2]}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { build, parseFile, blankStrings, segments, snake, baseType };
