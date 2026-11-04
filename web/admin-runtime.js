// Authenticated runtime inspector. Scope is tab-local; the server owns authorization.
const runtimeStore = {
  get(key) { try { return sessionStorage.getItem('dt-admin-' + key) || ''; } catch { return ''; } },
  set(key, value) { try { if (value) sessionStorage.setItem('dt-admin-' + key, value); else sessionStorage.removeItem('dt-admin-' + key); } catch {} },
};
let runtimeStory = runtimeStore.get('story'), runtimePrincipal = runtimeStore.get('principal');
let runtimeState = null, runtimeScopeVersion = 0, runtimeSelected = null, runtimeTimer = null, runtimeLoading = null, runtimeExecutionSequence = 0;
let runtimeMetadata = [], runtimeMetadataCursor = null, runtimeMetadataSelected = null, runtimeMetadataDirty = false, runtimeMetadataVersion = 0, runtimeMetadataEditSequence = 0;
let runtimeTools = [], runtimeCodePending = false, runtimeScopeInitialized = false;
function adminRequestHeaders() {
  return { ...(runtimeStory ? { 'x-dt-story': runtimeStory } : {}), ...(runtimeState?.identity?.role === 'admin' && runtimePrincipal ? { 'x-dt-principal': runtimePrincipal } : {}) };
}
function adminRequestScope() { return JSON.stringify([runtimePrincipal && runtimeState?.identity?.role === 'admin' ? runtimePrincipal : '', runtimeStory || 'default']); }
const rtEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function runtimeMessage(message, error = false) { $('rtMessage').textContent = message; $('rtMessage').className = error ? 'err-text' : 'hint'; }
function rtJson(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function rtState(record) { return String(record.state || record.status || (record.ok === true || record.event === 'ok' ? 'done' : record.ok === false || record.event === 'failed' ? 'failed' : record.event === 'start' ? 'running' : record.event === 'note' ? 'note' : 'unknown')); }
function rtActive(record) { return ['queued', 'running', 'cancelling', 'draining'].includes(rtState(record)); }
function rtBadge(record) { const state = rtState(record); return `<span class="state ${rtEsc(state.replace(/[^a-z-]/g, ''))}">${rtEsc(state)}</span>`; }
function rtDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function rtMs(value) { return value == null ? '—' : Number(value) < 1000 ? Math.round(Number(value)) + ' ms' : (Number(value) / 1000).toFixed(2) + ' s'; }
function rtOwner(record) { return record.owner || { principalId: record.principalId, storyId: record.storyId }; }
function rtTitle(record) { return record.title || record.tool || record.name || record.id; }
function rtFacts(entries) { return '<dl class="rt-facts">' + entries.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => `<dt>${rtEsc(label)}</dt><dd>${rtEsc(typeof value === 'object' ? rtJson(value) : value)}</dd>`).join('') + '</dl>'; }
function rtDisclosure(label, value, open = false) { return `<details${open ? ' open' : ''}><summary>${rtEsc(label)}</summary><pre class="code cx-wrap">${rtEsc(rtJson(value))}</pre></details>`; }
function rtTable(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return '';
  const keys = [...new Set(rows.slice(0, 100).flatMap(row => Object.keys(row)))].slice(0, 12);
  return `<div class="rt-data-table"><table><thead><tr>${keys.map(key => '<th>' + rtEsc(key) + '</th>').join('')}</tr></thead><tbody>${rows.slice(0, 100).map(row => '<tr>' + keys.map(key => '<td>' + rtEsc(typeof row[key] === 'object' ? rtJson(row[key]) : row[key]) + '</td>').join('') + '</tr>').join('')}</tbody></table></div>${rows.length > 100 ? '<p class="hint">First 100 rows shown. Full result is available below.</p>' : ''}`;
}
function rtTimeline(records, now = Date.now()) {
  const starts = records.map(record => Date.parse(record.startedAt || record.createdAt)).filter(Number.isFinite);
  if (!starts.length) return new Map();
  const start = Math.min(...starts), end = Math.max(start + 1, ...records.map(record => Date.parse(record.endedAt) || (rtActive(record) ? now : (Date.parse(record.startedAt) || start) + (Number(record.ms) || 1))));
  return new Map(records.map(record => { const a = Date.parse(record.startedAt || record.createdAt) || start, b = Date.parse(record.endedAt) || (rtActive(record) ? now : a + (Number(record.ms) || 1)); return [record.id, { left: Math.max(0, Math.min(100, (a - start) / (end - start) * 100)), width: Math.max(0.5, Math.min(100, (b - a) / (end - start) * 100)) }]; }));
}
function rtExecutionTree(records) {
  const byId = new Map(records.map(record => [record.id, record])), children = new Map();
  for (const record of records) { const parent = byId.has(record.parentId) && record.parentId !== record.id ? record.parentId : ''; if (!children.has(parent)) children.set(parent, []); children.get(parent).push(record); }
  const visited = new Set(), timeline = rtTimeline(records);
  function walk(record, depth) {
    if (visited.has(record.id)) return ''; visited.add(record.id);
    const t = timeline.get(record.id), owner = rtOwner(record), count = typeof record.children === 'number' ? record.children : (record.children || []).length;
    return `<button class="rt-execution${runtimeSelected === record.id ? ' on' : ''}" data-rt-execution="${rtEsc(record.id)}" aria-pressed="${runtimeSelected === record.id}"><span class="rt-execution-title"><strong>${rtEsc(rtTitle(record))}</strong>${rtBadge(record)}</span><span class="rt-execution-meta"><span>${rtEsc(record.kind || 'call')} · ${rtEsc(record.id)}</span><span>${rtEsc(rtMs(record.ms))}</span>${count ? '<span>' + count + ' child calls</span>' : ''}${owner.storyId && owner.storyId !== runtimeStory ? '<span>' + rtEsc(owner.storyId) + '</span>' : ''}</span>${t ? `<span class="rt-timeline" title="Started ${rtEsc(rtDate(record.startedAt))}; ${rtEsc(rtMs(record.ms))}"><span class="${rtEsc(rtState(record).replace(/[^a-z-]/g, ''))}" style="left:${t.left.toFixed(2)}%;width:${t.width.toFixed(2)}%"></span></span>` : ''}</button>${depth < 12 && children.has(record.id) ? '<div class="rt-children">' + children.get(record.id).map(child => walk(child, depth + 1)).join('') + '</div>' : ''}`;
  }
  // Include orphaned and cyclic records without inventing a parent relationship.
  return [...(children.get('') || []), ...records].map(record => walk(record, 0)).join('');
}
function runtimeRenderExecutions() {
  if (!runtimeState) return;
  const query = $('rtSearch').value.trim().toLowerCase(), state = $('rtState').value;
  const records = (runtimeState.executions || []).filter(record => (!state || rtState(record) === state) && (!query || [rtTitle(record), record.id, record.error].some(value => String(value || '').toLowerCase().includes(query))));
  $('rtExecutions').innerHTML = records.length ? rtExecutionTree(records) : '<div class="empty">No matching executions in this scope. Run a tool or change the selected chat / task.</div>';
  const active = (runtimeState.executions || []).filter(rtActive).length; $('nExecutions').textContent = active ? String(active) : '';
}
function rtCancellation(record) {
  const cleanup = record.cleanup, incomplete = record.cleanupIncomplete || cleanup?.incomplete || 0, outcome = record.outcome;
  if (incomplete || outcome === 'unknown' || outcome?.state === 'unknown') return '<div class="rt-notice">Cleanup is incomplete or the external outcome is unknown. Inspect resources and trace before retrying an operation with effects.</div>';
  if (['cancelling', 'draining'].includes(rtState(record))) return '<div class="rt-notice">Cancellation requested. Owned calls and processes are settling; this execution is still active.</div>';
  if (rtState(record) === 'cancelled') return '<p class="hint">Execution cancelled. Inspect the outcome and cleanup details before repeating a call with effects.</p>';
  return '';
}
async function runtimeSelectExecution(id, quiet = false) {
  const same = runtimeSelected === id, trace = same ? $('rtTrace')?.innerHTML || '' : '', reason = same ? $('rtCancelReason')?.value : null;
  runtimeSelected = id; runtimeRenderExecutions(); const scope = runtimeScopeVersion, sequence = ++runtimeExecutionSequence;
  try {
    const result = await api('/api/admin/execution/' + encodeURIComponent(id));
    if (scope !== runtimeScopeVersion || id !== runtimeSelected || sequence !== runtimeExecutionSequence) return;
    const record = result.execution || result, owner = rtOwner(record);
    const canCancel = record.canCancel !== undefined ? record.canCancel : ['queued', 'running'].includes(rtState(record));
    $('rtExecution').innerHTML = `<div class="row"><h3>${rtEsc(rtTitle(record))}</h3>${rtBadge(record)}</div>${rtCancellation(record)}${record.error ? '<div class="rt-error">' + rtEsc(record.error) + '</div>' : ''}` + rtFacts([
      ['Execution', record.id], ['Parent', record.parentId], ['Principal', owner.principalId], ['Chat / task', owner.storyId], ['Source', record.source], ['Runtime', record.runtime || record.engine], ['Config revision', record.configRevision || record.config_revision || record.registryRevision || record.revision], ['Started', rtDate(record.startedAt)], ['Finished', record.endedAt ? rtDate(record.endedAt) : undefined], ['Elapsed', rtMs(record.ms)], ['Owned resources', record.resources], ['Child executions', record.children], ['Outcome', record.outcome], ['Incomplete cleanup', record.cleanupIncomplete || undefined],
    ]) + (canCancel ? '<div class="rt-cancel"><label class="rt-search-label" for="rtCancelReason">Cancellation reason</label><input id="rtCancelReason" maxlength="500" value="Cancelled from Admin" aria-label="Cancellation reason"><button id="rtExecutionCancel">Cancel execution</button></div>' : '') + '<div class="row"><button id="rtExecutionRefresh">Refresh details</button><button id="rtTraceLoad">Load trace</button></div><div id="rtTrace"></div>' + rtDisclosure('Complete execution record', record);
    $('rtExecutionRefresh').onclick = () => runtimeSelectExecution(id).catch(error => runtimeMessage(error.message, true));
    $('rtTraceLoad').onclick = () => runtimeLoadTrace(id);
    if (trace) $('rtTrace').innerHTML = trace;
    if (reason && $('rtCancelReason')) $('rtCancelReason').value = reason;
    if ($('rtExecutionCancel')) $('rtExecutionCancel').onclick = async () => {
      const button = $('rtExecutionCancel'); button.disabled = true; button.textContent = 'Requesting cancellation…';
      try { await api('/api/admin/execution/' + encodeURIComponent(id) + '/cancel', { reason: $('rtCancelReason').value }); if (scope === runtimeScopeVersion) { runtimeMessage('Cancellation requested. Refreshing execution and cleanup state.'); await loadRuntime(); if (runtimeSelected === id) await runtimeSelectExecution(id); } }
      catch (error) { if (scope === runtimeScopeVersion) { runtimeMessage(error.message, true); button.disabled = false; button.textContent = 'Cancel execution'; } }
    };
  } catch (error) { if (!quiet && scope === runtimeScopeVersion) runtimeMessage(error.message, true); }
}
async function runtimeLoadTrace(id) {
  const scope = runtimeScopeVersion, box = $('rtTrace'); box.textContent = 'Loading execution trace…';
  try {
    const trace = await api('/api/admin/runtime/trace?execution=' + encodeURIComponent(id));
    if (scope !== runtimeScopeVersion || id !== runtimeSelected) return;
    const spans = Array.isArray(trace) ? trace : trace.spans || trace.steps || trace.records || [];
    $('rtTrace').innerHTML = spans.length ? '<h2>Trace spans</h2><ol class="rt-spans">' + spans.slice(0, 200).map(span => `<li><div class="rt-span-name"><strong>${rtEsc(span.title || span.name || span.tool || span.message || span.id)}</strong>${rtBadge(span)}<span class="muted">${rtEsc(rtMs(span.ms))}</span></div>${rtFacts([['Span', span.spanId || span.id], ['Parent span', span.parentSpanId || span.parentId], ['Started', span.startedAt || span.at], ['Error', span.error]])}</li>`).join('') + '</ol>' + rtDisclosure('Trace data', trace) : rtDisclosure('Trace data', trace, true);
  } catch (error) { if (scope === runtimeScopeVersion && id === runtimeSelected) $('rtTrace').innerHTML = '<div class="rt-error">' + rtEsc(error.message) + '</div>'; }
}
function rtSystemFacts(value, names) { return rtFacts(names.map(([label, key]) => [label, value?.[key]])); }
function runtimeRenderSystem() {
  const { storage = {}, scheduler = {}, runtimes = {}, config = {} } = runtimeState;
  const queues = Object.entries(scheduler).filter(([, value]) => value && typeof value === 'object').map(([resource, value]) => ({ resource, running: value.running, queued: value.queued, limit: value.concurrency, queueLimit: value.maxQueued, stories: value.scopes }));
  const engines = Array.isArray(runtimes) ? runtimes.map(engine => ({ engine: engine.engine, status: engine.status, tools: engine.tools, files: engine.files, network: engine.network, memoryMb: engine.memoryMb })) : [];
  $('rtSystemStatus').innerHTML = '<div><h3>Metadata storage</h3>' + rtSystemFacts(storage, [['Backend', 'backend'], ['Durability', 'durability'], ['Writes settled', 'durable'], ['Queued writes', 'queued'], ['Rejected writes', 'rejected'], ['Failed writes', 'failedWrites'], ['Last error', 'lastError']]) + rtDisclosure('Storage details & imports', storage) + '</div><div><h3>Resource scheduling</h3>' + (queues.length ? rtTable(queues) : '<p class="hint">No bounded CPU or build work has used a resource queue yet.</p>') + rtDisclosure('Scheduling details', scheduler) + '</div><div><h3>Code runtimes</h3>' + (engines.length ? rtTable(engines) : rtFacts(Object.entries(runtimes).filter(([, value]) => typeof value !== 'object'))) + rtDisclosure('Engine capabilities & limits', runtimes) + '</div>';
  $('rtConfigStatus').innerHTML = rtSystemFacts(config, [['Active revision', 'revision'], ['Generation', 'generation'], ['Loaded', 'loadedAt'], ['Last validated', 'validatedAt'], ['Reload state', 'state']]) + (config.lastError ? '<div class="rt-error">' + rtEsc(typeof config.lastError === 'object' ? rtJson(config.lastError) : config.lastError) + '</div>' : '') + rtDisclosure('Generation details', config);
}
function runtimeApplyIdentity(identity = {}) {
  const first = !runtimeScopeInitialized; runtimeScopeInitialized = true;
  const bound = identity.boundStory || (identity.storyBound ? identity.storyId : null);
  if (first && !runtimeStory && identity.multiUser && !bound) { runtimeStory = 'admin-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36)); runtimeStore.set('story', runtimeStory); }
  if (bound || !identity.multiUser && !first) { runtimeStory = bound || identity.storyId || 'default'; runtimeStore.set('story', runtimeStory); }
  if (!runtimeStory) runtimeStory = identity.storyId || 'default';
  const admin = identity.role === 'admin' && identity.multiUser;
  if (!admin) { runtimePrincipal = ''; runtimeStore.set('principal', ''); }
  $('rtIdentity').textContent = [identity.principalId || 'local', identity.role || 'local', identity.multiUser ? 'token account' : 'single user'].join(' · ');
  if (document.body) document.body.dataset.dtRole = identity.role || 'admin';
  $('rtStory').value = runtimeStory; $('rtPrincipal').value = runtimePrincipal; $('rtPrincipalControl').hidden = !admin;
  $('rtStory').disabled = !!bound; $('rtScopeApply').disabled = !!bound && !admin;
  $('rtScopeStatus').textContent = bound ? 'This token is bound to this chat / task.' : !identity.multiUser ? 'Shared local account. Choose a stable chat / task ID to separate work; default includes existing work.' : 'Separate chat / task histories. Use a stable ID to resume.';
  const restricted = identity.role === 'user';
  document.querySelectorAll('[data-tab="config"],[data-tab="scripts"],[data-tab="sites"],[data-tab="views"],[data-refresh],#ppBuild,#ppAll').forEach(element => { element.hidden = restricted; });
  $('rtOpenConfig').hidden = restricted;
  if (restricted && ['config', 'scripts', 'sites', 'views'].includes(tab)) show('runtime');
  return first && (identity.storyId !== runtimeStory || admin && runtimePrincipal && identity.principalId !== runtimePrincipal);
}
async function loadRuntime() {
  if (runtimeLoading) { await runtimeLoading; if (runtimeState?.identity?.storyId !== runtimeStory) return loadRuntime(); return; }
  const scope = runtimeScopeVersion, bootstrap = !runtimeScopeInitialized;
  runtimeLoading = (async () => { try {
    let result = await api('/api/admin/runtime', undefined, { identityOnly: bootstrap });
    if (scope !== runtimeScopeVersion) return;
    runtimeState = result;
    if (runtimeApplyIdentity(result.identity)) { result = await api('/api/admin/runtime'); if (scope !== runtimeScopeVersion) return; runtimeState = result; runtimeApplyIdentity(result.identity); }
    runtimeRenderExecutions(); runtimeRenderSystem();
    if (bootstrap) { runtimeMessage(''); refresh(); runtimeLoadMetadata(); runtimeLoadCodeTools(); }
    $('rtUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    if (runtimeSelected && tab === 'runtime') await runtimeSelectExecution(runtimeSelected, true);
  } catch (error) { if (scope === runtimeScopeVersion) runtimeMessage(error.message, true); }
  finally { clearTimeout(runtimeTimer); if ($('rtLive').checked) runtimeTimer = setTimeout(() => { if (tab === 'runtime') loadRuntime(); }, (runtimeState?.executions || []).some(rtActive) ? 1500 : 10000); }
  })();
  try { await runtimeLoading; } finally { runtimeLoading = null; }
}
function runtimeMetadataCanLeave() { return !runtimeMetadataDirty || confirm('Discard unsaved metadata notes?'); }
function rtMetadataLabel(record) { return record.value?.metadata?.label || record.value?.title || record.value?.tool || record.value?.name || record.id; }
function runtimeRenderMetadata() {
  $('rtMetadataList').innerHTML = runtimeMetadata.length ? runtimeMetadata.map(record => `<button class="rt-record${runtimeMetadataSelected?.id === record.id && runtimeMetadataSelected?.kind === record.kind ? ' on' : ''}" data-rt-record="${rtEsc(record.id)}" data-rt-kind="${rtEsc(record.kind || $('rtMetadataKind').value)}"><span class="rt-record-title"><strong>${rtEsc(rtMetadataLabel(record))}</strong><span class="muted">${rtEsc(record.kind || $('rtMetadataKind').value)}</span></span><span class="rt-execution-meta"><span>${rtEsc(record.id)}</span><span>${rtEsc(rtDate(record.updatedAt))}</span></span></button>`).join('') : '<div class="empty">No stored records in this scope. New calls, jobs and executions will appear here.</div>';
  $('rtMetadataMore').hidden = !runtimeMetadataCursor;
}
async function runtimeLoadMetadata(append = false) {
  const scope = runtimeScopeVersion, version = ++runtimeMetadataVersion, kind = $('rtMetadataKind').value;
  try {
    const page = await api('/api/admin/metadata?kind=' + encodeURIComponent(kind) + '&limit=40' + (append && runtimeMetadataCursor ? '&after=' + encodeURIComponent(runtimeMetadataCursor) : ''));
    if (scope !== runtimeScopeVersion || version !== runtimeMetadataVersion) return;
    const records = page.records || page.items || [];
    runtimeMetadata = append ? [...runtimeMetadata, ...records.filter(record => !runtimeMetadata.some(previous => previous.id === record.id))] : records;
    runtimeMetadataCursor = page.nextCursor || page.after || null; runtimeRenderMetadata();
    $('rtMetadataCount').textContent = runtimeMetadata.length + (page.total != null ? ' of ' + page.total : '') + ' records';
  } catch (error) { if (scope === runtimeScopeVersion) runtimeMessage(error.message, true); }
}
async function runtimeSelectMetadata(kind, id, force = false) {
  if (!force && !runtimeMetadataCanLeave()) return;
  const scope = runtimeScopeVersion, version = ++runtimeMetadataVersion, edits = runtimeMetadataEditSequence;
  try {
    const response = await api('/api/admin/metadata/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id));
    if (scope !== runtimeScopeVersion || version !== runtimeMetadataVersion) return;
    if (edits !== runtimeMetadataEditSequence) { runtimeMessage('Your notes changed while loading. Select the record again to replace the draft.', true); return; }
    const record = response.record || response; runtimeMetadataSelected = record; runtimeMetadataDirty = false; runtimeRenderMetadata();
    const metadata = record.value?.metadata || {}, editable = Array.isArray(record.editable) ? record.editable : [];
    $('rtMetadataEditor').innerHTML = '<div class="row"><h3>' + rtEsc(rtMetadataLabel(record)) + '</h3><span id="rtMetadataDirty" class="dirty"></span></div>' + rtFacts([['Kind', record.kind || kind], ['ID', record.id], ['Revision', record.revision], ['Updated', rtDate(record.updatedAt)], ['Principal', record.owner?.principalId], ['Chat / task', record.owner?.storyId]]) + '<div class="rt-annotation-grid"><label for="rtMetadataLabel">Label</label><input id="rtMetadataLabel" maxlength="200" value="' + rtEsc(metadata.label) + '"' + (editable.includes('label') ? '' : ' disabled') + '><label for="rtMetadataTags">Tags</label><input id="rtMetadataTags" value="' + rtEsc((metadata.tags || []).join(', ')) + '"' + (editable.includes('tags') ? '' : ' disabled') + '><label for="rtMetadataNotes">Notes</label><textarea id="rtMetadataNotes" rows="6" maxlength="8192"' + (editable.includes('notes') ? '' : ' disabled') + '>' + rtEsc(metadata.notes || '') + '</textarea></div><div class="row"><button id="rtMetadataSave" class="primary"' + (editable.length ? '' : ' disabled') + '>Save notes</button><button id="rtMetadataReload">Reload record</button></div><p id="rtMetadataMessage" class="hint" role="status"></p>' + rtDisclosure('Stored data · read only', record.value, true);
    ['rtMetadataLabel', 'rtMetadataTags', 'rtMetadataNotes'].forEach(name => $(name).addEventListener('input', () => { runtimeMetadataEditSequence++; runtimeMetadataDirty = true; $('rtMetadataDirty').textContent = 'Unsaved notes'; }));
    $('rtMetadataReload').onclick = () => runtimeSelectMetadata(kind, id);
    $('rtMetadataSave').onclick = () => runtimeSaveMetadata(kind, id);
  } catch (error) { if (scope === runtimeScopeVersion) runtimeMessage(error.message, true); }
}
async function runtimeSaveMetadata(kind, id) {
  const record = runtimeMetadataSelected; if (!record || record.id !== id) return;
  const scope = runtimeScopeVersion, version = runtimeMetadataVersion, edits = runtimeMetadataEditSequence, button = $('rtMetadataSave'); button.disabled = true;
  const patch = { label: $('rtMetadataLabel').value, notes: $('rtMetadataNotes').value, tags: $('rtMetadataTags').value.split(',').map(tag => tag.trim()).filter(Boolean) };
  try {
    const response = await api('/api/admin/metadata/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id), { expected_revision: record.revision, patch });
    if (scope !== runtimeScopeVersion || version !== runtimeMetadataVersion) return;
    const saved = response.record || response; runtimeMetadataSelected = { ...record, ...saved }; runtimeMetadataDirty = edits !== runtimeMetadataEditSequence; $('rtMetadataDirty').textContent = runtimeMetadataDirty ? 'Unsaved notes' : '';
    $('rtMetadataMessage').textContent = 'Notes saved. Revision ' + (saved.revision || 'updated') + '.' + (runtimeMetadataDirty ? ' Newer edits are still unsaved.' : '');
    await runtimeLoadMetadata();
  } catch (error) { if (scope === runtimeScopeVersion && version === runtimeMetadataVersion) { $('rtMetadataMessage').textContent = error.message + ' Your draft is preserved. Reload to read the current record.'; $('rtMetadataMessage').className = 'err-text'; } }
  finally { if (scope === runtimeScopeVersion && runtimeMetadataSelected?.id === id) button.disabled = false; }
}
function runtimeCodeDefaults(tool) {
  const schema = tool?.inputSchema || { properties: {} }, value = {};
  for (const [key, property] of Object.entries(schema.properties || {})) {
    if (property.default !== undefined) value[key] = property.default;
    else if ((schema.required || []).includes(key)) value[key] = property.type === 'string' ? '' : property.type === 'integer' || property.type === 'number' ? 0 : property.type === 'boolean' ? false : property.type === 'array' ? [] : {};
  }
  if (tool?.name === 'code' || tool?.name === 'code_start') value.code = 'text({ message: "Ready", at: new Date().toISOString() });';
  return value;
}
function runtimeCodeSchema(reset = false) {
  const tool = runtimeTools.find(tool => tool.name === $('rtCodeTool').value);
  $('rtCodeDescription').textContent = tool ? tool.description + '\n\n' + rtJson(tool.inputSchema) : 'No code tools are enabled in this configuration.';
  $('rtCodeRun').disabled = !tool || runtimeCodePending; if (reset) $('rtCodeArgs').value = rtJson(runtimeCodeDefaults(tool));
}
async function runtimeLoadCodeTools() {
  try {
    runtimeTools = (await api('/api/tools')).filter(tool => ['code', 'code_start', 'code_wait', 'code_resume', 'code_status', 'code_cancel', 'code_cell', 'code_poll', 'execution_list', 'execution_get', 'execution_cancel'].includes(tool.name));
    $('rtCodeTool').innerHTML = runtimeTools.map(tool => '<option>' + rtEsc(tool.name) + '</option>').join(''); runtimeCodeSchema(true);
    $('rtCodeStatus').textContent = '';
  } catch (error) { $('rtCodeStatus').textContent = error.message; }
}
function rtNativeView(view) {
  if (typeof view !== 'string') return null;
  try { const url = new URL(view, location.href), route = url.pathname.match(/\/(?:show|view|logs|pr|map|map-preview|files|passport)\/[^/]+$/); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !route) return null; return route[0] + url.search + (url.search ? '&' : '?') + 'embed=1'; } catch { return null; }
}
async function runtimeRunCode() {
  if (runtimeCodePending) return;
  let args; try { args = JSON.parse($('rtCodeArgs').value); if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Arguments must be a JSON object'); } catch (error) { $('rtCodeStatus').textContent = error.message; return; }
  const name = $('rtCodeTool').value, scope = runtimeScopeVersion; runtimeCodePending = true; $('rtCodeRun').disabled = true; $('rtCodeStatus').textContent = 'Running ' + name + '…';
  try {
    const response = await api('/api/tool/' + encodeURIComponent(name), args); if (scope !== runtimeScopeVersion) return;
    const result = response.result; const view = rtNativeView(result?.view), rows = Array.isArray(result) ? result : result?.rows || result?.calls || result?.pending;
    $('rtCodeOutput').innerHTML = (view ? '<iframe id="rtCodeView" class="rt-code-view" title="Code tool visualization" sandbox="allow-scripts allow-popups allow-downloads"></iframe>' : rtTable(rows)) + rtDisclosure('Code result', result, !view);
    if (view) $('rtCodeView').src = view;
    const state = result?.state || result?.status; $('rtCodeStatus').textContent = state ? 'Cell ' + state + (result?.id || result?.cellId ? ' · ' + (result.id || result.cellId) : '') : result?.error ? 'Tool returned an error; inspect the result.' : 'Completed.';
    if (result?.id || result?.cellId || result?.cell_id) {
      const cell = result.id || result.cellId || result.cell_id, controls = document.createElement('div'); controls.className = 'row';
      for (const target of runtimeTools.filter(tool => /^code_(?:resume|wait|status|poll|cancel)$/.test(tool.name))) { const button = document.createElement('button'); button.textContent = 'Prepare ' + target.name; button.onclick = () => { $('rtCodeTool').value = target.name; const values = runtimeCodeDefaults(target), properties = target.inputSchema?.properties || {}; const key = ['id', 'cell_id', 'cell', 'cellId'].find(key => key in properties) || 'id'; values[key] = cell; if ('cursor' in properties && result.nextCursor != null) values.cursor = result.nextCursor; $('rtCodeArgs').value = rtJson(values); runtimeCodeSchema(); $('rtCodeArgs').focus(); }; controls.append(button); }
      $('rtCodeOutput').prepend(controls);
    }
    await loadRuntime();
  } catch (error) { if (scope === runtimeScopeVersion) $('rtCodeStatus').textContent = error.message; }
  finally { runtimeCodePending = false; if (scope === runtimeScopeVersion) $('rtCodeRun').disabled = false; }
}
async function runtimeChangeScope(event) {
  event?.preventDefault();
  if (runtimeCodePending) { $('rtScopeStatus').textContent = 'Wait for the code tool response before changing scope.'; return; }
  if (!runtimeMetadataCanLeave() || typeof contextCanLeave === 'function' && !contextCanLeave()) return;
  const story = $('rtStory').value.trim() || 'default', principal = runtimeState?.identity?.role === 'admin' ? $('rtPrincipal').value.trim() : '';
  const identifier = /^[a-zA-Z0-9][\w.:-]{0,159}$/;
  if (!identifier.test(story) || principal && !identifier.test(principal)) { $('rtScopeStatus').textContent = 'Use up to 160 letters, digits, dots, colons, underscores or hyphens, starting with a letter or digit.'; return; }
  runtimeStory = story; runtimePrincipal = principal; runtimeStore.set('story', story); runtimeStore.set('principal', principal);
  runtimeScopeVersion++; runtimeMetadataVersion++; runtimeSelected = null; runtimeMetadataSelected = null; runtimeMetadataDirty = false; runtimeMetadata = []; runtimeMetadataCursor = null;
  if (runtimeState) runtimeState = { ...runtimeState, executions: [], jobs: [] };
  $('rtExecutions').replaceChildren(); $('rtMetadataList').replaceChildren();
  $('rtExecution').innerHTML = '<div class="empty">Select an execution in this chat / task.</div>'; $('rtMetadataEditor').innerHTML = '<div class="empty">Select a record in this chat / task.</div>';
  $('rtCodeOutput').replaceChildren(); runtimeCodeSchema(true); runtimeMessage('Reading selected scope…');
  if (typeof contextState !== 'undefined') { contextState = null; contextFile = null; $('cxEditor').hidden = true; }
  if (typeof adminMapResult !== 'undefined') adminMapResult = null;
  $('cxMapPanel').hidden = true; $('cxMapFrame').src = 'about:blank'; $('cxMapPreview').src = 'about:blank';
  $('calls').replaceChildren(); $('job').innerHTML = '<div class="empty">Select a job in this chat / task.</div>';
  if (typeof selectedJob !== 'undefined') selectedJob = null;
  await loadRuntime(); await refresh(); await runtimeLoadMetadata();
  if (tab === 'context') await loadContexts(); if (tab === 'history') await loadHistory();
  runtimeMessage('Scope applied. New tools and requests use this chat / task.');
}
function runtimeViewMessage(event) {
  const frame = $('rtCodeView');
  if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'iframe:height' || !Number.isFinite(event.data.height)) return;
  frame.style.height = Math.max(72, Math.min(1100, Math.ceil(event.data.height))) + 'px';
}
function runtimeInit() {
  $('rtScopeForm').onsubmit = runtimeChangeScope; $('rtRefresh').onclick = () => loadRuntime();
  $('rtSearch').oninput = runtimeRenderExecutions; $('rtState').onchange = runtimeRenderExecutions;
  $('rtLive').onchange = () => { clearTimeout(runtimeTimer); if ($('rtLive').checked) loadRuntime(); };
  $('rtMetadataKind').onchange = () => { runtimeMetadataCursor = null; runtimeLoadMetadata(); };
  $('rtMetadataRefresh').onclick = () => runtimeLoadMetadata(); $('rtMetadataMore').onclick = () => runtimeLoadMetadata(true);
  $('rtCodeTool').onchange = () => runtimeCodeSchema(true); $('rtCodeSchema').onclick = () => runtimeCodeSchema(true); $('rtCodeRun').onclick = runtimeRunCode;
  $('rtOpenConfig').onclick = () => show('config');
  document.addEventListener('click', event => {
    const execution = event.target.closest('[data-rt-execution]'); if (execution) { if (tab !== 'runtime') show('runtime'); runtimeSelectExecution(execution.dataset.rtExecution); }
    const record = event.target.closest('[data-rt-record]'); if (record) runtimeSelectMetadata(record.dataset.rtKind, record.dataset.rtRecord);
    if (event.target.closest('[data-tab="runtime"]')) { if (!runtimeMetadata.length) runtimeLoadMetadata(); if (!runtimeTools.length) runtimeLoadCodeTools(); }
  });
  window.addEventListener('beforeunload', event => { if (runtimeMetadataDirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('message', runtimeViewMessage);
  loadRuntime(); if (tab === 'runtime') { runtimeLoadMetadata(); runtimeLoadCodeTools(); }
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', runtimeInit);
if (typeof module !== 'undefined') module.exports = { rtTimeline, rtExecutionTree, rtTable, rtCancellation, runtimeCodeDefaults, rtNativeView };
