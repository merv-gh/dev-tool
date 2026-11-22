(() => {
  'use strict';
  const $ = id => document.getElementById(id), q = new URLSearchParams(location.search), story = q.get('story') || 'default';
  const state = { id: null, revision: null, definition: null, recording: null, receipts: {}, comparisons: [], selectionResults: [], probes: [], envs: [], catalog: null, busy: false, controller: null, dirty: false, resources: {}, routes: [] };
  const n = (tag, text, cls) => { const x = document.createElement(tag); if (text !== undefined) x.textContent = String(text); if (cls) x.className = cls; return x; };
  const canonical = x => x && typeof x === 'object' ? Array.isArray(x) ? x.map(canonical) : Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
  const json = x => JSON.stringify(x, null, 2), parse = id => JSON.parse($(id).value || '{}');
  function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
  function changed() { state.dirty = true; }
  async function tool(name, args, signal) {
    const r = await fetch('/api/tool/' + name, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-dt-story': story, ...(q.get('principal') ? { 'x-dt-principal': q.get('principal') } : {}) }, body: JSON.stringify(args), signal });
    const body = await r.json(); if (!r.ok || body.error) throw Error(body.error?.message || body.error || 'HTTP ' + r.status); return body.result;
  }
  const newProbeId = () => 'read-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2)).slice(0, 8);
  const debug = args => tool('mapping_debug', args, state.controller?.signal);
  async function action(fn) {
    if (state.busy) return;
    state.busy = true; state.controller = new AbortController();
    for (const e of document.querySelectorAll('button,input,select,textarea')) e.disabled = true;
    $('cancel').hidden = false; $('cancel').disabled = false;
    try { await fn(); } catch (e) { notice(e.name === 'AbortError' ? 'Cancelled. Inspect the saved recording before retrying; the request may have reached the service.' : e.message, true); }
    finally { state.busy = false; state.controller = null; for (const e of document.querySelectorAll('button,input,select,textarea')) e.disabled = false; $('cancel').hidden = true; }
  }
  const bind = (id, fn) => $(id).addEventListener('click', () => action(fn));
  const button = (text, fn) => { const b = n('button', text); b.onclick = () => action(fn); return b; };
  function label(title, control) { const l = n('label', title); l.append(control); return l; }
  function input(value, update, list) { const e = n('input'); e.value = value ?? ''; if (list) e.setAttribute('list', list); e.oninput = () => { update(e.value); changed(); }; return e; }
  function select(values, value, update) { const e = n('select'); for (const v of values) e.add(new Option(typeof v === 'string' ? v : v.label, typeof v === 'string' ? v : v.value)); e.value = value || ''; e.onchange = () => { update(e.value); changed(); }; return e; }
  function textarea(value, update, rows = 4) { const e = n('textarea'); e.rows = rows; e.spellcheck = false; e.value = value; e.oninput = () => { update(e.value); changed(); }; return e; }
  function raw(parent, data) {
    parent.replaceChildren();
    if (Array.isArray(data) && data.length && data.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys = [...new Set(data.flatMap(Object.keys))].slice(0, 40), table = n('table'), head = n('tr'); keys.forEach(k => head.append(n('th', k))); const thead = n('thead'); thead.append(head); table.append(thead); const tbody = n('tbody');
      data.slice(0, 100).forEach(row => { const tr = n('tr'); keys.forEach(k => tr.append(n('td', Object.hasOwn(row, k) ? typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k] === null ? 'null' : row[k] : '—'))); tbody.append(tr); }); table.append(tbody); parent.append(table); const full = n('details'); full.append(n('summary', 'Raw JSON · all retained fields'), n('pre', json(data))); parent.append(full);
    } else parent.append(n('pre', data === undefined ? 'No body retained. Inspect receipt gaps.' : json(data)));
  }
  function paths(value, path = '', out = []) { if (out.length >= 500) return out; out.push(path); if (value && typeof value === 'object') for (const [k, v] of Object.entries(value).slice(0, 30)) { if (out.length >= 500) break; paths(v, path + '/' + k.replace(/~/g, '~0').replace(/\//g, '~1'), out); } return out; }
  function pointer(value, path) { if (path === '') return { found: true, value }; if (!path.startsWith('/') || /~[^01]|~$/.test(path)) return { found: false }; for (const k of path.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'))) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, k)) return { found: false }; value = value[k]; } return { found: true, value }; }
  function renderComparisons() {
    const root = $('comparisons'); root.replaceChildren(); const statuses = []; const summarize = () => { $('comparison-summary').textContent = state.comparisons.length ? statuses.filter(s=>s==='Different').length + ' different · ' + statuses.filter(s=>s==='Equal').length + ' equal · Review ' + state.comparisons.length + ' field comparisons' : 'Add a comparison between response and raw source fields'; };
    $('response-paths').replaceChildren(...paths(state.receipts.api?.data).map(p => new Option(p || '(whole response)', p)));
    $('source-paths').replaceChildren(...[...new Set(state.probes.flatMap(p => paths(state.receipts[p.id]?.data)))].map(p => new Option(p || '(whole result)', p)));
    for (const [i, c] of state.comparisons.entries()) {
      const section = n('section', undefined, 'probe'), fields = n('div', undefined, 'comparison-edit');
      fields.append(label('Field / mapping', input(c.label, v => c.label = v)), label('Response pointer', input(c.response_path, v => { c.response_path = v; update(); }, 'response-paths')), label('Source read', select(state.probes.map(p => ({ value: p.id, label: p.label })), c.probe, v => { c.probe = v; update(); })), label('Source pointer', input(c.source_path, v => { c.source_path = v; update(); }, 'source-paths')), button('Remove', () => { state.comparisons.splice(i, 1); changed(); renderComparisons(); }));
      const status = n('p', undefined, 'comparison-status'), values = n('div', undefined, 'comparison-value'), left = n('div'), right = n('div'); left.append(n('span', 'Response'), n('pre')); right.append(n('span', 'Raw source'), n('pre')); values.append(left, right);
      function update() { const a = state.receipts.api, b = state.receipts[c.probe], av = pointer(a?.data, c.response_path), bv = pointer(b?.data, c.source_path); const s = !a || !b ? 'Not run' : a.state !== 'done' || b.state !== 'done' ? 'Read failed or incomplete' : !av.found || !bv.found ? 'Missing path' : JSON.stringify(canonical(av.value)) === JSON.stringify(canonical(bv.value)) ? 'Equal' : 'Different'; statuses[i]=s;summarize();status.className = 'comparison-status ' + s.toLowerCase(); status.textContent = s + (a && b ? ' · Response ' + new Date(a.at).toLocaleTimeString() + ' / source ' + new Date(b.at).toLocaleTimeString() : ' · Capture both sides to compare'); left.lastChild.textContent = av.found ? json(av.value) ?? 'No response yet' : 'Path missing'; right.lastChild.textContent = bv.found ? json(bv.value) ?? 'No source yet' : 'Path missing'; }
      update(); section.append(fields, status, values); root.append(section);
    }
    summarize();
    if (!state.comparisons.length) root.append(n('p', 'Add a field comparison after capturing the response and a source read. The pointer selectors suggest paths from actual results.', 'empty-note'));
  }
  function renderReceipts(history = []) {
    $('receipt-history').textContent = history.length ? json(history) : 'No earlier receipts.';
    const r = state.receipts.api;
    $('response-meta').textContent = r ? [r.state, r.httpStatus ? 'HTTP ' + r.httpStatus : '', r.env, r.ms + ' ms', r.at, r.error || '', r.resolvedTarget?.url || ''].filter(Boolean).join(' · ') : 'No response captured. Sending is always explicit.';
    $('response-meta').classList.toggle('receipt-error', !!r && r.state !== 'done'); raw($('response'), r?.data);
    if (!r) $('response').replaceChildren(n('p', 'Choose a route and Send request. No traffic is sent when opening a notebook.', 'empty-note'));
    $('api-evidence').textContent = r ? json({ ...r, data: undefined }) : 'No receipt yet.';
    renderProbes(); renderComparisons(); renderSelections();
  }
  function renderSelections() {
    const root=$('selection-results');root.replaceChildren();
    for(const s of state.selectionResults){
      const block=n('details');block.open=s.status!=='equal';block.append(n('summary',s.label+' · '+s.status),n('p',s.selected?(s.status==='inconclusive'?'Provisional ':'Expected ')+(s.selected.fallback?'fallback':'row '+s.selected.id):'No supported winner'),n('p',s.notice,'muted'));
      if(s.gaps?.length)block.append(n('p',s.gaps.join(' · '),'receipt-error'));
      const rows=n('details');rows.append(n('summary','Candidate decisions · '+s.rows.length+' rows'));const table=n('table'),head=n('tr');for(const title of ['Row','Decision','Reason'])head.append(n('th',title));table.append(head);
      for(const row of s.rows){const tr=n('tr');tr.append(n('td',row.id??'Missing identity'),n('td',row.state),n('td',[...row.rejected.map(f=>f.field+' '+f.op+' '+json(f.expected)+'; observed '+json(f.actual)),...row.unknown].join(' · ')||'All declared filters pass'));table.append(tr);}rows.append(table);block.append(rows);
      for(const c of s.comparisons)block.append(n('p',c.response_path+' · '+c.status+' · response '+json(c.response)+' / selected '+json(c.source),c.status==='different'?'receipt-error':''));root.append(block);
    }
  }
  function renderProbes() {
    const root = $('probes'); root.replaceChildren();
    for (const [i, p] of state.probes.entries()) {
      const receipt = state.receipts[p.id], section = n('section', undefined, 'probe'), heading = n('div', undefined, 'section-heading'); heading.append(n('h3', p.label || p.id), button('Run read', () => execute([p.id])));
      const editor = n('details'); editor.open = !receipt; editor.append(n('summary', p.kind.toUpperCase() + ' · Edit query & target'));
      const fields = n('div', undefined, 'target-fields'); fields.append(label('Label', input(p.label, v => p.label = v)), label('Environment', select(state.envs, p.env || $('env').value, v => { p.env = v; }))); editor.append(fields);
      if (p.kind === 'pg') { editor.append(label('Database', input(p.db, v => p.db = v, 'db-names')), label('Read-only SQL', textarea(p.sql || '', v => p.sql = v)), label('Bound parameters (JSON array)', textarea(p._paramsText ?? json(p.params || []), v => { p._paramsText = v; }, 2))); }
      if (p.kind === 'es') editor.append(label('Index / alias', input(p.index, v => p.index = v, 'index-names')), label('Query (DSL JSON or field==value)', textarea(p.query || '', v => p.query = v)));
      if (p.kind === 'kafka') editor.append(label('Topic', input(p.topic, v => p.topic = v, 'topic-names')));
      const count = input(p.limit || 20, v => p.limit = Number(v)); count.type = 'number'; count.min = 1; count.max = 100; editor.append(label('Maximum records (1–100)', count), label('Source / mapper evidence or assumption', textarea(p.evidence || '', v => p.evidence = v, 2)), button('Remove source', () => { state.probes.splice(i, 1); state.comparisons = state.comparisons.filter(c => c.probe !== p.id); changed(); renderProbes(); renderComparisons(); }));
      section.append(heading, editor);
      if (receipt) { section.append(n('p', [receipt.state, receipt.env, receipt.ms + ' ms', receipt.at, receipt.truncated ? 'Bounded preview · ' + receipt.total + ' retained / reported records' : '', receipt.error || ''].filter(Boolean).join(' · '), receipt.state === 'done' ? 'receipt-meta' : 'receipt-meta receipt-error')); const result = n('div', undefined, 'raw-result'); raw(result, receipt.data); section.append(result); const meta = n('details'); meta.append(n('summary', 'Read receipt & exact request'), n('pre', json({ ...receipt, data: undefined }))); section.append(meta); }
      root.append(section);
    }
    if (!state.probes.length) root.append(n('p', 'Add Postgres, Elasticsearch or Kafka reads. Use the cached schema browser for table queries and function bodies.', 'empty-note'));
  }
  function collect() {
    const probes = state.probes.map(p => { const { _paramsText, ...out } = p; if (_paramsText !== undefined) out.params = JSON.parse(_paramsText); return out; });
    const request = $('url').value.trim() ? { method: $('method').value, url: $('url').value.trim(), headers: parse('headers'), body: $('body-kind').value === 'none' ? { kind: 'none' } : { kind: $('body-kind').value, value: $('body-kind').value === 'json' ? JSON.parse($('body').value) : $('body').value } } : undefined;
    return { version: 1, title: $('title').value, service: $('service').value, env: $('env').value, follow_service: $('follow').checked, ...(request ? { request } : {}), probes, comparisons: state.comparisons, selections:JSON.parse($('selections').value||'[]'), assumptions: $('assumptions').value.split('\n').filter(Boolean) };
  }
  async function save() { const r = await debug({ action: 'save', id: $('name').value, definition: collect(), expected_revision: state.id === $('name').value ? state.revision : null }); const changedRevision = r.revision !== state.revision; state.id = r.id; state.revision = r.revision; state.definition = r.definition; state.probes = structuredClone(r.definition.probes); state.comparisons = structuredClone(r.definition.comparisons); if (changedRevision) { state.recording = null; state.receipts = {}; state.selectionResults = []; renderReceipts(); } state.dirty = false; history.replaceState(null, '', '/mapping-debugger?' + new URLSearchParams({ id: state.id, story })); await library(); notice('Saved ' + r.id + '. Opening or saving never sends requests.'); }
  async function execute(steps) {
    if (!state.id || state.dirty) await save();
    notice('Running ' + steps.join(', ') + ' through the backend…');
    const r = await debug({ action: 'run', id: state.id, recording: state.recording || undefined, steps, params: parse('params'), auth_profile: $('auth').value || undefined });
    state.recording = r.id; const full = await debug({ action: 'get', id: r.id, include_data: true }); state.receipts = full.receipts; state.selectionResults=full.selections||[]; renderReceipts(full.history); $('view-link').href = r.view; $('view-link').hidden = false; await library(); notice('Recording saved · ' + r.id + '. Review receipt times and comparison results.');
  }
  async function resources() { const r = await tool('api_client_catalog', { env: $('env').value, resources_only: true }); state.resources = r.resources; for (const [id, names] of Object.entries({ 'db-names': r.resources.databases, 'index-names': r.resources.indices, 'topic-names': r.resources.topics })) { let list = $(id); if (!list) { list = n('datalist'); list.id = id; document.body.append(list); } list.replaceChildren(...names.map(x => new Option(x, x))); } $('browse-db').replaceChildren(...r.resources.databases.map(x => new Option(x, x))); }
  async function catalog() { const r = await tool('api_client_catalog', { env: $('env').value || undefined }); state.envs = r.environments; state.catalog = r; $('env').replaceChildren(...r.environments.map(x => new Option(x, x))); $('env').value = r.env; $('services').replaceChildren(...r.services.map(s => new Option(s.name, s.service || s.name))); await resources(); }
  async function discover() {
    const r = await debug({ action: 'discover', env: $('env').value, service: $('service').value }); state.routes = r.routes.routes;
    $('route').replaceChildren(new Option('Choose route or enter URL below', ''), ...state.routes.map((r, i) => new Option(r.method + ' ' + r.path, String(i))));
    const group = r.routes.services[0]; state.target = group?.targets?.find(t => t.status === 'passing')?.url || group?.targets?.[0]?.url;
    $('references').replaceChildren(...r.references.map(ref => { const x = n('div', undefined, 'reference'); x.append(n('p', [ref.object, ref.file, ref.line, ref.via].filter(Boolean).join(' · ')), n('pre', ref.sql || 'Table reference; choose exact database before querying.')); if (ref.sql) x.append(button('Draft PG read from this SQL', () => { addProbe('pg', { sql: ref.sql, evidence: [ref.file, ref.line, ref.via].filter(Boolean).join(':') }); notice('SQL copied as an editable draft. Review parameters, SELECT/read-only behavior and exact database before Run read.'); })); return x; }));
    for (const p of r.probes) { const x = n('div', undefined, 'reference'); x.append(n('p', p.kind.toUpperCase() + ' · ' + p.label), button('Add source read', () => addProbe(p.kind, { ...p, id: newProbeId() }))); $('references').append(x); }
    $('source-panel').open = !!r.references.length;
    const auth = await tool('api_auth_profiles', {}); const profiles = auth.profiles || (Array.isArray(auth) ? auth : []); $('auth').replaceChildren(new Option('None', ''), ...profiles.map(p => new Option(p.label || p.id, p.id)));
    notice(state.routes.length + ' indexed routes · ' + r.references.length + ' SQL/source references. ' + r.gaps[0]);
  }
  function addProbe(kind, values = {}) { state.probes.push({ id: newProbeId(), kind, label: kind === 'pg' ? 'Registry rows' : kind === 'es' ? 'Search documents' : 'Topic messages', env: $('env').value, limit: 20, ...(kind === 'pg' ? { db: state.resources.databases?.[0] || '', sql: '', params: [] } : {}), ...values }); changed(); renderProbes(); renderComparisons(); }
  async function library() { const r = await debug({ action: 'list' }); $('notebooks').replaceChildren(new Option('New notebook', ''), ...r.notebooks.filter(r => r.kind === 'definition').map(r => new Option(r.title + ' · ' + r.id, r.id))); $('notebooks').value = state.id || ''; $('recordings').replaceChildren(...r.notebooks.filter(r => r.kind === 'recording' && (!state.id || r.id === state.recording || r.notebook === state.id)).map(r => { const b = button(r.title + ' · ' + new Date(r.at).toLocaleString(), () => { if (!state.dirty || confirm('Discard the unsaved draft and open this recording?')) return load(r.id); notice('Draft preserved. Save it before opening another recording.'); }); b.className = 'record-link'; return b; })); }
  async function load(id) { const r = await debug({ action: 'get', id, include_data: true }), d = r.definition; state.id = r.kind === 'recording' ? r.notebook : r.id; state.revision = r.revision; state.definition = d; state.recording = r.kind === 'recording' ? r.id : null; state.receipts = r.receipts || {}; state.selectionResults=r.selections||[]; $('selections').value=json(d.selections||[]); state.probes = structuredClone(d.probes); state.comparisons = structuredClone(d.comparisons); $('name').value = state.id; $('title').value = d.title; $('service').value = d.service; $('env').value = d.env; $('follow').checked = !!d.follow_service; $('url').value = d.request?.url || ''; $('method').value = d.request?.method || 'GET'; $('headers').value = json(d.request?.headers || {}); $('body-kind').value = d.request?.body?.kind || 'none'; $('body').value = d.request?.body?.kind === 'none' || d.request?.body?.value === undefined ? '' : d.request?.body?.kind === 'json' ? json(d.request.body.value) : d.request.body.value; $('assumptions').value = d.assumptions.join('\n'); await resources(); renderReceipts(r.history); state.dirty = false; await library(); notice(r.kind === 'recording' ? 'Retained recording · ' + r.at + '. Definition is frozen; saving edits starts a new recording.' : 'Notebook loaded. No requests were sent.'); history.replaceState(null, '', '/mapping-debugger?' + new URLSearchParams({ id, story })); }
  bind('refresh-recording', async () => { if (!state.recording) { await library(); return notice('Choose a saved recording below.'); } const r = await debug({action:'get',id:state.recording,include_data:true}); state.receipts=r.receipts;state.selectionResults=r.selections||[];renderReceipts(r.history);await library();notice('Recording refreshed without replay. A retained running receipt after interruption has an unknown outcome.'); });
  bind('save', save); bind('discover', discover); bind('send', () => execute(['api'])); bind('run-reads', () => execute(state.probes.map(p => p.id))); bind('add', () => addProbe($('add-kind').value));
  bind('refresh', async () => { const r = await tool('api_instances_refresh', { env: $('env').value, service: $('service').value }); notice('Refreshed ' + r.service + ' · ' + r.instances.length + ' current instances. No API request sent.'); });
  bind('trace', async () => { notice('Reading cached field and mapper evidence…'); const r = await tool('field_trace', { env: $('env').value, name: $('trace-name').value }); $('trace-result').textContent = json(r); notice('Field lineage loaded from indexed source. Follow its file:line references to review mapper logic.'); });
  let browseOffset = 0;
  async function browse(more = false) { const r = await tool('api_database_inspect', { env: $('env').value, db: $('browse-db').value, q: $('browse-q').value, offset: more ? browseOffset : 0 }); if (!more) $('objects').replaceChildren(); for (const obj of r.objects) { const x = n('details'); x.append(n('summary', obj.kind + ' · ' + obj.name), n('pre', obj.body || json(obj.columns))); if (obj.sql) x.append(button('Add table read', () => addProbe('pg', { db: r.db, sql: obj.sql, label: obj.name, evidence: 'Cached schema ' + obj.name }))); else x.append(button('Use function for mapper lineage', () => { $('trace-name').value = obj.name; $('source-panel').open = true; notice('Function selected. Inspect its body above, then Find field & mapper lineage. Add a PG read with reviewed arguments to invoke it.'); })); $('objects').append(x); } browseOffset = r.nextOffset; $('browse-more').hidden = r.nextOffset === null; notice(r.gap || r.objects.length + ' cached objects loaded; no database query executed.'); }
  bind('browse', () => browse()); bind('browse-more', () => browse(true));
  bind('add-comparison', () => { if (!state.probes.length) throw Error('Add a source read first.'); state.comparisons.push({ label: 'Mapped field', probe: state.probes[0].id, response_path: '', source_path: '' }); changed(); renderComparisons(); });
  async function snapshot() { if (!state.id || state.dirty) await save(); const r = await debug({ action: 'open', id: state.recording || state.id }); $('view-link').href = r.view; $('view-link').hidden = false; notice('Snapshot retained. Use Open retained inline view below.'); return r; }
  bind('snapshot', snapshot);
  bind('name-snapshot', async () => { const r = await snapshot(), slug = prompt('Readable private /show name', $('name').value + '-snapshot'); if (!slug) return; const named = await tool('named_view', { action: 'save', name: slug, slug, scope: 'private', expected_revision: null, target: { type: 'result', id: new URL(r.view).pathname.split('/').pop() } }); $('view-link').href = named.url; notice('Named snapshot saved. Link is private to this user and chat; admins can explicitly publish through named_view.'); });
  bind('export', () => { const definition = collect(), data = { tool: 'mapping_debug', save: { action: 'save', id: $('name').value, expected_revision: null, definition }, run: { action: 'run', id: $('name').value, steps: ['api', ...definition.probes.map(p => p.id)] }, notice: 'Save never executes. Review targets and API mutation before explicitly invoking run. Runtime credentials are omitted.' }; const a = n('a'); a.href = URL.createObjectURL(new Blob([json(data)], { type: 'application/json' })); a.download = ($('name').value || 'mapping-notebook') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); notice('Exported definition and exact tool arguments. Runtime parameters and credentials omitted.'); });
  bind('delete', async () => { const id = state.recording || state.id; if (!id || !confirm('Permanently delete ' + id + '? Export it first if needed.')) return; await debug({ action: 'delete', id, expected_revision: state.revision }); location.href = '/mapping-debugger?' + new URLSearchParams({ story }); });
  bind('new', () => { if (!state.dirty || confirm('Discard the unsaved draft?')) location.href = '/mapping-debugger?' + new URLSearchParams({ story }); });
  $('cancel').onclick = () => state.controller?.abort();
  $('notebooks').onchange = () => { if (!state.dirty || confirm('Discard the unsaved draft?')) { if ($('notebooks').value) action(() => load($('notebooks').value)); } };
  $('env').onchange = () => action(async () => { changed(); await catalog(); notice('Environment changed. Existing probe targets remain explicit; choose their environment in each query editor.'); });
  $('route').onchange = () => { const r = state.routes[Number($('route').value)]; if ($('route').value === '' || !r) return; $('method').value = r.method; $('url').value = (state.target || 'http://select-instance.invalid') + r.path; changed(); notice('Route copied. Replace path parameters such as {id} with a value or {{id}} and supply runtime params.'); };
  document.addEventListener('input', e => { if (e.target.matches('input,textarea') && !['params', 'browse-q', 'trace-name'].includes(e.target.id)) changed(); });
  $('body-kind').onchange = changed; $('method').onchange = changed; $('follow').onchange = changed;
  addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('dt:tool-progress', e => { if (state.busy && e.detail.phase === 'debug-probe') { state.recording=e.detail.recording; notice(e.detail.step + ' · ' + e.detail.state + ' · recording ' + e.detail.recording); } });
  $('api-link').href += '?' + new URLSearchParams({ story });
  action(async () => { await catalog(); await library(); if (q.get('id')) await load(q.get('id')); else { if (q.get('service')) $('service').value = q.get('service'); if (q.get('env') && state.envs.includes(q.get('env'))) { $('env').value = q.get('env'); await resources(); } renderProbes(); renderComparisons(); } });
})();
