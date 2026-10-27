// Static "passport" of a Spring service from its source: regex-level, no compiler, every
// finding carries file:line. Precise enough to map flows (HTTP in/out, Kafka in/out, tables
// read/written, datasources, libraries); anything it can't resolve is reported as such.
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'target', 'build', 'node_modules', '.gradle', '.idea', 'out', 'bin', '.mvn', 'dist']);
const EXT = /\.(java|kt|kts|groovy|ya?ml|properties|xml|sql|gradle|toml)$/;
const MAX_FILE = 1 << 20;

function walk(root) {
  const out = [];
  (function rec(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');
        if (/(^|\/)src\/(test|it|integrationTest)(\/|$)/.test(rel)) continue;
        rec(path.join(dir, e.name));
      } else if (EXT.test(e.name)) {
        const full = path.join(dir, e.name);
        const st = fs.statSync(full);
        if (st.size <= MAX_FILE) out.push({ path: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  })(root);
  return out;
}

const lineAt = (text, idx) => { let n = 1; for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };

// ── config ───────────────────────────────────────────────────────────────
function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#' || line[0] === '!') continue;
    const m = line.match(/^([^=:\s]+)\s*[=:]\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const unquote = (v) => { v = v.trim(); return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v; };
function stripYamlComment(v) {
  let q = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i).trimEnd();
  }
  return v;
}

// Small YAML subset: nested maps, "- " lists, inline [a, b], scalars, multi-docs. Enough for Spring config.
function parseYaml(text) {
  const docs = [];
  for (const doc of text.split(/^---\s*$/m)) {
    const flat = {};
    const stack = [{ indent: -1, key: '' }];
    const listIdx = {};
    let block = null; // multiline | or > values
    for (const raw of doc.split(/\r?\n/)) {
      if (block) {
        const ind = raw.match(/^ */)[0].length;
        if (raw.trim() === '' || ind > block.indent) { flat[block.key] = (flat[block.key] ? flat[block.key] + '\n' : '') + raw.trim(); continue; }
        block = null;
      }
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      const indent = raw.match(/^ */)[0].length;
      let line = stripYamlComment(raw.trim());
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent && !(line.startsWith('- ') && stack[stack.length - 1].indent === indent && stack[stack.length - 1].list)) stack.pop();
      const parent = stack[stack.length - 1].key;
      if (line.startsWith('- ') || line === '-') {
        const i = listIdx[parent] = (listIdx[parent] ?? -1) + 1;
        const item = line.slice(1).trim();
        const key = `${parent}[${i}]`;
        const kv = item.match(/^([^:]+?):\s*(.*)$/);
        if (kv && !/^["']/.test(item)) {
          stack.push({ indent, key, list: true });
          if (kv[2]) flat[`${key}.${kv[1].trim()}`] = unquote(kv[2]); else stack.push({ indent: indent + 2, key: `${key}.${kv[1].trim()}` });
        } else flat[key] = unquote(item);
        continue;
      }
      const m = line.match(/^(["']?)([^"':]+?)\1\s*:(?:\s+(.*)|\s*)$/);
      if (!m) continue;
      const key = parent ? `${parent}.${m[2].trim()}` : m[2].trim();
      const val = m[3];
      if (val === undefined || val === '') stack.push({ indent, key });
      else if (/^[|>][-+]?$/.test(val)) block = { key, indent };
      else if (/^\[.*\]$/.test(val)) val.slice(1, -1).split(',').map(s => unquote(s)).filter(Boolean).forEach((v, i) => { flat[`${key}[${i}]`] = v; });
      else flat[key] = unquote(val);
    }
    docs.push(flat);
  }
  return docs;
}

function loadConfig(files) {
  const sources = []; // {file, profile, props}
  for (const f of files) {
    const base = path.basename(f.path);
    const m = base.match(/^(application|bootstrap)(?:-([\w.-]+))?\.(ya?ml|properties)$/);
    if (!m || !/src\/main\/resources|^[^/]*$|config\//.test(f.path)) continue;
    const docs = m[3] === 'properties' ? [parseProperties(f.text)] : parseYaml(f.text);
    for (const props of docs) {
      const profile = m[2] || props['spring.config.activate.on-profile'] || props['spring.profiles'] || null;
      sources.push({ file: f.path, profile, props });
    }
  }
  // default profile first, so it wins when resolving; profiles fill in what's missing
  sources.sort((a, b) => (a.profile ? 1 : 0) - (b.profile ? 1 : 0));
  const merged = {};
  for (const s of sources) for (const [k, v] of Object.entries(s.props)) if (!(k in merged)) merged[k] = v;
  return { sources, merged, profiles: [...new Set(sources.map(s => s.profile).filter(Boolean))] };
}

// "${a.b:default}" -> value; nested placeholders resolved up to a few levels.
function resolver(merged, unresolved) {
  const relaxed = (k) => merged[k] ?? merged[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? merged[k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())];
  const resolve = (s, depth = 0) => {
    if (typeof s !== 'string' || depth > 5) return s;
    return s.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (all, key, def) => {
      const v = relaxed(key.trim());
      if (v !== undefined) return resolve(String(v), depth + 1);
      if (def !== undefined) return resolve(def, depth + 1);
      unresolved.add(key.trim());
      return all;
    });
  };
  return resolve;
}

// ── java/kotlin helpers ──────────────────────────────────────────────────
// Blank out comments, keep strings and offsets intact (so line numbers stay right).
function stripComments(t) {
  let out = '', i = 0, q = null;
  while (i < t.length) {
    const c = t[i], n = t[i + 1];
    if (q) { out += c; if (c === '\\') { out += n || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' && t.startsWith('"""', i)) { const e = t.indexOf('"""', i + 3); const end = e < 0 ? t.length : e + 3; out += t.slice(i, end); i = end; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < t.length && t[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) { out += t[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// Balanced "( ... )" starting at idx (t[idx] === '('), respecting strings.
function balanced(t, idx, open = '(', close = ')') {
  let depth = 0, q = null;
  for (let i = idx; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return { inner: t.slice(idx + 1, i), end: i + 1 };
  }
  return { inner: t.slice(idx + 1), end: t.length };
}

function splitTop(s) {
  const parts = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ('({['.includes(c)) depth++;
    if (')}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map(p => p.trim());
}

// Annotation args -> { value: [...], name: [...], ... }; each item is a string literal or {expr}.
function annoArgs(inner) {
  const out = {};
  for (const part of splitTop(inner || '')) {
    const m = part.match(/^(\w+)\s*=\s*([\s\S]*)$/);
    const key = m ? m[1] : 'value';
    out[key] = parseValue(m ? m[2] : part);
  }
  return out;
}

function parseValue(v) {
  v = v.trim();
  if (/^[{[]/.test(v)) return splitTop(v.slice(1, -1)).flatMap(parseValue);
  const lits = [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
  if (lits.length && /^("(?:[^"\\]|\\.)*"\s*\+?\s*)+$/.test(v)) return [lits.join('')];
  if (lits.length === 1 && /^"/.test(v)) return [lits[0]];
  return v ? [{ expr: v }] : [];
}

// All annotations named `names` in t: [{name, args, start, end}]
function annotations(t, names) {
  const re = new RegExp(`@(${names.join('|')})\\b`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(t))) {
    let end = m.index + m[0].length, args = {};
    const rest = t.slice(end).match(/^\s*\(/);
    if (rest) { const b = balanced(t, end + rest[0].length - 1); args = annoArgs(b.inner); end = b.end; }
    out.push({ name: m[1], args, start: m.index, end });
  }
  return out;
}

// Method name declared after an annotation (skipping further annotations).
function methodAfter(t, idx) {
  let s = t.slice(idx, idx + 600);
  for (let guard = 0; guard < 12; guard++) {
    const a = s.match(/^\s*@[\w.]+/);
    if (!a) break;
    let cut = a[0].length;
    const p = s.slice(cut).match(/^\s*\(/);
    if (p) cut += balanced(s, cut + p[0].length - 1).end - cut;
    s = s.slice(cut);
  }
  const kt = s.match(/^\s*(?:(?:public|private|protected|internal|open|override|suspend)\s+)*fun\s+(?:<[^>]*>\s*)?(\w+)\s*\(/);
  if (kt) return kt[1];
  const java = s.match(/^\s*(?:(?:public|protected|private|static|final|default|synchronized|abstract)\s+)*(?:<[^>]*>\s*)?[\w.]+(?:\s*<[^()]*?>)?(?:\[\])?\s+(\w+)\s*\(/);
  return java ? java[1] : null;
}

const typeDecl = /(?:^|\s)(?:class|interface|object|enum)\s+(\w+)/g;
function typeAt(t, idx) {
  let name = null, m;
  typeDecl.lastIndex = 0;
  while ((m = typeDecl.exec(t)) && m.index < idx) name = m[1];
  return name;
}

const joinPath = (...ps) => ('/' + ps.filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
const HTTP_ANNO = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH', RequestMapping: null };
const MAPPINGS = Object.keys(HTTP_ANNO);

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// ── SQL ──────────────────────────────────────────────────────────────────
const SQL_NOT_TABLE = new Set(['select', 'lateral', 'unnest', 'generate_series', 'dual', 'values', 'where', 'on', 'set', 'jsonb_array_elements', 'json_array_elements', 'jsonb_each', 'table', 'only', 'the', 'a', 'an', 'to', 'and', 'or', 'not', 'in', 'is', 'as', 'this', 'that', 'it', 'your', 'our', 'their', 'all', 'any', 'each', 'one']);
const TABLE_RE = '("?[a-zA-Z_][\\w$]*"?(?:\\s*\\.\\s*"?[a-zA-Z_][\\w$]*"?)?)';

function sqlRefs(sql) {
  const refs = [];
  const add = (access, re) => {
    for (const m of sql.matchAll(re)) {
      const name = m[1].replace(/["\s]/g, '').toLowerCase();
      if (SQL_NOT_TABLE.has(name) || /^\d/.test(name)) continue;
      // "delete from x" is a write; the generic "from x" rule must not also count it as a read
      if (access === 'read' && /delete\s+$/i.test(sql.slice(Math.max(0, m.index - 8), m.index))) continue;
      const after = sql.slice(m.index + m[0].length).trimStart();
      refs.push({ table: name, access: after.startsWith('(') && access === 'read' ? 'function' : access });
    }
  };
  add('read', new RegExp(`\\b(?:from|join)\\s+${TABLE_RE}`, 'gi'));
  add('write', new RegExp(`\\binsert\\s+into\\s+${TABLE_RE}`, 'gi'));
  add('write', new RegExp(`\\bupdate\\s+${TABLE_RE}\\s+set\\b`, 'gi'));
  add('write', new RegExp(`\\bdelete\\s+from\\s+${TABLE_RE}`, 'gi'));
  add('write', new RegExp(`\\bmerge\\s+into\\s+${TABLE_RE}`, 'gi'));
  add('write', new RegExp(`\\btruncate\\s+(?:table\\s+)?${TABLE_RE}`, 'gi'));
  return refs;
}
// Function / procedure calls in SQL: every name( that is not a keyword or a common builtin.
// Callers match them against the synced Postgres catalog, so leftovers (an unknown builtin) drop out.
const SQL_NOT_FN = new Set(('select from where in exists values any all some as on using and or not case when then else end coalesce nullif greatest least ' +
  'cast count sum min max avg lower upper trim now concat substring position extract array row over filter within lateral unnest into table with ' +
  'returning set join by group order limit offset distinct between like ilike is null interval date timestamp length round abs floor ceil ' +
  'to_char to_date to_timestamp to_number date_trunc date_part string_agg array_agg json_agg jsonb_agg json_build_object jsonb_build_object ' +
  'row_number rank dense_rank lag lead first_value last_value nextval currval setval gen_random_uuid uuid_generate_v4 md5 replace split_part ' +
  'regexp_replace regexp_matches format left right char varchar numeric decimal int integer bigint smallint text jsonb json bool boolean float ' +
  'double real primary key references foreign unique check default index create alter update delete insert merge call perform execute return ' +
  'returns function procedure if raise loop for while begin declare language of do conflict constraint generate_series jsonb_array_elements ' +
  'json_array_elements jsonb_each jsonb_set to_jsonb to_json array_length cardinality mod power sqrt random age make_interval new ' +
  'char_length octet_length chr ascii initcap lpad rpad btrim ltrim rtrim strpos reverse repeat translate encode decode ' +
  'jsonb_extract_path_text jsonb_typeof jsonb_array_length row_to_json array_to_json array_to_string string_to_array bool_and bool_or every ' +
  'percentile_cont percentile_disc mode ntile cume_dist percent_rank nth_value current_setting set_config pg_sleep exp ln log sign trunc ' +
  'width_bucket clock_timestamp statement_timestamp transaction_timestamp timeofday justify_days date_bin isfinite overlaps').split(' '));

function sqlCalls(sql) {
  const out = new Set();
  for (const m of sql.matchAll(/(?<![\w$."'])("?[a-zA-Z_][\w$]*"?(?:\s*\.\s*"?[a-zA-Z_][\w$]*"?)?)\s*\(/g)) {
    const name = m[1].replace(/["\s]/g, '').toLowerCase();
    const parts = name.split('.');
    if (SQL_NOT_FN.has(parts[parts.length - 1]) || parts[0] === 'pg_catalog') continue;
    // "insert into t (cols)", "create table t (", "references t (" are tables, not calls
    if (/\b(into|table|references|exists|index|on|view|type)\s*$/i.test(sql.slice(Math.max(0, m.index - 12), m.index))) continue;
    out.add(name);
  }
  return [...out];
}
const looksCall = (s) => /\b(select|call|perform)\s+"?[\w.]+"?\s*\(/i.test(s) || /\{\s*(\?\s*=\s*)?call\s/i.test(s);
const looksSql = (s) => /\b(select\s[\s\S]*\bfrom|insert\s+into|update\s+\S+\s+set|delete\s+from|merge\s+into|truncate)\b/i.test(s);

// String literals of a source file with their offsets, adjacent "a" + "b" joined.
function stringLiterals(t) {
  const out = [];
  const re = /"""([\s\S]*?)"""|"((?:[^"\\\n]|\\.)*)"/g;
  let m, cur = null;
  while ((m = re.exec(t))) {
    const val = m[1] !== undefined ? m[1] : m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    if (cur && /^\s*\+\s*$/.test(t.slice(cur.end, m.index))) { cur.value += val; cur.end = m.index + m[0].length; continue; }
    if (cur) out.push(cur);
    cur = { value: val, index: m.index, end: m.index + m[0].length };
  }
  if (cur) out.push(cur);
  return out;
}

// ── dependencies ─────────────────────────────────────────────────────────
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`)); return m ? m[1] : null; };

function parsePom(text) {
  const noComments = text.replace(/<!--[\s\S]*?-->/g, '');
  const props = {};
  const propsBlock = noComments.match(/<properties>([\s\S]*?)<\/properties>/);
  if (propsBlock) for (const m of propsBlock[1].matchAll(/<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g)) props[m[1]] = m[2];
  const parentBlock = noComments.match(/<parent>([\s\S]*?)<\/parent>/);
  const parent = parentBlock ? { groupId: tag(parentBlock[1], 'groupId'), artifactId: tag(parentBlock[1], 'artifactId'), version: tag(parentBlock[1], 'version') } : null;
  const head = noComments.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<(dependencies|dependencyManagement|build|profiles|properties|modules|repositories|pluginRepositories|distributionManagement|reporting)>[\s\S]*?<\/\1>/g, '');
  const self = { groupId: tag(head, 'groupId') || parent?.groupId, artifactId: tag(head, 'artifactId'), version: tag(head, 'version') || parent?.version };
  props['project.version'] = self.version; props['project.groupId'] = self.groupId;
  if (parent?.version) props['project.parent.version'] = parent.version;
  const res = (v) => v && v.replace(/\$\{([^}]+)\}/g, (a, k) => props[k] ?? a);
  const deps = [];
  for (const m of noComments.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const d = m[1];
    deps.push({ groupId: res(tag(d, 'groupId')), artifactId: res(tag(d, 'artifactId')), version: res(tag(d, 'version')), scope: tag(d, 'scope') || (tag(d, 'type') === 'pom' ? 'import' : null) });
  }
  return { self, parent, deps, props };
}

// Gradle variables: ext { a = '1' }, ext.a = '1', ext['a'] = '1', ext.set('a', '1'), extra["a"] = "1",
// val a by extra("1"), def a = '1', val a = "1", and maps (ext.versions = [kafka: '3.1'] -> versions.kafka).
function gradleVars(text) {
  const out = {};
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');
  const str = (v) => { const m = String(v).trim().match(/^(["'])((?:(?!\1).)*)\1/); return m ? m[2] : null; };
  const put = (k, raw) => {
    const v = String(raw).trim();
    const map = v.match(/^\[([\s\S]*)\]$/) || v.match(/^mapOf\(([\s\S]*)\)$/);
    if (map) { for (const m of map[1].matchAll(/["']?([\w.-]+)["']?\s*(?::|to)\s*(["'][^"']*["'])/g)) out[`${k}.${m[1]}`] = str(m[2]); return; }
    const s = str(v);
    if (s !== null) out[k] = s;
    else if (/^[\d.]+$/.test(v)) out[k] = v;
    else if (/^[\w.]+$/.test(v)) out[k] = `\${${v}}`; // another variable: resolved below
  };
  // ext { ... } blocks (also inside buildscript { })
  for (const m of t.matchAll(/\b(?:project\.)?ext\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < t.length && depth; i++) { if (t[i] === '{') depth++; else if (t[i] === '}') depth--; }
    const body = t.slice(start, i - 1);
    for (const a of body.matchAll(/^\s*(?:set\s*\(\s*["'](\w+)["']\s*,\s*([^)\n]+)\)|(\w+)\s*=\s*(\[[\s\S]*?\]|[^\n]+))/gm)) put(a[1] || a[3], (a[2] || a[4]).replace(/[;,]\s*$/, ''));
  }
  const line = [
    /\b(?:project\.)?ext\.(\w+)\s*=\s*(\[[\s\S]*?\]|[^\n;]+)/g,
    /\bext\s*\[\s*["'](\w+)["']\s*\]\s*=\s*([^\n;]+)/g,
    /\b(?:project\.)?ext\.set\s*\(\s*["'](\w+)["']\s*,\s*([^)\n]+)\)/g,
    /\bextra\s*\[\s*["'](\w+)["']\s*\]\s*=\s*([^\n;]+)/g,
    /\bextra\.set\s*\(\s*["'](\w+)["']\s*,\s*([^)\n]+)\)/g,
    /\bval\s+(\w+)(?:\s*:\s*String)?\s+by\s+extra\s*\(\s*([^)\n]+)\)/g,
    /^\s*(?:def|val|var)\s+(\w+)(?:\s*:\s*String)?\s*=\s*(mapOf\([\s\S]*?\)|\[[\s\S]*?\]|[^\n;]+)/gm,
  ];
  for (const re of line) for (const m of t.matchAll(re)) put(m[1], m[2]);
  return out;
}

// "${a}", "$a", "${versions.kafka}", "$versions.kafka" -> values from props (variables may refer to each other)
function gradleResolve(v, props) {
  if (v == null) return v;
  let out = String(v);
  for (let i = 0; i < 5 && /\$/.test(out); i++) {
    const next = out.replace(/\$\{([\w.]+)\}|\$([A-Za-z_]\w*(?:\.\w+)*)/g, (a, k1, k2) => {
      const k = k1 || k2;
      if (props[k] !== undefined) return props[k];
      // "$version.jar": the variable is only the first part
      const parts = k.split('.');
      for (let n = parts.length - 1; n > 0; n--) { const head = parts.slice(0, n).join('.'); if (props[head] !== undefined) return props[head] + '.' + parts.slice(n).join('.'); }
      return a;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function parseGradle(text, props = {}) {
  const deps = [];
  const all = { ...props, ...gradleVars(text) };
  const res = (v) => (v ? gradleResolve(v, all) : v);
  const conf = 'implementation|api|compile|compileOnly|runtimeOnly|annotationProcessor|kapt|testImplementation';
  const re = new RegExp(`\\b(${conf})\\s*\\(?\\s*(?:(?:platform|enforcedPlatform)\\s*\\(\\s*)?["']([^:"'\\s]+):([^:"'\\s]+)(?::([^"'\\s]+))?["']`, 'g');
  for (const m of text.matchAll(re)) if (m[1] !== 'testImplementation') deps.push({ groupId: m[2], artifactId: m[3], version: res(m[4]) || null, scope: m[1] });
  // map style: implementation group: 'com.acme', name: 'x', version: serviceVersion
  const mapRe = new RegExp(`\\b(${conf})\\s*\\(?\\s*group\\s*[:=]\\s*["']([^"']+)["']\\s*,\\s*name\\s*[:=]\\s*["']([^"']+)["'](?:\\s*,\\s*version\\s*[:=]\\s*(["'][^"']*["']|[\\w.]+))?`, 'g');
  for (const m of text.matchAll(mapRe)) {
    if (m[1] === 'testImplementation') continue;
    const v = m[4] ? (/^["']/.test(m[4]) ? m[4].slice(1, -1) : `\${${m[4]}}`) : null;
    deps.push({ groupId: m[2], artifactId: m[3], version: res(v) || null, scope: m[1] });
  }
  const group = text.match(/^\s*group\s*=\s*["']([^"']+)["']/m);
  const boot = text.match(/id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/);
  for (const d of deps) if (d.version && /\$/.test(d.version)) d.unresolvedVersion = true;
  return { deps, group: group && group[1], bootVersion: boot && boot[1], vars: all };
}

// ── main ─────────────────────────────────────────────────────────────────
function extract(root, { internalGroups = [] } = {}) {
  const started = Date.now();
  const files = walk(root);
  const code = files.filter(f => /\.(java|kt|groovy)$/.test(f.path)).map(f => ({ ...f, clean: stripComments(f.text) }));
  const unresolved = new Set();
  const cfg = loadConfig(files);
  const resolve = resolver(cfg.merged, unresolved);
  const at = (f, idx) => ({ file: f.path, line: lineAt(f.text, idx) });

  // constants and @Value fields, to resolve topic/table names given as identifiers
  const constants = {};
  const valueFields = {};
  for (const f of code) {
    for (const m of f.clean.matchAll(/\b(?:static\s+final|final\s+static|const\s+val)\s+(?:String\s+)?(\w+)\s*(?::\s*String\s*)?=\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/g)) {
      constants[m[1]] = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => x[1]).join('');
    }
    for (const m of f.clean.matchAll(/@Value\s*\(\s*"([^"]+)"\s*\)\s*(?:(?:private|protected|public|final|lateinit|var|val)\s+)*(?:[\w<>]+\s+)?(\w+)/g)) valueFields[m[2]] = m[1];
  }
  const fromExpr = (x) => {
    if (typeof x === 'string') return resolve(x);
    const e = x.expr.trim();
    const spel = e.match(/^"?#\{'?(\$\{[^}]+\})'?(?:\.split\([^)]*\))?\}"?$/);
    if (spel) return resolve(spel[1]);
    const id = e.split('.').pop();
    if (constants[id] !== undefined) return resolve(constants[id]);
    if (valueFields[id] !== undefined) return resolve(valueFields[id]);
    const getter = e.match(/(?:get)?(\w+)\(\)$/);
    if (getter && valueFields[getter[1][0].toLowerCase() + getter[1].slice(1)]) return resolve(valueFields[getter[1][0].toLowerCase() + getter[1].slice(1)]);
    return { unresolved: e };
  };
  const values = (arr) => (arr || []).map(fromExpr).flatMap(v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [v]));
  const show = (v) => (typeof v === 'string' ? v : `?${v.unresolved}`);

  const endpoints = [], feign = [], consumes = [], produces = [], tables = [], calls = [], esIndices = [], http = [];

  for (const f of code) {
    const t = f.clean;
    const isController = /@(Rest)?Controller\b/.test(t);
    const feignAnno = annotations(t, ['FeignClient'])[0];
    if (isController || feignAnno) {
      const firstType = t.search(/(?:^|\s)(?:class|interface)\s+\w+/);
      const classMap = annotations(t.slice(0, Math.max(firstType, 0)), ['RequestMapping'])[0];
      const base = classMap ? values(classMap.args.value || classMap.args.path).map(show)[0] || '' : '';
      for (const a of annotations(t, MAPPINGS)) {
        if (a.start < firstType) continue;
        const paths = values(a.args.value || a.args.path).map(show);
        const reqMethods = (a.args.method || []).map(x => (typeof x === 'string' ? x : x.expr.split('.').pop()));
        const methods = HTTP_ANNO[a.name] ? [HTTP_ANNO[a.name]] : reqMethods.length ? reqMethods : ['ANY'];
        const handler = `${typeAt(t, a.start)}.${methodAfter(t, a.end)}`;
        for (const m of methods) for (const p of paths.length ? paths : ['']) {
          const item = { method: m, path: joinPath(base, p), handler, ...at(f, a.start) };
          if (feignAnno) {
            const fa = feignAnno.args;
            item.client = show(values(fa.name || fa.value || fa.contextId)[0] || '?');
            item.url = fa.url ? show(values(fa.url)[0]) : null;
            item.path = joinPath(fa.path ? show(values(fa.path)[0]) : '', base, p);
            feign.push(item);
          } else endpoints.push(item);
        }
      }
    }

    for (const a of annotations(t, ['KafkaListener'])) {
      const topics = values(a.args.topics || a.args.value);
      const pattern = a.args.topicPattern ? values(a.args.topicPattern).map(show) : [];
      const group = a.args.groupId ? show(values(a.args.groupId)[0]) : a.args.id ? show(values(a.args.id)[0]) : null;
      const handler = `${typeAt(t, a.start)}.${methodAfter(t, a.end) || '(class)'}`;
      for (const tp of topics) consumes.push({ topic: show(tp), group, handler, via: '@KafkaListener', ...at(f, a.start) });
      for (const p of pattern) consumes.push({ topic: p, pattern: true, group, handler, via: '@KafkaListener(topicPattern)', ...at(f, a.start) });
    }

    // kafkaTemplate.send(topic, ...), producer.send(new ProducerRecord<>(topic, ...)), streamBridge.send(binding, ...)
    for (const m of t.matchAll(/(\w+)\s*\.\s*(send|sendDefault)\s*\(\s*/g)) {
      const recv = m[1];
      if (!/kafka|template|producer|publisher|bridge/i.test(recv) || /jms|rabbit|amqp|mail|sms|rest|web|http/i.test(recv)) continue;
      const open = m.index + m[0].length - 1;
      const args = splitTop(balanced(t, t.lastIndexOf('(', open)).inner);
      let first = args[0] || '';
      const pr = first.match(/new\s+ProducerRecord\s*(?:<[^>]*>)?\s*\(([\s\S]*)\)$/);
      if (pr) first = splitTop(pr[1])[0];
      if (m[2] === 'sendDefault') { produces.push({ topic: '(default topic)', via: `${recv}.sendDefault`, ...at(f, m.index) }); continue; }
      const v = parseValue(first)[0];
      if (v === undefined) continue;
      const topic = show(fromExpr(v));
      if (/bridge/i.test(recv)) {
        const dest = cfg.merged[`spring.cloud.stream.bindings.${topic}.destination`];
        produces.push({ topic: dest ? resolve(dest) : topic, binding: topic, via: 'StreamBridge.send', ...at(f, m.index) });
      } else produces.push({ topic, via: `${recv}.${m[2]}`, ...at(f, m.index) });
    }

    // JPA entities and repositories
    const ent = /@Entity\b/.test(t);
    if (ent) {
      const tbl = annotations(t, ['Table'])[0];
      const cls = (t.match(/(?:class|data\s+class)\s+(\w+)/) || [])[1];
      const name = tbl && (tbl.args.name || tbl.args.value) ? show(values(tbl.args.name || tbl.args.value)[0]) : snake(cls || '?');
      const schema = tbl && tbl.args.schema ? show(values(tbl.args.schema)[0]) : null;
      tables.push({ table: (schema ? `${schema}.${name}` : name).toLowerCase(), access: 'entity', via: `@Entity ${cls}`, entity: cls, ...at(f, t.indexOf('@Entity')) });
    }
    for (const m of t.matchAll(/interface\s+(\w+)\s*(?:<[^>]*>)?\s*:?\s*(?:extends\s+)?[\w.]*?(Jpa|Crud|PagingAndSorting|ListCrud|ListPagingAndSorting|Reactive\w*|R2dbc|Coroutine\w*)Repository\s*<\s*(\w+)/g)) {
      tables.push({ table: null, entity: m[3], access: 'repository', via: `${m[1]} (${m[2]}Repository)`, ...at(f, m.index) });
    }

    // SQL in string literals (@Query, JdbcTemplate, ...)
    for (const s of stringLiterals(t)) {
      const isSql = looksSql(s.value);
      if (!isSql && !looksCall(s.value)) continue;
      const snippet = s.value.replace(/\s+/g, ' ').slice(0, 300);
      if (isSql) for (const r of sqlRefs(s.value)) tables.push({ ...r, via: 'sql', sql: snippet, ...at(f, s.index) });
      for (const name of sqlCalls(s.value)) calls.push({ name, via: 'sql', sql: snippet, ...at(f, s.index) });
    }
    // stored procedures/functions named outside SQL text
    for (const a of annotations(t, ['Procedure', 'NamedStoredProcedureQuery'])) {
      const n = a.args.procedureName || (a.name === 'Procedure' && a.args.value);
      if (n) calls.push({ name: show(values(n)[0]).toLowerCase(), via: `@${a.name}`, explicit: true, ...at(f, a.start) });
    }
    for (const m of t.matchAll(/\.(withProcedureName|withFunctionName|createStoredProcedureQuery)\s*\(\s*"([\w.]+)"/g)) {
      calls.push({ name: m[2].toLowerCase(), via: m[1], explicit: true, ...at(f, m.index) });
    }

    for (const a of annotations(t, ['Document'])) {
      if (a.args.indexName) esIndices.push({ index: show(values(a.args.indexName)[0]), via: '@Document', ...at(f, a.start) });
    }
    for (const m of t.matchAll(/IndexCoordinates\s*\.\s*of\s*\(\s*([^)]+)\)/g)) {
      esIndices.push({ index: show(fromExpr(parseValue(splitTop(m[1])[0])[0] || { expr: m[1] })), via: 'IndexCoordinates.of', ...at(f, m.index) });
    }

    for (const s of stringLiterals(t)) {
      const u = s.value.match(/^(https?|lb):\/\/([^/\s"'$]+|\$\{[^}]+\})[^\s"']*$/);
      if (u && !/(w3\.org|xmlns|schema|apache\.org|springframework\.org|example\.com)/i.test(s.value)) http.push({ url: resolve(s.value), target: resolve(u[2]), via: 'code', ...at(f, s.index) });
    }
  }

  // MyBatis mappers, plain SQL, migrations
  for (const f of files) {
    const isMigration = /(db\/migration|liquibase|changelog|flyway|migrations?)\//i.test(f.path);
    if (/\.sql$/.test(f.path) || (/\.xml$/.test(f.path) && /<mapper\b|<changeSet\b|<databaseChangeLog\b/.test(f.text)) || (/\.ya?ml$/.test(f.path) && /databaseChangeLog/.test(f.text))) {
      if (isMigration) {
        for (const m of f.text.matchAll(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${TABLE_RE}`, 'gi'))) tables.push({ table: m[1].replace(/["\s]/g, '').toLowerCase(), access: 'owner', via: 'migration', ...at(f, m.index) });
        for (const m of f.text.matchAll(/<createTable\b([^>]*)>/g)) {
          const tn = (m[1].match(/tableName="([^"]+)"/) || [])[1];
          const sc = (m[1].match(/schemaName="([^"]+)"/) || [])[1];
          if (tn) tables.push({ table: (sc ? `${sc}.${tn}` : tn).toLowerCase(), access: 'owner', via: 'liquibase', ...at(f, m.index) });
        }
      } else {
        const via = /\.xml$/.test(f.path) ? 'mybatis' : 'sql file';
        for (const r of sqlRefs(f.text)) tables.push({ ...r, via, ...at(f, 0) });
        for (const name of sqlCalls(f.text)) calls.push({ name, via, ...at(f, 0) });
      }
    }
  }

  // config-declared kafka bindings, datasources, URLs, indices
  const datasources = [];
  const declaredTopics = [];
  for (const [k, raw] of Object.entries(cfg.merged)) {
    const v = resolve(String(raw));
    const b = k.match(/^spring\.cloud\.stream\.bindings\.([^.]+)\.destination$/);
    if (b) {
      const out = /-out-\d+$|output/i.test(b[1]);
      (out ? produces : consumes).push({ topic: v, binding: b[1], group: out ? undefined : resolve(cfg.merged[`spring.cloud.stream.bindings.${b[1]}.group`] || '') || null, via: 'stream binding', file: 'config', line: 0, key: k });
      continue;
    }
    if (/(^|\.)(url|jdbc-url|jdbcUrl)$/.test(k) && /^(jdbc|r2dbc):/.test(v)) {
      const m = v.match(/^(?:jdbc|r2dbc):(\w+):(?:\/\/)?([^/?;]+)\/([^?;]+)/);
      datasources.push({ key: k, kind: m ? m[1] : 'unknown', host: m ? m[2] : null, db: m ? m[3] : null, url: v.replace(/password=[^&;]+/gi, 'password=***') });
      continue;
    }
    if (/topic/i.test(k) && /^[\w.\-]+$/.test(v) && !/^\d+$/.test(v) && !/(partitions|replicas|replication|retention|count|enabled|size|timeout)/i.test(k)) declaredTopics.push({ key: k, topic: v });
    if (/^(https?|lb):\/\//.test(v)) http.push({ url: v, target: (v.match(/^\w+:\/\/([^/:]+)/) || [])[1], key: k, via: 'config', file: 'config', line: 0 });
    if (/(index(-|_)?name|\.index)$/i.test(k) && /^[\w.\-*]+$/.test(v)) esIndices.push({ index: v, via: 'config', key: k, file: 'config', line: 0 });
  }

  // repositories -> tables of their entities
  const entityTable = Object.fromEntries(tables.filter(t => t.access === 'entity').map(t => [t.entity, t.table]));
  for (const t of tables) if (t.access === 'repository') t.table = entityTable[t.entity] || snake(t.entity);

  // dependencies
  const deps = [];
  let self = null, bootVersion = null;
  // Gradle variables from gradle.properties and every build/settings script (the root one first): ext { }, ext.x, def/val
  const gradleProps = {};
  for (const f of files) if (/gradle\.properties$/.test(f.path)) Object.assign(gradleProps, parseProperties(f.text));
  const scripts = files.filter(f => /(build|settings)\.gradle(\.kts)?$/.test(f.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const f of scripts) for (const [k, v] of Object.entries(gradleVars(f.text))) if (gradleProps[k] === undefined) gradleProps[k] = v;
  const modules = new Set();
  for (const f of files) {
    if (path.basename(f.path) === 'pom.xml') {
      const p = parsePom(f.text);
      if (!self || f.path === 'pom.xml') self = p.self;
      if (p.self.artifactId) modules.add(`${p.self.groupId}:${p.self.artifactId}`);
      if (p.parent && p.parent.artifactId === 'spring-boot-starter-parent') bootVersion = p.parent.version;
      for (const d of p.deps) deps.push({ ...d, from: f.path });
    } else if (/build\.gradle(\.kts)?$/.test(f.path)) {
      const g = parseGradle(f.text, gradleProps);
      if (g.group && !self) self = { groupId: g.group, artifactId: path.basename(root), version: gradleResolve(gradleProps.version, gradleProps) || null };
      bootVersion = bootVersion || g.bootVersion;
      for (const d of g.deps) deps.push({ ...d, from: f.path });
    }
  }
  const ownPrefix = self?.groupId ? self.groupId.split('.').slice(0, 2).join('.') : null;
  const isInternal = (g) => !!g && (internalGroups.length ? internalGroups.some(p => g === p || g.startsWith(p + '.')) : !!ownPrefix && (g === ownPrefix || g.startsWith(ownPrefix + '.')));
  const seen = new Set();
  const dependencies = { internal: [], external: [], modules: [...modules] };
  for (const d of deps) {
    const key = `${d.groupId}:${d.artifactId}`;
    if (!d.groupId || seen.has(key) || modules.has(key)) continue;
    seen.add(key);
    (isInternal(d.groupId) ? dependencies.internal : dependencies.external).push({ groupId: d.groupId, artifactId: d.artifactId, version: d.version, scope: d.scope });
  }
  if (!bootVersion) bootVersion = (deps.find(d => d.groupId === 'org.springframework.boot' && d.version) || {}).version || null;

  return {
    app: {
      name: cfg.merged['spring.application.name'] ? resolve(cfg.merged['spring.application.name']) : null,
      groupId: self?.groupId || null, artifactId: self?.artifactId || null, version: self?.version || null,
      springBoot: bootVersion,
      port: cfg.merged['server.port'] ? resolve(String(cfg.merged['server.port'])) : null,
      contextPath: cfg.merged['server.servlet.context-path'] ? resolve(cfg.merged['server.servlet.context-path']) : null,
      profiles: cfg.profiles,
    },
    endpoints, feign,
    kafka: { consumes, produces, declared: declaredTopics },
    db: { datasources, tables, calls },
    es: esIndices,
    http,
    dependencies,
    config: { files: [...new Set(cfg.sources.map(s => s.file))], keys: Object.keys(cfg.merged).length, unresolved: [...unresolved].sort() },
    stats: { files: files.length, sourceFiles: code.length, ms: Date.now() - started },
  };
}

module.exports = { extract, parseYaml, parseProperties, parsePom, parseGradle, gradleVars, gradleResolve, sqlRefs, sqlCalls, stripComments, annoArgs, methodAfter, stringLiterals, loadConfig, resolver };
