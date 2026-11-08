// Revision-safe orchestration. Heavy work runs in the optional bundled semantic-worker container.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const C = require('./config'), A = require('./access'), E = require('./execution'), P = require('./semantic-protocol');
const { readJson, writeJson } = require('./util');
const base = () => A.scopedDirectory(path.join(C.PATHS.cache, 'semantic'));
const config = () => C.getSemantic();
const analysisPath = id => { if (!P.ID.test(id || '')) throw P.error('Invalid semantic analysis id'); return path.join(base(), 'analyses', id); };
const summary = ({ root, dir, bindings, owner, sources, ...m }) => ({ ...m, ...(sources ? { sources: sources.map(({root,...s})=>s) } : {}) });
function capabilities() {
  const cfg = config(), info = readJson(path.join(base(), 'worker.json'));
  return { protocol: P.VERSION, configured: !!(cfg.url && cfg.token), backend: 'vendored-joern', languages: ['java','js','ts','tsx'],
    operations: ['symbols','callers','callees','ports','neighborhood','paths','slice','assertions','compare','flowmap'],
    retainedGenerations: true, editablePorts: true, ...(info ? { worker: info } : {}),
    note: 'Named semantic queries use retained revisions. Native code_search remains available without Joern. Configure semantic.url and semantic.token to parse.' };
}
function load(id) {
  const dir = analysisPath(id), manifest = readJson(path.join(dir, 'manifest.json'));
  if (!manifest || !A.visible(manifest.owner)) throw P.error('Semantic analysis is not available in this story', 'DT_NOT_FOUND', 404);
  return { ...manifest, dir, bindings: manifest.dependencies || [] };
}
function list(args = {}) {
  const dir = path.join(base(), 'analyses'); let names = []; try { names = fs.readdirSync(dir); } catch {}
  let analyses = names.filter(name => P.ID.test(name)).flatMap(name => { try { return [load(name)]; } catch { return []; } });
  if (args.repo) analyses = analyses.filter(m => m.repo === args.repo || m.revisionKey === args.repo || m.repo?.split('/').pop() === args.repo);
  if (args.service) {
    const passport = require('./passport').load(args.service), keys = new Set([passport?.codeIndex, ...(passport?.libraries || []).map(l => l.index)].filter(Boolean));
    analyses = analyses.filter(m => keys.has(m.revisionKey) || m.service === args.service);
  }
  if (args.ref) analyses = analyses.filter(m => m.sha === args.ref || m.ref === args.ref);
  if (args.language) analyses = analyses.filter(m => m.language === args.language);
  if (!args.versions) {
    const aliases = path.join(base(), 'aliases'); let names = []; try { names = fs.readdirSync(aliases); } catch {}
    const ids = new Set(names.map(n => readJson(path.join(aliases, n))?.id)); analyses = analyses.filter(m => ids.has(m.id));
  }
  return { protocol: P.VERSION, analyses: analyses.map(summary).sort((a,b) => b.builtAt.localeCompare(a.builtAt)), total: analyses.length };
}
function resolve(args = {}) {
  if (args.revisionSet) {
    const set = /^[a-f0-9]{64}$/.test(args.revisionSet) && readJson(path.join(base(), 'sets', `${args.revisionSet}.json`));
    if (!set || !A.visible(set.owner)) throw P.error('Revision set is not available in this story', 'DT_NOT_FOUND', 404);
    return set.ids.map(load);
  }
  if (args.analysis || args.analyses?.length) return [].concat(args.analyses || args.analysis).map(load);
  const all = list({ ...args, versions: true }).analyses, current = new Set(list({ ...args, versions: false }).analyses.map(m => m.id));
  const selectors = String(args.repos || args.revisionKey || args.repo || '').split(',').filter(Boolean);
  let selected = all.filter(m => (!selectors.length || selectors.some(s => m.repo === s || m.revisionKey === s || m.id === s || m.repo.split('/').pop() === s)) && (!args.env || !m.env || m.env === args.env));
  selected=selected.filter(m=>!m.workspace||selectors.some(s=>s===m.revisionKey||s===m.id||s===`work/${m.workspace}`));
  if (args.service) { const passport = require('./passport').load(args.service), keys = new Set([passport?.codeIndex, ...(passport?.libraries || []).map(l => l.index)].filter(Boolean)); if (keys.size) selected = selected.filter(m => keys.has(m.revisionKey)); }
  const latest = new Map(); for (const m of selected) { const k = `${m.repo}:${m.language}`, old = latest.get(k); if (!old || current.has(m.id) && !current.has(old.id) || current.has(m.id) === current.has(old.id) && m.builtAt > old.builtAt) latest.set(k, m); }
  selected = [...latest.values()]; return selected.map(m => ({ ...load(m.id), ...(args.service ? { service: args.service } : {}) }));
}
function headers() { return { authorization: `Bearer ${config().token}`, 'x-dt-owner': Buffer.from(JSON.stringify(A.owner())).toString('base64url') }; }
async function request(route, options = {}) {
  const cfg = config();
  if (!cfg.url || !cfg.token) throw P.error('Configure semantic.url and semantic.token; native code_search is still available', 'DT_SEMANTIC_UNCONFIGURED', 503);
  const url = new URL(cfg.url);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw P.error('semantic.url must be an HTTP(S) service URL without credentials or query');
  const timeout = AbortSignal.timeout(options.timeoutMs || Math.min(12 * 3600000, Math.max(100, Number(cfg.timeoutMs || 30 * 60000))));
  const signal = options.detached ? timeout : E.signal() ? AbortSignal.any([E.signal(), timeout]) : timeout;
  const response = await fetch(url.toString().replace(/\/$/, '') + route, { ...options, redirect: 'error', signal, headers: { ...headers(), ...options.headers } });
  if (!response.ok) {
    let body = ''; for await (const chunk of response.body || []) { body += Buffer.from(chunk).toString(); if (body.length > 10000) break; }
    let error; try { error = JSON.parse(body).error; } catch {}
    throw P.error(error?.message || `Semantic worker HTTP ${response.status}`, error?.code || 'DT_SEMANTIC_BACKEND', response.status);
  }
  return response;
}
async function json(route, options) {
  const response = await request(route, options); let body = ''; const decoder = new TextDecoder();
  for await (const chunk of response.body) { body += decoder.decode(chunk, { stream: true }); if (Buffer.byteLength(body) > 1048576) throw P.error('Semantic status response too large', 'DT_SEMANTIC_LIMIT', 413); }
  return JSON.parse(body + decoder.decode());
}
async function cancelRemote(id) {
  await json(`/v1/jobs/${id}/cancel`, { method: 'POST', detached: true, timeoutMs: 5000 });
  const until = Date.now() + 10000;
  while (Date.now() < until) { const job = await json(`/v1/jobs/${id}`, { detached: true, timeoutMs: 3000 }); if (['ready','cancelled','failed','interrupted'].includes(job.state)) return; await new Promise(r => setTimeout(r, 100)); }
  throw P.error('Semantic worker did not finish cancellation cleanup', 'DT_SEMANTIC_CLEANUP', 504);
}
async function waitRemote(id, log = () => {}) {
  let previous;
  while (true) {
    E.check(); const job = await json(`/v1/jobs/${id}`);
    if (job.state !== previous) { log(`Joern ${job.state}`); previous = job.state; }
    if (job.state === 'ready') return job;
    if (['failed','cancelled','interrupted'].includes(job.state)) throw P.error(job.error || `Semantic job ${job.state}`, job.code || 'DT_SEMANTIC_EXECUTION', 500);
    await require('./limit').sleep(500, E.signal());
  }
}
async function locked(name, fn) {
  const dir = path.join(base(), 'locks'); fs.mkdirSync(dir, { recursive: true }); const lock = path.join(dir, name), until = Date.now() + 10000;
  while (true) {
    try { fs.mkdirSync(lock); writeJson(path.join(lock, 'owner.json'), { pid: process.pid, at: Date.now() }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = readJson(path.join(lock, 'owner.json'));
      if (owner && owner.pid !== process.pid) { try { process.kill(owner.pid, 0); } catch { fs.rmSync(lock, { recursive: true, force: true }); continue; } }
      if (Date.now() >= until) throw P.error('Semantic cache publication is busy', 'DT_SEMANTIC_BUSY', 409);
      await require('./limit').sleep(25, E.signal());
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
async function inputs(args) {
  const CI = require('./codeindex'); let keys = [], passport;
  // Internal collectors pin the complete closure before starting a detached job. Do not
  // resolve current passport aliases or expand newer dependency metadata in this path.
  if (args.sourceRevisions) {
    if (!Array.isArray(args.sourceRevisions) || !args.sourceRevisions.length) throw P.error('Pinned source revisions are required');
    keys = args.sourceRevisions.map(pin => {
      if (!pin || typeof pin.key !== 'string') throw P.error('Pinned semantic source revision is unavailable', 'DT_SEMANTIC_REVISION_MISSING', 404);
      const idx = CI.load(pin.key);
      if (!idx || !pin.repo || !/^[a-f0-9]{40}$/i.test(pin.sha || '') || idx.sha !== pin.sha || (idx.baseKey || idx.key.split('@')[0]) !== pin.repo || idx.revisionKey !== pin.key)
        throw P.error('Pinned semantic source revision is unavailable', 'DT_SEMANTIC_REVISION_MISSING', 404);
      return pin.key;
    });
  }
  else if (args.service) { passport = require('./passport').load(args.service); if (!passport?.codeIndex) throw P.error('Build the service passport first so exact service/library revisions are known', 'DT_SEMANTIC_SOURCE_MISSING', 409); keys = [passport.codeIndex, ...(passport.libraries || []).filter(l => l.index).map(l => l.index)]; }
  else {
    const selector = args.revisionKey || args.repos || (args.project && args.repo && !args.repo.includes('/') ? `${args.project.toUpperCase()}/${args.repo}` : args.repo);
    if (selector) keys = CI.select(selector);
    if (args.ref && !/^[a-f0-9]{40}$/i.test(args.ref)) {
      const target = args.project && args.repo && !args.repo.includes('/') ? { project: args.project, repo: args.repo } : typeof selector === 'string' && /^[^/@]+\/[^/@]+$/.test(selector) ? { project: selector.split('/')[0], repo: selector.split('/')[1] } : null;
      if (!target) throw P.error('A branch/tag needs one repository so it can resolve to an exact SHA');
      const source = await require('./git').fetchRef(target.project, target.repo, args.ref);
      const indexed = CI.build(source.path, `${source.project}/${target.repo}`, { project: source.project, repo: target.repo, ref: source.ref, sha: source.sha }); keys = [indexed.revisionKey || indexed.key];
    }
    if (args.ref && /^[a-f0-9]{40}$/i.test(args.ref)) keys = keys.flatMap(k => CI.revisions(CI.load(k)?.baseKey || k, args.ref).map(i => i.revisionKey));
    if (!keys.length && args.project && args.repo && !args.revisionKey) {
      const source = await require('./git').fetchRef(args.project, args.repo, args.ref);
      const indexed = CI.build(source.path, `${source.project}/${args.repo}`, { project: source.project, repo: args.repo, ref: source.ref, sha: source.sha }); keys = [indexed.revisionKey || indexed.key];
    }
    if (!keys.length) throw P.error('No selected source snapshot. Use code_index or a service passport first', 'DT_SEMANTIC_SOURCE_MISSING', 404);
  }
  keys = args.sourceRevisions ? [...new Set(keys)] : CI.withLibraries(keys);
  const snapshots = keys.map(k => CI.load(k)).filter(Boolean).map(idx => {
    if (idx.workspace || String(idx.key).startsWith('work/')) { require('./workspace').index(String(idx.key).slice(5)); idx = CI.load(idx.key); }
    return { ...idx, key: idx.revisionKey || idx.key, repoName: idx.workspace && idx.project && idx.repo ? `${idx.project}/${idx.repo}` : idx.baseKey || String(idx.key).split('@')[0] };
  });
  if (args.ref && args.service && snapshots[0]?.sha !== args.ref && snapshots[0]?.ref !== args.ref) throw P.error('Requested revision does not match the pinned service passport', 'DT_SEMANTIC_REVISION_MISSING', 404);
  const dependencies = [];
  for (const idx of snapshots) for (const lib of idx.libs || []) {
    if (args.sourceRevisions && !keys.includes(lib.index)) continue;
    const target = CI.load(lib.index), declared = passport?.libraries?.find(l=>l.index===lib.index) || args.sourceRevisions?.find(l=>l.key===lib.index);
    const exact = declared ? declared.exactVersion === true : lib.exactVersion === true;
    if (target) dependencies.push({ fromRepo: idx.repoName, fromSha: idx.sha, toRepo: target.baseKey || String(target.key).split('@')[0], toSha: target.sha, artifact: lib.artifactId || lib.library, version: lib.version, evidence: exact ? 'pinned-index' : 'approximate', exact });
  }
  if (passport) for (const lib of passport.libraries || []) { const target = CI.load(lib.index); if (target) dependencies.push({ fromRepo: snapshots[0].repoName, fromSha: snapshots[0].sha, toRepo: target.baseKey || String(target.key).split('@')[0], toSha: target.sha, artifact: lib.artifactId, version: lib.version, evidence: lib.exactVersion === true ? 'passport' : 'approximate', exact: lib.exactVersion === true }); }
  if (args.sourceRevisions) for (const lib of args.sourceRevisions.slice(1)) dependencies.push({ fromRepo: snapshots[0].repoName, fromSha: snapshots[0].sha, toRepo: lib.repo, toSha: lib.sha, artifact: lib.artifactId, version: lib.version, evidence: lib.exactVersion === true ? 'passport' : 'approximate', exact: lib.exactVersion === true });
  return { snapshots, dependencies };
}
async function* upload(source, metadata) {
  yield JSON.stringify({ type: 'request', protocol: P.VERSION, ...metadata }) + '\n';
  for (const f of source.list) { E.check(); const rel = P.relative(f.path), target = f.sourcePath || path.join(source.root, rel); const st = fs.lstatSync(target); if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1048576) throw P.error('Source snapshot contains unsupported file'); yield JSON.stringify({ type: 'file', path: rel, content: fs.readFileSync(target).toString('base64') }) + '\n'; }
  yield '{"type":"end"}\n';
}
async function buildOne(source, language, args, info, dependencies, log) {
  const lifecycle = require('./state-machine').create(require('./lifecycles').semanticPublication);
  dependencies = dependencies.filter(d => d.fromRepo === source.repoName && d.fromSha === source.sha);
  const sourceDigest = source.sourceDigest || P.digest(source.list.map(f => [f.path,P.digest(fs.readFileSync(path.join(source.root, f.path)))]));
  const stableDependencies = [...new Map(dependencies.map(({evidence,...d})=>[P.digest(d),d])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,d])=>d);
  const identity = { repo: source.repoName, sha: source.sha, sourceDigest, sources: source.sources?.map(({root,...s})=>s).sort((a,b)=>a.repo.localeCompare(b.repo)), language, image: info.image, version: info.version, enrichmentDigest: info.enrichmentDigest || info.scriptsDigest, dependencies: stableDependencies, protocol: P.VERSION };
  const key = P.digest(identity), alias = P.digest([source.workspace ? source.key : source.repoName, language]);
  let ticket = crypto.randomBytes(16).toString('hex'), resumed = false;
  const aliasFile = path.join(base(), 'aliases', `${alias}.json`), requestFile = path.join(base(), 'requests', `${alias}.json`);
  if (!args.reparse) {
    const cached = list({ versions: true }).analyses.filter(m => m.key === key).sort((a,b) => b.builtAt.localeCompare(a.builtAt))[0];
    if (cached) { lifecycle.to('reused'); log(`Reused ${source.repoName}@${source.sha} (${language})`); return { ...load(cached.id), reused: true }; }
    let candidates = []; try { candidates = fs.readdirSync(path.join(base(), 'analyses')).filter(n=>n.startsWith(key+'-')&&n.endsWith('.tmp')); } catch {}
    for (const name of candidates) {
      const attempt = readJson(path.join(base(), 'analyses', name, 'attempt.json'));
      if ((!attempt?.accepted && attempt?.state !== 'uploading') || !A.visible(attempt.owner)) continue;
      let alive = false; try { process.kill(attempt.processId, 0); alive = true; } catch {}
      if (alive) continue;
      const previous = await json(`/v1/jobs/${attempt.id}`).catch(()=>null);
      if (previous && !['failed','cancelled','interrupted'].includes(previous.state)) { ticket = attempt.ticket; resumed = true; log(`Rejoining retained remote attempt ${attempt.id}`); break; }
    }
  }
  await locked(alias, () => writeJson(requestFile, { ticket, sha: source.sha }));
  const id = `${key}-${ticket}`, dir = analysisPath(id), staging = `${dir}.tmp`;
  fs.mkdirSync(staging, { recursive: true }); lifecycle.to('staging');
  const attempt = { id, key, ticket, owner: A.owner(), processId: process.pid, accepted: resumed, state: resumed ? 'accepted' : 'uploading' };
  writeJson(path.join(staging,'attempt.json'), attempt);
  const release = E.resource(() => cancelRemote(id));
  try {
    if (!resumed) {
      await json('/v1/jobs', { method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body: Readable.from(upload(source, { id, key, language, sourceDigest })), duplex: 'half' });
      attempt.accepted = true; attempt.state = 'accepted'; writeJson(path.join(staging,'attempt.json'), attempt);
    }
    lifecycle.to('accepted'); lifecycle.to('waiting');
    const remote = await waitRemote(id, log); lifecycle.to('downloading');
    const response = await request(`/v1/jobs/${id}/projection`), hash = crypto.createHash('sha256'); let bytes = 0;
    const maximum = P.integer(config().maxProjectionBytes, 256 * 1048576, 1024, 2 * 1024 ** 3);
    async function* bounded() { for await (const chunk of response.body) { E.check(); bytes += chunk.length; if (bytes > maximum) throw P.error('Semantic projection exceeds client byte budget', 'DT_SEMANTIC_LIMIT', 413); hash.update(chunk); yield chunk; } }
    await pipeline(Readable.from(bounded()), fs.createWriteStream(path.join(staging, 'projection.jsonl')));
    E.check();
    const manifest = { protocol: P.VERSION, id, key, owner: A.owner(), state: 'ready', repo: source.repoName, sha: source.sha, ref: source.ref, sourceDigest, revisionKey: source.key, root: source.root, language, ...(source.workspace?{workspace:source.workspace}:{}),
      service: args.service || source.service || null, env: args.env || null, dependencies, ...(source.sources ? { sources: source.sources, composite: true } : {}), builtAt: new Date().toISOString(), engine: { version: info.version, image: info.image, scriptsDigest: info.scriptsDigest, enrichmentDigest: info.enrichmentDigest, queryDigest: info.queryDigest }, projection: { bytes, digest: hash.digest('hex') }, capabilities: remote.meta?.capabilities, coverage: { truncated: !!remote.summary?.truncated, gaps: [...(remote.summary?.gaps || []), ...dependencies.filter(d=>!d.exact).map(d=>({kind:'library-version-unverified',repo:d.toRepo,sha:d.toSha,requestedVersion:d.version,message:'This source SHA is retained, but the requested artifact version was not verified'}))], counts: remote.summary?.counts || {} } };
    writeJson(path.join(staging, 'manifest.json'), manifest); lifecycle.to('verified');
    fs.renameSync(staging, dir); lifecycle.to('committed');
    await locked(alias, () => { E.check(); if (readJson(requestFile)?.ticket === ticket) { writeJson(aliasFile, { id, key, sha: source.sha }); lifecycle.to('published'); } else lifecycle.to('superseded'); });
    return load(id);
  } catch (e) {
    if (lifecycle.is('committed')) lifecycle.to('alias-failed');
    else if (!lifecycle.terminal) lifecycle.to('compensating');
    fs.rmSync(staging, { recursive: true, force: true });
    try { await cancelRemote(id); if (lifecycle.is('compensating')) lifecycle.to('aborted'); }
    catch (cleanup) { if (lifecycle.is('compensating')) lifecycle.to('cleanup-failed'); if (cleanup.statusCode !== 404) e.message += `; cleanup outcome unknown: ${cleanup.message}`; }
    throw e;
  }
  finally { release(); }
}
async function waitJob(job, waitMs = config().waitMs) {
  if (job.state !== 'running') { const view = require('./jobs').get(job.id); return { job: view.id, state: view.state, ...(view.result || {}), ...(view.error ? { error: view.error } : {}) }; }
  let timer; const done = await Promise.race([job.promise, new Promise(r => { timer = setTimeout(() => r(null), P.integer(waitMs, 1000, 0, 30000)); })]); clearTimeout(timer);
  if (!done) return { job: job.id, state: 'running', note: 'Parsing/querying continues as an owned job. Inspect or cancel it using existing job tools.' };
  return { job: done.id, state: done.state, ...(done.result || {}), ...(done.error ? { error: done.error } : {}) };
}
async function index(args = {}) {
  const J = require('./jobs');
  if (args.job) { const job = J.find(args.job); if (!job || !String(job.key).startsWith('semantic:')) throw P.error('Semantic job is not available', 'DT_NOT_FOUND', 404); return waitJob(job, args.waitMs); }
  if (!args.repo && !args.service && !args.revisionKey && !args.repos && !args.sourceRevisions) return list(args);
  const { waitMs: observationWait, ...operationArgs } = args;
  const job = J.start(`semantic:index:${P.digest(operationArgs)}`, `semantic index ${args.service || args.revisionKey || args.repo || args.repos || args.sourceRevisions?.[0]?.repo}`, async log => {
    const { snapshots, dependencies } = await inputs(args), info = await json('/v1/info');
    if (info.protocol !== P.VERSION || !info.scriptsDigest) throw P.error('Semantic worker protocol mismatch', 'DT_SEMANTIC_CONTRACT', 502);
    writeJson(path.join(base(), 'worker.json'), info);
    const javaSources = snapshots.filter(s => s.list.some(f => /\.java$/i.test(f.path)));
    const composite = args.composite && javaSources.length > 1 ? compositeSource(javaSources) : null;
    const tasks = snapshots.flatMap(source => {
      const languages = [...new Set(source.list.flatMap(f => /\.java$/i.test(f.path) ? ['java'] : /\.(?:[cm]?js|jsx|ts|tsx)$/i.test(f.path) ? ['js'] : []))];
      if (!languages.length) log(`No supported Java/JS/TS source in ${source.repoName}`);
      return languages.filter(language => (!args.language||args.language===language)&&(!composite || language !== 'java')).map(language => () => buildOne(source, language, args, info, dependencies, log));
    });
    if (composite&&(!args.language||args.language==='java')) tasks.push(() => buildOne(composite, 'java', args, info, dependencies, log));
    if (!tasks.length) throw P.error('Selected snapshots contain no Java or JS/TS sources');
    // The worker owns fair admission; limit simultaneous uploads to two to bound client IO.
    const analyses = []; for (let i = 0; i < tasks.length; i += 2) analyses.push(...await Promise.all(tasks.slice(i,i+2).map(fn => fn())));
    const ids = analyses.map(a => a.id).sort(), revisionSet = P.digest(ids); writeJson(path.join(base(), 'sets', `${revisionSet}.json`), { ids, owner: A.owner() });
    return { protocol: P.VERSION, revisionSet, analyses: analyses.map(summary), ready: true, reused: analyses.every(a => a.reused) };
  });
  return waitJob(job, args.waitMs);
}
async function runQuery(analysis, query) {
  const lifecycle = require('./state-machine').create(require('./lifecycles').deepQuery);
  let info, offline = false;
  try { info = await json('/v1/info', { timeoutMs: 5000 }); writeJson(path.join(base(),'worker.json'),info); }
  catch (error) { E.check(); info = readJson(path.join(base(),'worker.json')); if (!info) throw error; offline = true; }
  if (info.image !== analysis.engine.image || info.version !== analysis.engine.version || (analysis.engine.enrichmentDigest ? info.enrichmentDigest !== analysis.engine.enrichmentDigest : info.scriptsDigest !== analysis.engine.scriptsDigest)) throw P.error('Retained CPG requires its original compatible engine/enrichment bundle; select a compatible worker or reparse', 'DT_SEMANTIC_ENGINE_MISMATCH', 409);
  const cacheFile = path.join(base(),'queries',`${P.digest([analysis.id,info.queryDigest||info.scriptsDigest,query])}.json`), cached=readJson(cacheFile);
  if (cached && A.visible(cached.owner)) { lifecycle.to('reused'); return { records: cached.records, ms: 0, reused: true, ...(offline ? { offline: true } : {}) }; }
  if (offline) throw P.error('Semantic worker is unavailable and this exact deep query is not cached', 'DT_SEMANTIC_UNAVAILABLE',503);
  const id = `${P.digest([analysis.id, query])}-${crypto.randomBytes(16).toString('hex')}`, start = Date.now();
  const release = E.resource(() => cancelRemote(id));
  try {
    lifecycle.to('submitting');
    await json('/v1/queries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, analysisId: analysis.id, request: query }) });
    lifecycle.to('waiting'); await waitRemote(id); lifecycle.to('reading');
    const response = await request(`/v1/jobs/${id}/result`), records = [];
    for await (const line of P.lines(response.body, { maxBytes: 4 * 1048576, maxLineBytes: 512 * 1024, signal: E.signal() })) { if (records.length >= 1000) throw P.error('Deep query record budget exceeded', 'DT_SEMANTIC_LIMIT', 413); records.push(JSON.parse(line)); }
    const result = { records: records.map(record => ({ ...record, queryBundle: info.queryDigest || info.scriptsDigest })), ms: Date.now() - start };
    lifecycle.to('saving');writeJson(cacheFile,{owner:A.owner(),records:result.records}); lifecycle.to('ready');return result;
  } catch (e) { lifecycle.to('compensating'); try { await cancelRemote(id); lifecycle.to('failed'); } catch (cleanup) { lifecycle.to('cleanup-failed'); if (cleanup.statusCode !== 404) e.message += `; cleanup outcome unknown: ${cleanup.message}`; } throw e; }
  finally { release(); }
}
async function query(args = {}) {
  const J = require('./jobs');
  if (args.job) { const job = J.find(args.job); if (!job || !String(job.key).startsWith('semantic:query:')) throw P.error('Semantic query job is not available', 'DT_NOT_FOUND', 404); return waitJob(job, args.waitMs); }
  const analyses = resolve(args);
  if (!analyses.length) return { protocol: P.VERSION, ready: false, analyses: [], nodes: [], paths: [], gaps: [{ kind: 'semantic-index-missing', message: 'Run semantic_index for the selected exact source revisions' }], coverage: { complete: false }, backend: 'native-search-available' };
  const operation = args.operation || 'symbols';
  if(operation==='compare'&&args.mode==='dataflow')require('./semantic-compare').validate(args,analyses);
  if (!['slice','paths','assertions','flowmap'].includes(operation) && !(operation==='compare'&&args.mode==='dataflow')) return require('./semantic-query').query({ ...args, operation }, analyses, { runQuery });
  const job = J.start(`semantic:query:${P.digest([analyses.map(a => a.id), args])}`, `semantic ${operation}`, () => require('./semantic-query').query({ ...args, operation }, analyses, { runQuery }));
  return waitJob(job, args.waitMs);
}
function compositeSource(snapshots) {
  const sources = snapshots.map(s => ({ repo: s.repoName, sha: s.sha, sourceDigest: s.sourceDigest, revisionKey: s.key, prefix: `repos/${P.digest(s.key).slice(0,16)}`, root: s.root }));
  const list = snapshots.flatMap((s,i) => s.list.map(f => ({ path: `${sources[i].prefix}/${f.path}`, sourcePath: path.join(s.root,f.path) }))).sort((a,b)=>a.path.localeCompare(b.path));
  const hash = crypto.createHash('sha256'); for (const f of list) hash.update(f.path).update('\0').update(fs.readFileSync(f.sourcePath)).update('\0');
  return { ...snapshots[0], sources, list, sourceDigest: hash.digest('hex') };
}
module.exports = { capabilities, list, load, resolve, index, query, runQuery, inputs, base, request, waitJob, compositeSource };
