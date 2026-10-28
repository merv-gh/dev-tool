// Read-only Confluence mirror. No remote writes; all search/evidence can run offline afterwards.
const fs = require('fs');
const path = require('path');
const { CACHE, readJson, writeJson } = require('./util');
const { parse, hash } = require('./docs-parse');
const DIR = path.join(CACHE, 'confluence');
const segment = (s) => { if (!/^[\w-]+$/.test(String(s))) throw new Error(`Invalid Confluence cache identifier: ${s}`); return String(s); };
const file = (space, kind, id) => path.join(DIR, segment(space), kind, `${segment(id)}.json`);
const config = () => require('./config').getPersonal().confluence;
const memo = new Map();
function readPage(file) {
  try { const stat = fs.statSync(file), signature = `${stat.mtimeMs}:${stat.size}`, old = memo.get(file); if (old?.signature === signature) return old.page; const page = readJson(file); memo.set(file, { signature, page }); return page; }
  catch { memo.delete(file); return null; }
}
const spacesOf = (spaces) => [...new Set((Array.isArray(spaces) ? spaces : String(spaces || '').split(',')).map(s => String(s).trim()).filter(Boolean).map(segment))];

function list(spaces) {
  let dirs = [];
  try { dirs = fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !['attachments', 'index'].includes(d.name)).map(d => d.name); } catch {}
  const selected = spacesOf(spaces);
  return dirs.filter(s => !selected.length || selected.includes(s)).flatMap(s => {
    let files = []; try { files = fs.readdirSync(path.join(DIR, s, 'pages')); } catch {}
    return files.filter(f => f.endsWith('.json')).map(f => readPage(path.join(DIR, s, 'pages', f))).filter(Boolean);
  });
}
function status() {
  const cfg = config(), summary = readJson(path.join(DIR, '_summary.json'), {}), state = readJson(path.join(DIR, '_state.json'), {});
  return { configured: !!(cfg.url && cfg.token), count: summary.pages || 0, blocks: summary.blocks || 0, syncedAt: Object.values(state.spaces || {}).map(s => s.syncedAt).filter(Boolean).sort().at(-1) || null, spaces: Object.keys(state.spaces || {}) };
}
function page(id, { space, section, version } = {}) {
  segment(id);
  let candidates = list(space).filter(p => p.id === String(id));
  if (!candidates.length && version !== undefined) {
    let spaces = spacesOf(space);
    if (!spaces.length) { try { spaces = fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !['attachments', 'index'].includes(d.name)).map(d => d.name); } catch {} }
    candidates = spaces.map(s => readJson(file(s, path.join('versions', segment(id)), version))).filter(Boolean);
  }
  if (!candidates.length) throw new Error(`Confluence page ${id} is not cached; call catalog_sync what=confluence`);
  if (candidates.length > 1) throw new Error(`Page ${id} is ambiguous; specify space`);
  let p = candidates[0];
  if (version !== undefined && Number(version) !== Number(p.version)) p = readJson(file(p.space, path.join('versions', segment(id)), version));
  if (!p) throw new Error(`Confluence page ${id} version ${version} is not cached`);
  let blocks = p.blocks || readJson(file(p.space, 'blocks', p.id), []);
  if (section) {
    const match = blocks.find(b => b.id === section || b.kind === 'heading' && (b.text === section || b.path.join(' / ') === section));
    const wanted = match?.path || String(section).split(/\s*[/>›]\s*/);
    blocks = blocks.filter(b => wanted.every((v, i) => b.path[i] === v));
    if (!blocks.length) throw new Error(`No section ${section} on page ${id}`);
  }
  const { storage, ...rest } = p;
  return { ...rest, blocks, text: blocks.map(b => b.text).join('\n'), diagrams: p.diagrams || [] };
}

function createClient(cfg = config()) {
  if (!cfg.url || !cfg.token) throw new Error('Confluence not configured: confluence.url and confluence.token are required');
  const base = new URL(cfg.url.replace(/\/$/, '') + '/');
  const kind = cfg.type || cfg.flavour;
  if (kind && !['cloud', 'server', 'dc'].includes(kind)) throw new Error('confluence.type must be server, dc or cloud');
  const cloud = kind ? kind === 'cloud' : !!cfg.user;
  if (cloud && !cfg.user) throw new Error('Confluence Cloud requires confluence.user (email) and token');
  const headers = { accept: 'application/json', authorization: cloud || !kind && cfg.user ? 'Basic ' + Buffer.from(`${cfg.user}:${cfg.token}`).toString('base64') : `Bearer ${cfg.token}` };
  const resolve = (p) => {
    // Confluence next/download links may be absolute, root-relative or relative to its context path.
    const root = base.pathname.replace(/\/$/, '');
    const u = new URL(/^https?:/.test(p) || p.startsWith(root + '/') ? p : root + '/' + p.replace(/^\//, ''), base);
    if (u.origin !== base.origin) throw new Error('Refusing cross-origin Confluence URL (credentials are never forwarded)');
    return u;
  };
  async function request(p, { binary = false, redirects = 0 } = {}) {
    if (redirects > 5) throw new Error('Confluence redirect limit exceeded');
    const u = resolve(p);
    for (let attempt = 0; ; attempt++) {
      await require('./limit').take('confluence');
      const res = await fetch(u, { headers, redirect: 'manual', signal: AbortSignal.timeout(cfg.timeoutMs || 30000) });
      if (res.status === 429 && attempt < 3) {
        const retry = res.headers.get('retry-after'), seconds = /^\d+$/.test(retry || '') ? Number(retry) : Math.max(1, (Date.parse(retry) - Date.now()) / 1000 || 1);
        if (seconds > 30) throw new Error('Confluence rate limited; Retry-After exceeds 30 seconds. Retry the sync later.');
        await new Promise(r => setTimeout(r, seconds * 1000)); continue;
      }
      if (res.status >= 300 && res.status < 400) {
        // Follow only same-origin locations. Cloud download endpoints sometimes redirect to signed CDN URLs;
        // these are fetched separately without the user's authorization header.
        const target = new URL(res.headers.get('location'), u);
        if (!binary || target.origin === base.origin) return request(target.href, { binary, redirects: redirects + 1 });
        if (target.protocol !== 'https:') throw new Error('Confluence attachment redirect must use HTTPS');
        const download = await fetch(target, { signal: AbortSignal.timeout(cfg.timeoutMs || 30000) });
        if (!download.ok) throw new Error(`Confluence attachment download: HTTP ${download.status}`);
        return bounded(download);
      }
      if (!res.ok) { const e = new Error(`Confluence ${u.pathname}: HTTP ${res.status}`); e.status = res.status; throw e; }
      if (binary) return bounded(res);
      const data = await res.json();
      if (!data._links?.next) { const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="?next"?/i)?.[1]; if (next) data._links = { ...data._links, next }; }
      return data;
    }
  }
  async function bounded(res) {
    const max = cfg.maxAttachmentBytes || 20 * 1024 * 1024;
    if (Number(res.headers.get('content-length')) > max) throw new Error(`Confluence attachment exceeds ${max} bytes`);
    const chunks = []; let size = 0;
    for await (const chunk of res.body) { size += chunk.length; if (size > max) { await res.body.cancel().catch(() => {}); throw new Error(`Confluence attachment exceeds ${max} bytes`); } chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function all(p) {
    const out = [], seen = new Set();
    while (p) {
      const key = resolve(p).href;
      if (seen.has(key)) throw new Error('Confluence pagination loop'); seen.add(key);
      if (seen.size > 10000) throw new Error('Confluence pagination exceeds 10000 pages');
      const d = await request(p); out.push(...(d.results || [])); p = d._links?.next;
      if (!p && d.size && d.limit && d.size >= d.limit && d.totalSize > out.length) { const u = new URL(key); u.searchParams.set('start', String((d.start || 0) + d.size)); p = u.href; }
    }
    return out;
  }
  const q = (s) => encodeURIComponent(s);
  async function listing(space, since) {
    if (since) {
      // CQL timestamps use the authenticated account's timezone, not UTC. With an explicit timezone
      // use a two-minute overlap. Otherwise use a conservative calendar-day window (still version-skipped).
      let after;
      if (cfg.timezone) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.parse(since) - 120000)).map(p => [p.type, p.value]));
        after = JSON.stringify(`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`);
      } else after = `startOfDay("-${Math.max(1, Math.ceil((Date.now() - Date.parse(since)) / 86400000) + 1)}d")`;
      return all(`/rest/api/content/search?limit=100&expand=version,space&cql=${q(`type = page and status = current and space = ${JSON.stringify(space)} and lastmodified >= ${after}`)}`);
    }
    if (!cloud) return all(`/rest/api/content?type=page&status=current&spaceKey=${q(space)}&expand=version,space&limit=100`);
    const spaces = await all(`/api/v2/spaces?keys=${q(space)}&limit=100`), sp = spaces.find(s => s.key === space);
    if (!sp) throw new Error(`Confluence space ${space} not found or not readable`);
    return all(`/api/v2/spaces/${q(sp.id)}/pages?status=current&limit=100`);
  }
  async function fetchAttachments(id) {
    const attachments = await all(cloud ? `/api/v2/pages/${q(segment(id))}/attachments?limit=100` : `/rest/api/content/${q(segment(id))}/child/attachment?expand=version&limit=100`);
    return attachments.map(a => ({ id: String(a.id), title: a.title, version: a.version?.number || 1, mediaType: a.mediaType || a.metadata?.mediaType, download: a.downloadLink || a._links?.download, size: a.fileSize || a.extensions?.fileSize }));
  }
  async function fetchPage(id, space) {
    id = segment(id);
    const p = await request(cloud ? `/api/v2/pages/${q(id)}?body-format=storage&include-labels=true` : `/rest/api/content/${q(id)}?expand=body.storage,version,ancestors,metadata.labels,space`);
    const attachments = await fetchAttachments(id);
    let ancestors = p.ancestors || [];
    if (cloud) ancestors = await all(`/api/v2/pages/${q(id)}/ancestors?limit=100`);
    let labels = p.metadata?.labels?.results || p.labels?.results || [];
    if (p.labels?._links?.next) labels = labels.concat(await all(p.labels._links.next));
    if (!cloud) labels = await all(`/rest/api/content/${q(id)}/label?limit=100`);
    const url = p._links?.webui ? resolve(p._links.webui).href : resolve(`/pages/viewpage.action?pageId=${q(id)}`).href;
    return { id: String(p.id), space: p.space?.key || space, title: p.title, version: p.version?.number || 1, modified: p.version?.when || p.version?.createdAt, ancestors: ancestors.map(a => ({ id: String(a.id), title: a.title })), parentId: p.parentId, labels: labels.map(l => l.name || l.label), url, storage: p.body?.storage?.value || '', attachments };
  }
  return { cfg, cloud, request, all, listing, fetchPage, fetchAttachments };
}

async function attach(p, previous, client) {
  const diagrams = [], errors = [];
  for (const a of p.attachments) {
    const old = previous?.attachments?.find(x => x.id === a.id && x.version === a.version);
    const binary = /drawio|\.xml$|\.gliffy$|\.puml$|\.plantuml$|\.mmd$|\.mermaid$|\.svg$|\.(png|jpe?g|gif|webp)$/i.test(a.title) || /image\//.test(a.mediaType || '');
    if (!binary || !a.download) continue;
    try {
      let data;
      if (old?.hash && fs.existsSync(path.join(DIR, 'attachments', old.hash))) { a.hash = old.hash; data = fs.readFileSync(path.join(DIR, 'attachments', a.hash)); }
      else { data = await client.request(a.download, { binary: true }); a.hash = hash(data); const f = path.join(DIR, 'attachments', a.hash); fs.mkdirSync(path.dirname(f), { recursive: true }); if (!fs.existsSync(f)) fs.writeFileSync(f, data); }
      const format = /drawio|\.xml$/i.test(a.title) ? 'drawio' : /gliffy/i.test(a.title) ? 'gliffy' : /\.svg$/i.test(a.title) ? 'svg' : /puml|plantuml/i.test(a.title) ? 'plantuml' : /mmd|mermaid/i.test(a.title) ? 'mermaid' : null;
      if (format) diagrams.push({ attachment: a.title, attachmentVersion: a.version, blockId: p.blocks.find(b => b.filename === a.title)?.id, hash: a.hash, format, provenance: 'docs:diagram', ...require('./diagrams').parseDiagram(format, data.toString()) });
      else {
        const caption = p.images.find(i => i.filename === a.title)?.caption || '';
        const image = { attachment: a.title, attachmentVersion: a.version, blockId: p.blocks.find(b => b.filename === a.title)?.id, hash: a.hash, format: 'image', caption, context: p.blocks.filter(b => b.kind !== 'code').slice(Math.max(0, p.blocks.findIndex(b => b.filename === a.title) - 1), p.blocks.findIndex(b => b.filename === a.title) + 2).map(b => b.text).join('\n'), provenance: 'docs:image', vision: false };
        if (client.cfg.vision) Object.assign(image, await require('./docs-search').vision(data, a, client.cfg));
        diagrams.push(image);
      }
    } catch (e) { errors.push({ attachment: a.title, error: e.message }); }
  }
  for (const b of p.blocks.filter(b => b.kind === 'diagram' && /plantuml|mermaid/.test(b.format))) {
    try { diagrams.push({ blockId: b.id, format: b.format, source: b.text, provenance: 'docs:diagram', ...require('./diagrams').parseDiagram(b.format, b.text) }); } catch (e) { errors.push({ blockId: b.id, error: e.message }); }
  }
  return { diagrams, attachmentErrors: errors };
}

async function doSync({ spaces, full = false, log = () => {}, client = createClient() } = {}) {
  const chosen = spacesOf(spaces || client.cfg.spaces);
  if (!chosen.length) throw new Error('Specify confluence.spaces or catalog_sync spaces (comma-separated space keys)');
  const stateFile = path.join(DIR, '_state.json'), state = readJson(stateFile, { spaces: {} });
  if (state.source && state.source !== client.cfg.url) throw new Error('Confluence URL differs from this cache. Use a separate DT_CACHE_DIR for another Confluence site.');
  state.source = client.cfg.url; state.spaces ||= {};
  const results = [];
  for (const space of chosen) {
    const started = new Date().toISOString(), oldState = state.spaces[space] || {}, reconcile = full || !oldState.reconciledAt || Date.now() - Date.parse(oldState.reconciledAt) >= 86400000;
    const entries = await client.listing(space, reconcile ? null : oldState.syncedAt), ids = new Set(entries.map(p => String(p.id)));
    let updated = 0, unchanged = 0, deleted = 0; const errors = [];
    for (const entry of entries) {
      const id = segment(entry.id), old = readJson(file(space, 'pages', id));
      try {
        if (old && Number(entry.version?.number) === old.version && !full && !(old.attachmentErrors || []).length) {
          // Attachments have independent versions. Check their metadata without downloading page bodies.
          const attachments = await client.fetchAttachments(id);
          const signature = list => list.map(a => `${a.id}:${a.version}`).sort().join('|');
          if (signature(attachments) === signature(old.attachments || [])) { unchanged++; continue; }
          const p = { ...old, attachments, syncedAt: started };
          Object.assign(p, await attach(p, old, client)); writeJson(file(space, 'pages', id), p);
          errors.push(...p.attachmentErrors.map(e => ({ id, stage: 'attachment', ...e }))); updated++; continue;
        }
        const fresh = await client.fetchPage(id, space);
        if (fresh.space !== space) continue; // moved during synchronization; daily inventory reconciles it
        const parsed = parse(fresh, old?.blocks || []), p = { ...fresh, ...parsed, syncedAt: started };
        Object.assign(p, await attach(p, old, client));
        errors.push(...p.attachmentErrors.map(e => ({ id, stage: 'attachment', ...e })));
        if (client.cfg.extractRelations) {
          try { p.inferredRelations = await require('./docs-search').inferRelations(p); }
          catch (e) { p.enrichmentErrors = [{ enrichment: 'relations', error: e.message }]; }
        }
        if (old) writeJson(file(space, path.join('versions', id), old.version), old);
        writeJson(file(space, 'blocks', id), p.blocks); writeJson(file(space, 'pages', id), p);
        updated++; log(`confluence ${space}/${id}: v${p.version} (${p.blocks.length} blocks)`);
      } catch (e) { errors.push({ id, error: e.message }); }
    }
    if (reconcile) for (const old of list([space])) if (!ids.has(old.id)) {
      writeJson(file(space, path.join('versions', old.id), old.version), old);
      fs.rmSync(file(space, 'pages', old.id), { force: true }); fs.rmSync(file(space, 'blocks', old.id), { force: true }); deleted++;
    }
    if (!errors.length) { state.spaces[space] = { ...oldState, syncedAt: started, ...(reconcile ? { reconciledAt: started } : {}) }; writeJson(stateFile, state); }
    results.push({ space, mode: reconcile ? 'full' : 'incremental', updated, unchanged, deleted, errors });
  }
  const index = await require('./docs-search').build();
  return { spaces: results, index, syncedAt: new Date().toISOString() };
}

let pending = Promise.resolve();
function sync(options) {
  const work = pending.then(() => doSync(options));
  pending = work.catch(() => {});
  return work;
}

module.exports = { DIR, config, spacesOf, list, page, status, sync, createClient };
