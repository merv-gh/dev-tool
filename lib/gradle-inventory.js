// Gradle source inventory, not a Gradle evaluator. Only known source declarations are editable;
// dynamic Groovy/Kotlin stays explicitly unresolved. Sources come from immutable Git objects.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { CACHE, readJson, writeJson, pool } = require('./util');
const G = require('./git');
const FORMAT = 1, MAX_FILES = 3000, MAX_FILE = 2 * 1024 * 1024, MAX_BYTES = 16 * 1024 * 1024;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const base = () => path.join(require('./access').scopedDirectory(CACHE), 'gradle');
const invalid = message => Object.assign(new Error(message), { code: 'DT_ARGUMENT_INVALID' });
const isBuild = name => /(^|\/)(?:build|settings)\.gradle(?:\.kts)?$|(^|\/)gradle\.properties$|(^|\/)gradle\/[^/]+\.versions\.toml$/.test(name);

// A lexer preserves offsets and skips comments, so edits are spans owned by syntax rather than
// replacements that could touch comments, unrelated versions, or repeated strings.
function tokens(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const start = i, c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (text.startsWith('//', i) || c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (text.startsWith('$/', i)) { const end = text.indexOf('/$', i + 2); i = end < 0 ? text.length : end + 2; out.push({ type: 'opaque', value: '', start, end: i }); continue; }
    if (c === '/' && ['=', '(', '[', ',', ':'].includes(out.at(-1)?.value)) { i++; while (i < text.length && text[i] !== '/') { if (text[i] === '\\') i += 2; else i++; } i = Math.min(text.length, i + 1); out.push({ type: 'opaque', value: '', start, end: i }); continue; }
    if (c === '"' || c === "'") {
      const triple = text.slice(i, i + 3) === c.repeat(3), open = triple ? 3 : 1; i += open;
      const contentStart = i;
      while (i < text.length && !(triple ? text.startsWith(c.repeat(3), i) : text[i] === c)) { if (text[i] === '\\') i += 2; else i++; }
      const contentEnd = i; i = Math.min(text.length, i + open);
      out.push({ type: 'string', value: text.slice(contentStart, contentEnd), start, end: i, from: contentStart, to: contentEnd, simple: !triple && !text.slice(contentStart, contentEnd).includes('\\'), quote: c }); continue;
    }
    if (/[\w$]/.test(c)) { while (i < text.length && /[\w$-]/.test(text[i])) i++; out.push({ type: 'word', value: text.slice(start, i), start, end: i }); continue; }
    out.push({ type: 'punct', value: c, start, end: ++i });
  }
  return out;
}
const lineAt = (file, offset) => { const starts = file.lineStarts; let lo = 0, hi = starts.length; while (lo < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= offset) lo = mid + 1; else hi = mid; } return lo; };
const owner = (file, token, kind = 'literal', key) => ({ path: file.path, from: token.from, to: token.to, value: token.value, revision: file.revision, line: lineAt(file, token.from), kind, ...(key ? { key } : {}) });
const plainVersion = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.\-]*$/.test(value) && !/^latest\./i.test(value);
function parseFiles(files, { internalGroups = [] } = {}) {
  const all = files.map(f => {
    const lineStarts = [0]; for (let i = 0; i < f.content.length; i++) if (f.content[i] === '\n') lineStarts.push(i + 1);
    const ts = tokens(f.content), stack = [], extraScope = [];
    for (let i = 0; i < ts.length; i++) { if (ts[i].value === '{') stack.push(stack.at(-1) || ts[i - 1]?.value === 'ext'); extraScope[i] = !!stack.at(-1); if (ts[i].value === '}') stack.pop(); }
    return { ...f, revision: f.revision || digest(Buffer.from(f.content)), tokens: ts, lineStarts, extraScope };
  });
  const definitions = [], dependencies = [], issues = [], catalogs = new Map();
  const def = (key, file, token, shared = false, kind = 'variable') => definitions.push({ key, owner: owner(file, token, kind, key), shared, path: file.path });
  for (const file of all) {
    if (file.path.endsWith('gradle.properties')) {
      let offset = 0;
      for (const raw of file.content.split('\n')) {
        const m = raw.match(/^\s*([\w.\-]+)\s*[=:]\s*([^#!\r\n]*?)(?:\r)?$/);
        if (m) { const from = offset + raw.indexOf(m[2], raw.indexOf(m[1]) + m[1].length); if (plainVersion(m[2])) def(m[1], file, { from, to: from + m[2].length, value: m[2] }, true, 'property'); else definitions.push({ key: m[1], owner: null, shared: true, path: file.path }); }
        offset += raw.length + 1;
      }
      continue;
    }
    if (file.path.endsWith('.toml')) continue;
    const ts = file.tokens;
    for (let i = 0; i < ts.length; i++) {
      // Groovy def/ext.foo/extra["foo"], Kotlin val/var and extra["foo"].
      if (ts[i].value !== '=') continue;
      const value = ts[i + 1]; if (!value) continue;
      const rest = ts[i + 2];
      const literal = value.type === 'string' && value.simple && plainVersion(value.value) && (!rest || [';', '}', ')', ','].includes(rest.value) || file.content.slice(value.end, rest.start).includes('\n'));
      let name = ts[i - 1], shared = false;
      if (name?.value === ']' && ts[i - 2]?.type === 'string' && ts[i - 3]?.value === '[' && ts[i - 4]?.value === 'extra') { name = ts[i - 2]; shared = true; }
      else if (name?.type === 'word') shared = (ts[i - 2]?.value === '.' && ['ext', 'extra'].includes(ts[i - 3]?.value)) || file.extraScope[i];
      else continue;
      const before = ts[i - 2], declaration = ['def', 'val', 'var'].includes(before?.value) || shared;
      const reassignment = definitions.some(d => d.key === name.value && (d.path === file.path || d.shared));
      // Ignore named call arguments; computed/reassigned variables invalidate literal ownership.
      if (!declaration && !reassignment) continue;
      if (literal) def(name.value, file, value, shared);
      else definitions.push({ key: name.value, owner: null, shared, path: file.path, reason: 'computed or reassigned variable' });
    }
  }
  const resolve = (file, raw, direct) => {
    if (plainVersion(raw)) return { version: raw, owner: direct, state: 'resolved' };
    const variable = raw?.match(/^\$(?:\{([\w.]+)\}|([\w.]+))$/) || raw?.match(/^([\w.]+)$/);
    const name = variable && (variable[1] || variable[2]);
    if (!name) return { version: null, state: 'unresolved', reason: 'dynamic version expression' };
    const key = name.replace(/^(?:rootProject\.)?(?:ext\.|extra\.)?/, '');
    const local = definitions.filter(d => d.key === key && d.path === file.path);
    const moduleDir = path.posix.dirname(file.path), ancestor = p => moduleDir === path.posix.dirname(p) || path.posix.dirname(p) === '.' || moduleDir.startsWith(path.posix.dirname(p) + '/');
    const shared = definitions.filter(d => d.key === key && d.shared && ancestor(d.path));
    const matches = local.length ? local : shared;
    if (matches.length !== 1 || !matches[0].owner) return { version: null, state: 'unresolved', reason: matches.length > 1 ? `ambiguous version owner: ${key}` : matches.length ? `computed version owner: ${key}` : `version owner not found: ${key}`, variable: key };
    return { version: matches[0].owner.value, owner: matches[0].owner, state: 'resolved', variable: key };
  };
  const add = dep => {
    dep.internal = dep.kind === 'project' || internalGroups.some(g => dep.group === g || dep.group?.startsWith(g + '.'));
    dependencies.push(dep);
  };
  // Catalog TOML is parsed a line/table at a time. Computed/multiline constructs remain gaps.
  for (const file of all.filter(f => f.path.endsWith('.toml'))) {
    let section = '', offset = 0;
    const versions = new Map(), entries = [];
    for (const raw of file.content.split('\n')) {
      const header = raw.match(/^\s*\[([\w.]+)\]\s*(?:#.*)?$/);
      if (header) { section = header[1]; offset += raw.length + 1; continue; }
      const match = raw.match(/^\s*([\w.\-]+)\s*=\s*(.+)$/);
      if (!match || raw.trimStart().startsWith('#')) { offset += raw.length + 1; continue; }
      const key = match[1], ts = tokens(raw).map(t => ({ ...t, start: t.start + offset, end: t.end + offset, ...(t.from === undefined ? {} : { from: t.from + offset, to: t.to + offset }) }));
      const value = ts[2];
      if (section === 'versions') versions.set(key, !versions.has(key) && value?.type === 'string' && value.simple && plainVersion(value.value) ? owner(file, value, 'catalog-version', key) : null);
      if (['libraries', 'plugins'].includes(section)) entries.push({ key, ts, value, section, line: lineAt(file, offset) });
      offset += raw.length + 1;
    }
    for (const entry of entries) {
      const fields = {};
      for (let i = 3; i < entry.ts.length; i++) {
        const t = entry.ts[i];
        if (t.type !== 'word') continue;
        let key = t.value, j = i + 1;
        if (entry.ts[j]?.value === '.' && entry.ts[j + 1]?.type === 'word') { key += '.' + entry.ts[j + 1].value; j += 2; }
        if (entry.ts[j]?.value === '=' && entry.ts[j + 1]?.type === 'string') fields[key] = entry.ts[j + 1];
      }
      const coord = entry.value?.type === 'string' ? entry.value.value : fields.module?.value || (fields.group && fields.name ? fields.group.value + ':' + fields.name.value : null);
      const split = coord?.split(':') || [];
      const plugin = entry.section === 'plugins';
      const dep = { path: file.path, line: entry.line, configuration: 'catalog', kind: plugin ? 'plugin' : 'catalog', alias: entry.key, group: plugin ? 'plugin' : split[0] || null, artifact: plugin ? fields.id?.value || null : split[1] || null, state: 'unresolved', version: null };
      const inlineComplete = entry.value?.value !== '{' || entry.ts.at(-1)?.value === '}';
      if (!inlineComplete) dep.reason = 'multiline or incomplete catalog declaration';
      else if (fields['version.ref']) {
        const own = versions.get(fields['version.ref'].value);
        Object.assign(dep, own ? { state: 'resolved', version: own.value, owner: own, variable: fields['version.ref'].value } : { reason: 'catalog version.ref not found' });
      } else if (fields.version && fields.version.simple && plainVersion(fields.version.value)) Object.assign(dep, { state: 'resolved', version: fields.version.value, owner: owner(file, fields.version, 'catalog-literal', entry.key) });
      else if (split.length === 3 && entry.value?.simple && plainVersion(split[2])) {
        const to = entry.value.to; Object.assign(dep, { state: 'resolved', version: split[2], owner: owner(file, { ...entry.value, from: to - split[2].length, value: split[2] }, 'catalog-literal', entry.key) });
      } else dep.reason = 'unsupported or absent catalog version';
      if (!dep.artifact || !dep.group) { dep.state = 'unresolved'; dep.reason = 'unsupported catalog module declaration'; delete dep.owner; }
      add(dep);
      const catalogName = path.posix.basename(file.path).replace('.versions.toml', '');
      const aliasKey = `${catalogName}.${plugin ? 'plugins.' : ''}${entry.key.replace(/[-_.]+/g, '.')}`;
      if (!catalogs.has(aliasKey)) catalogs.set(aliasKey, []);
      catalogs.get(aliasKey).push(dep);
    }
  }
  const catalogFor = (alias, file) => {
    const catalogCandidates = (catalogs.get(alias) || []).map(dep => { const root = path.posix.dirname(path.posix.dirname(dep.path)); return { dep, root, score: root === '.' ? 0 : root.length }; }).filter(c => c.root === '.' || file.path.startsWith(c.root + '/'));
    const nearest = Math.max(-1, ...catalogCandidates.map(c => c.score)), candidates = catalogCandidates.filter(c => c.score === nearest);
    return candidates.length === 1 ? candidates[0].dep : null;
  };
  const configurations = /^(?:api|implementation|compileOnly|runtimeOnly|compile|runtime|testImplementation|testCompileOnly|testRuntimeOnly|testCompile|annotationProcessor|kapt|ksp|classpath|developmentOnly|[A-Za-z]+Implementation|[A-Za-z]+Api)$/;
  for (const file of all.filter(f => /\.gradle(?:\.kts)?$/.test(f.path))) {
    const ts = file.tokens;
    for (let i = 0; i < ts.length; i++) {
      const call = ts[i];
      if (call.type !== 'word' || !configurations.test(call.value) || ts[i - 1]?.value === '.') continue;
      let j = i + 1; if (ts[j]?.value === '(') j++;
      const baseDep = { path: file.path, line: lineAt(file, call.start), configuration: call.value, kind: 'dependency' };
      // platform/enforcedPlatform share the declaration's version owner.
      if (['platform', 'enforcedPlatform'].includes(ts[j]?.value) && ts[j + 1]?.value === '(') j += 2;
      const t = ts[j]; if (!t) continue;
      if (t.type === 'string' && t.value.includes(':')) {
        const parts = t.value.split(':');
        const dep = { ...baseDep, group: parts[0], artifact: parts[1] || null, expression: t.value };
        const tail = ts[j + 1], computed = tail && ![')', '}', ',', ';', '{'].includes(tail.value) && !file.content.slice(t.end, tail.start).includes('\n');
        if (parts.length === 3 && t.simple && !computed) { const from = t.to - parts[2].length; Object.assign(dep, resolve(file, parts[2], owner(file, { ...t, from, value: parts[2] }))); }
        else Object.assign(dep, { version: null, state: 'unresolved', reason: parts.length < 3 ? 'version managed by platform or external declaration' : 'unsupported coordinate expression' });
        add(dep); continue;
      }
      if (t.value === 'project') { const arg = ts[j + 1]?.value === '(' ? ts[j + 2] : null; add({ ...baseDep, kind: 'project', artifact: arg?.type === 'string' ? arg.value : null, group: 'project', version: null, state: arg?.type === 'string' ? 'resolved' : 'unresolved', reason: 'internal project reference; no external version owner' }); continue; }
      if (t.value === 'libs' || /[A-Za-z]/.test(t.value[0] || '') && ts[j + 1]?.value === '.') {
        let alias = t.value, k = j + 1;
        while (ts[k]?.value === '.' && ts[k + 1]?.type === 'word') { alias += '.' + ts[k + 1].value; k += 2; }
        const catalog = catalogFor(alias, file);
        if (catalog) add({ ...catalog, ...baseDep, alias, catalogPath: catalog.path });
        else add({ ...baseDep, alias, group: null, artifact: null, version: null, state: 'unresolved', reason: 'catalog alias or computed dependency not resolved' });
        continue;
      }
      if (t.value === 'group') {
        const fields = {}; let versionIndex;
        for (let k = j; k < Math.min(ts.length, j + 35); k++) {
          if ([')', '}'].includes(ts[k].value) || file.content.slice(ts[k - 1]?.end || 0, ts[k].start).includes('\n')) break;
          if (['group', 'name', 'version'].includes(ts[k].value) && [':', '='].includes(ts[k + 1]?.value)) { fields[ts[k].value] = ts[k + 2]; if (ts[k].value === 'version') versionIndex = k + 2; }
        }
        const v = fields.version, tail = ts[versionIndex + 1], computed = tail && ![')', ',', ';', '}'].includes(tail.value) && !file.content.slice(v?.end || 0, tail.start).includes('\n');
        const raw = computed ? null : v?.type === 'string' ? v.value : v?.value ? '$' + v.value : null;
        add({ ...baseDep, group: fields.group?.value || null, artifact: fields.name?.value || null, expression: raw, ...resolve(file, raw, v?.type === 'string' ? owner(file, v) : undefined) }); continue;
      }
      // Every detected configuration has a row, including unsupported expressions.
      add({ ...baseDep, group: null, artifact: null, expression: t.value, version: null, state: 'unresolved', reason: 'computed dependency declaration' });
    }
    for (let i = 0; i < ts.length; i++) {
      if (ts[i].value === 'alias' && ts[i + 1]?.value === '(') {
        let j = i + 2, alias = ts[j]?.value;
        while (ts[j + 1]?.value === '.' && ts[j + 2]?.type === 'word') { alias += '.' + ts[j + 2].value; j += 2; }
        const catalog = catalogFor(alias, file), common = { path: file.path, line: lineAt(file, ts[i].start), configuration: 'plugin', kind: 'plugin', alias };
        add(catalog ? { ...catalog, ...common, catalogPath: catalog.path } : { ...common, group: null, artifact: null, state: 'unresolved', version: null, reason: 'plugin catalog alias not resolved' });
        continue;
      }
      if (!['id', 'kotlin'].includes(ts[i].value)) continue;
      let j = i + 1; if (ts[j]?.value === '(') j++;
      const id = ts[j]; if (id?.type !== 'string') continue;
      j++; if (ts[j]?.value === ')') j++;
      if (ts[j]?.value !== 'version') continue;
      j++; if (ts[j]?.value === '(') j++;
      const v = ts[j], tail = ts[j + 1], computed = tail && ![')', '}', ';'].includes(tail.value) && !file.content.slice(v?.end || 0, tail.start).includes('\n');
      add({ path: file.path, line: lineAt(file, ts[i].start), configuration: 'plugin', kind: 'plugin', group: 'plugin', artifact: ts[i].value === 'kotlin' ? 'org.jetbrains.kotlin.' + id.value : id.value, ...resolve(file, computed ? null : v?.type === 'string' ? v.value : '$' + v?.value, v?.type === 'string' ? owner(file, v) : undefined) });
    }
  }
  for (const dep of dependencies) { if (!dep.group || !dep.artifact) { dep.state = 'unresolved'; delete dep.owner; } dep.coordinate = dep.group && dep.artifact ? `${dep.group}:${dep.artifact}` : null; dep.id = digest(JSON.stringify([dep.path, dep.line, dep.configuration, dep.coordinate, dep.alias, dep.expression])).slice(0, 20); }
  for (const file of all) if (file.path.endsWith('.toml') && /\n\s*\[libraries\]/.test(file.content) && !dependencies.some(d => d.path === file.path)) issues.push({ path: file.path, reason: 'No supported single-line catalog declarations' });
  return { dependencies, definitions, issues, coverage: 'Static declarations only; build logic, external catalogs, rich versions and dependency resolution are not executed.' };
}

function snapshotFile(revision) { if (!/^[a-f0-9]{64}$/.test(revision || '')) throw invalid('Use a Gradle inventory revision'); return path.join(base(), 'revisions', revision + '.json'); }
function load(revision) { const result = readJson(snapshotFile(revision)); if (!result) throw invalid('Gradle inventory revision not found in this task'); return result; }
function list() {
  const latest = readJson(path.join(base(), 'latest.json'), {});
  return { repositories: Object.values(latest).sort((a, b) => a.repo.localeCompare(b.repo)), revisions: fs.existsSync(path.join(base(), 'revisions')) ? fs.readdirSync(path.join(base(), 'revisions')).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).map(f => { const x = readJson(path.join(base(), 'revisions', f)); return { revision: x.revision, repo: x.repo, sha: x.sha, files: x.files.length, dependencies: x.dependencies.length, indexedAt: x.indexedAt }; }) : [] };
}
function search({ q = '', dependency, repos = [], history = false, limit = 300 } = {}) {
  const catalog = list(), selected = history ? catalog.revisions : catalog.repositories, rows = [];
  if (typeof q !== 'string' || q.length > 1000) throw invalid('Use a bounded dependency search');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), cap = Math.max(1, Math.min(500, Number(limit) || 300));
  let total = 0;
  for (const item of selected) {
    require('./execution').check();
    if (repos.length && !repos.some(r => r.toLowerCase() === item.repo.toLowerCase())) continue;
    const snapshot = load(item.revision);
    for (const dep of snapshot.dependencies) {
      if (dependency && dep.coordinate !== dependency) continue;
      const searchable = [item.repo, dep.coordinate, dep.version, dep.alias, dep.path, dep.reason, dep.owner?.key].join(' ').toLowerCase();
      if (!words.every(word => searchable.includes(word))) continue;
      total++; if (rows.length < cap) rows.push({ repo: snapshot.repo, sha: snapshot.sha, revision: snapshot.revision, ...dep });
    }
  }
  return { rows, total, truncated: total > rows.length, history, indexedRepositories: selected.length, note: 'Cached immutable sources only; no network, fetch or build evaluation.' };
}
// One cat-file process per repository, for all build files. Binary framing respects UTF-8 and newlines.
function gitObjects(dir, oids) {
  return new Promise((resolve, reject) => {
    const child = require('./trace').child(execFile('git', ['cat-file', '--batch'], { cwd: dir, encoding: 'buffer', maxBuffer: MAX_BYTES + MAX_FILES * 100, timeout: 60000, signal: require('./execution').signal() }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const result = []; let at = 0;
        for (const oid of oids) { const end = stdout.indexOf(10, at), header = stdout.subarray(at, end).toString('ascii').split(' '), size = Number(header[2]); if (header[0] !== oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size > MAX_FILE) throw invalid('Invalid or oversized Gradle Git blob'); const bytes = stdout.subarray(end + 1, end + 1 + size); if (bytes.length !== size) throw invalid('Incomplete Gradle Git blob'); result.push(bytes); at = end + 2 + size; }
        resolve(result);
      } catch (e) { reject(e); }
    }));
    child.stdin.end(oids.join('\n') + '\n');
  });
}
async function indexRepo(spec, { git = G, internalGroups = require('./config').getPersonal().internalGroups } = {}) {
  G.validateRepo(spec.project, spec.repo);
  const repo = `${spec.project.toUpperCase()}/${spec.repo}`;
  const extraction = digest(JSON.stringify({ format: FORMAT, internalGroups }));
  const cached = sha => { const revision = digest(JSON.stringify([repo, sha.toLowerCase(), extraction])); const found = readJson(snapshotFile(revision)); return found ? { ...found, reused: true } : null; };
  if (/^[a-f0-9]{40}$/i.test(spec.ref || '')) { const previous = cached(spec.ref); if (previous) return previous; }
  const info = await git.fetchRef(spec.project, spec.repo, spec.ref, spec.url ? { url: spec.url } : {});
  const sha = info.sha.toLowerCase(), previous = cached(sha);
  if (previous) { setLatest(previous, spec.ref); return previous; }
  const raw = await git.git(['ls-tree', '-r', '-z', '--long', sha], info.path);
  const records = raw.split('\0').filter(Boolean).map(line => { const m = line.match(/^(\d+) blob ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/); return m && { mode: m[1], oid: m[2], bytes: Number(m[3]), path: m[4] }; }).filter(r => r && isBuild(r.path));
  if (records.length > MAX_FILES || records.some(r => r.bytes > MAX_FILE) || records.reduce((n, r) => n + r.bytes, 0) > MAX_BYTES) throw invalid('Gradle inventory exceeds bounded source budget');
  const safe = records.filter(r => /^100(?:644|755)$/.test(r.mode));
  const blobs = safe.length ? await gitObjects(info.path, safe.map(r => r.oid)) : [];
  const files = safe.map((r, i) => { let content; try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blobs[i]); } catch { throw invalid(`Gradle source is not UTF-8: ${r.path}`); } return { path: r.path, oid: r.oid, revision: digest(blobs[i]), bytes: blobs[i].length, content }; });
  const revision = digest(JSON.stringify([repo, sha, extraction]));
  const parsed = parseFiles(files, { internalGroups });
  const result = { format: FORMAT, revision, repo, sha, ref: spec.ref || null, indexedAt: new Date().toISOString(), readStats: { treeProcesses: 1, batchProcesses: safe.length ? 1 : 0, blobs: safe.length }, files, ...parsed, issues: [...parsed.issues, ...records.filter(r => !safe.includes(r)).map(r => ({ path: r.path, reason: 'Symlink or non-regular Git source was excluded' }))] };
  const target = snapshotFile(revision); fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.writeFileSync(target, JSON.stringify(result, null, 2), { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; return { ...load(revision), reused: true }; }
  setLatest(result, spec.ref); return result;
}
function setLatest(result, ref) { const file = path.join(base(), 'latest.json'), current = readJson(file, {}); current[result.repo] = { revision: result.revision, repo: result.repo, sha: result.sha, ref: ref || null, files: result.files.length, dependencies: result.dependencies.length, unresolved: result.dependencies.filter(d => d.state !== 'resolved').length, indexedAt: result.indexedAt }; writeJson(file, current); }
const summary = result => ({ revision: result.revision, repo: result.repo, sha: result.sha, reused: !!result.reused, readStats: result.readStats, files: result.files.map(f => ({ path: f.path, bytes: f.bytes, revision: f.revision })), dependencies: result.dependencies, issues: result.issues, coverage: result.coverage });
async function index({ repos, ref, log = () => {}, git, atl = require('./atlassian') } = {}) {
  const specs = repos?.length ? repos.map(r => { if (typeof r === 'string') { const parts = r.split('/'); if (parts.length !== 2) throw invalid('Repository selectors must be PROJECT/repo'); return { project: parts[0], repo: parts[1], ref }; } return { ...r, ref: r.ref || ref }; }) : (await atl.repos()).map(r => ({ project: r.project, repo: r.repo, ref }));
  if (specs.length > 2000) throw invalid('At most 2000 repositories per inventory job');
  const results = await pool(specs, 3, async spec => { require('./execution').check(); log(`${spec.project}/${spec.repo}: collecting all Gradle sources`); return summary(await indexRepo(spec, { git: git || G })); });
  return { repositories: results.map(r => r.error ? { repo: `${r.item.project}/${r.item.repo}`, error: require('./redact').clean(r.error.message) } : r.value), counts: { total: specs.length, indexed: results.filter(r => !r.error && !r.value.reused).length, reused: results.filter(r => r.value?.reused).length, failed: results.filter(r => r.error).length } };
}
function plan({ revision, dependency, version } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}$/.test(version || '')) throw invalid('Use a literal dependency version (no interpolation or dynamic selectors)');
  const snapshot = load(revision), selected = snapshot.dependencies.filter(d => d.coordinate === dependency || d.id === dependency);
  if (!selected.length) throw invalid('Dependency is not present in this inventory revision');
  const blocked = selected.filter(d => d.state !== 'resolved' || !d.owner).map(d => ({ id: d.id, path: d.path, line: d.line, reason: d.reason || 'No editable external version owner' }));
  const owners = [...new Map(selected.filter(d => d.state === 'resolved' && d.owner).map(d => [`${d.owner.path}:${d.owner.from}:${d.owner.to}`, d.owner])).values()];
  const changes = owners.filter(o => o.value !== version).map(o => ({ ...o, replacement: version, affected: snapshot.dependencies.filter(d => d.owner?.path === o.path && d.owner?.from === o.from && d.owner?.to === o.to).map(d => ({ coordinate: d.coordinate, path: d.path, line: d.line, alias: d.alias })) }));
  const files = [...new Set(changes.map(c => c.path))].map(name => { const original = snapshot.files.find(f => f.path === name); let content = original.content; const edits = changes.filter(c => c.path === name).sort((a, b) => b.from - a.from); for (const edit of edits) { if (content.slice(edit.from, edit.to) !== edit.value) throw invalid('Version owner source mismatch'); content = content.slice(0, edit.from) + version + content.slice(edit.to); } return { path: name, expected_revision: original.revision, content }; });
  const value = { repo: snapshot.repo, sha: snapshot.sha, revision, dependency, version, changes, blocked, files, applicable: blocked.length === 0 && changes.length > 0, createdAt: new Date().toISOString(), owner: require('./access').owner() };
  value.id = digest(JSON.stringify(value)); writeJson(path.join(base(), 'plans', value.id + '.json'), value);
  return { ...value, files: files.map(f => ({ path: f.path, expected_revision: f.expected_revision, content: f.content })), note: 'Review every affected declaration. Shared ownership changes all listed consumers. apply must be explicit and only edits a matching owned workspace.' };
}
async function apply({ plan: id, workspace } = {}) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw invalid('Use a saved dependency bump plan id');
  const file = path.join(base(), 'plans', id + '.json'), value = readJson(file);
  if (!value) throw invalid('Bump plan not found in this task'); require('./access').assertOwner(value.owner);
  if (!value.applicable) throw invalid('This plan has unresolved owners or no changes; review and create a new plan');
  const W = require('./workspace'), E = require('./workspace-editor'), meta = W.checkId(workspace);
  if (`${meta.project}/${meta.repo}` !== value.repo || meta.sha !== value.sha || await G.git(['rev-parse', 'HEAD'], meta.path) !== value.sha) throw invalid('Workspace repository and checked-out commit must match the planned inventory SHA');
  // All paths and revisions are checked before the first synchronous save; no await within writes.
  const originals = value.files.map(change => { const before = E.read(workspace, change.path); if (before.revision !== change.expected_revision) throw Object.assign(new Error(`Workspace file changed: ${change.path}; create a fresh inventory/plan`), { code: 'DT_WORKSPACE_CONFLICT', statusCode: 409 }); return before; });
  require('./execution').check();
  const written = [];
  try { for (const change of value.files) written.push(E.save(workspace, change.path, change.content, change.expected_revision)); }
  catch (error) {
    // Restore only our exact bytes; never overwrite an independent writer's change during rollback.
    const restored = [], incomplete = [];
    for (const before of originals) {
      try {
        const current = E.read(workspace, before.path), intended = value.files.find(f => f.path === before.path);
        if (current.revision === before.revision) continue;
        if (current.revision !== digest(Buffer.from(intended.content))) { incomplete.push({ path: before.path, reason: 'changed independently; preserved' }); continue; }
        E.save(workspace, before.path, before.content, current.revision); restored.push(before.path);
      } catch (failure) { incomplete.push({ path: before.path, reason: require('./redact').clean(failure.message) }); }
    }
    return { plan: id, workspace, applied: false, outcome: 'failed', error: require('./redact').clean(error.message), rollback: { complete: !incomplete.length, restored, incomplete }, written: incomplete.length ? written : [], note: incomplete.length ? 'Some files may retain changes. Inspect listed paths before retrying.' : 'Original workspace source was restored. Resolve the save failure before retrying.' };
  }
  return { plan: id, workspace, repo: value.repo, sha: value.sha, applied: true, written, changes: value.changes, note: 'Only workspace files changed. Build, commit and push remain explicit actions.' };
}
module.exports = { tokens, parseFiles, indexRepo, index, list, search, load, summary, plan, apply, isBuild, FORMAT };
