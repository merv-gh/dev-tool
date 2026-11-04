// Context editor and scratchpad use the same authenticated tools as CLI/MCP.
let contextPending = 0, contextReadSequence = 0, contextFormRevision = null, contextSelectSequence = 0, contextEditSequence = 0;
let contextState = null, contextFile = null, contextDirty = false, contextMetaDirty = false, contextFileDirty = false, contextTools = [], contextLoaded = false;
const contextCall = async (name, args) => (await api('/api/tool/' + name, args)).result;
const contextLinks = ['tickets', 'repositories', 'workspaces', 'chats', 'tasks', 'tags'];
function contextMessage(message, error = false) { $('cxMessage').textContent = message; $('cxMessage').className = error ? 'err-text' : 'hint'; }
function contextCanLeave(inOperation = false) { if (contextPending && !inOperation) { contextMessage('Wait for the current operation to finish.'); return false; } return !contextDirty || confirm('Discard unsaved context edits?'); }
function contextMarkDirty(file) { contextEditSequence++; if (file) contextFileDirty = true; else contextMetaDirty = true; contextDirty = true; $('cxDirty').textContent = 'Unsaved edits'; }
function contextClearDirty() { contextDirty = contextMetaDirty = contextFileDirty = false; $('cxDirty').textContent = ''; }
function contextRestoreMetadata() { if (!contextState) return; contextFormRevision = contextState.revision; $('cxTitle').value = contextState.title; $('cxSummary').value = contextState.summary || ''; $('cxStatus').value = contextState.status; contextLinks.forEach(k => $('cx-' + k).value = contextState[k].join(', ')); }
async function loadContexts() {
  if (!contextLoaded) {
    contextLoaded = true;
    $('cxSearch').oninput = () => { clearTimeout(loadContexts.searchTimer); loadContexts.searchTimer = setTimeout(() => contextList().catch(e => contextMessage(e.message, true)), 250); };
    $('cxNew').onclick = () => {
      if (!contextCanLeave()) return;
      contextSelectSequence++; contextState = null; contextFile = null; contextClearDirty(); $('cxEditor').hidden = false; $('cxWorking').hidden = true;
      $('cxTitle').value = ''; $('cxSummary').value = ''; $('cxStatus').value = 'active'; contextLinks.forEach(k => $('cx-' + k).value = ''); $('cxDirty').textContent = ''; $('cxTitle').focus(); contextMessage('Give this task a title and stable identifiers so other chats can find it.');
    };
    $('cxSaveMeta').onclick = () => contextBusy($('cxSaveMeta'), async () => {
      const a = { title: $('cxTitle').value, summary: $('cxSummary').value, status: $('cxStatus').value };
      contextLinks.forEach(k => a[k] = $('cx-' + k).value.split(',').map(v => v.trim()).filter(Boolean));
      const r = contextState ? await contextCall('context_update', { ...a, id: contextState.id, expected_revision: contextFormRevision }) : await contextCall('context_open', a);
      if (r.ambiguous) { contextMessage('An existing folder may match. Open it from the results; no folder was created.', true); $('cxSearch').value = a.tickets[0] || a.tasks[0] || a.chats[0] || ''; await contextList(); return; }
      const wasNew = !contextState; contextState = r; contextFormRevision = r.revision; contextMetaDirty = false; contextDirty = contextFileDirty; $('cxDirty').textContent = contextDirty ? 'Unsaved file edits' : ''; if (wasNew) await contextSelect(r.id, true); else await contextReload(); await contextList(); contextMessage('Context index saved.');
    });
    $('cxSaveFile').onclick = () => contextBusy($('cxSaveFile'), contextSaveFile);
    $('cxNewFile').onclick = () => {
      if (!contextCanLeave()) return;
      contextRestoreMetadata(); contextClearDirty(); contextFile = null; $('cxPath').value = ''; $('cxFileSummary').value = ''; $('cxContent').value = ''; $('cxEncoding').value = 'utf8'; contextDirty = false; $('cxDirty').textContent = ''; $('cxPath').focus();
    };
    $('cxDeleteFile').onclick = () => contextBusy($('cxDeleteFile'), async () => {
      if (!contextState || !contextFile) throw new Error('Select a saved file first');
      if (!confirm(`Delete ${contextFile.path}?`)) return;
      await contextCall('context_delete_file', { id: contextState.id, path: contextFile.path, expected_revision: contextFile.revision });
      contextRestoreMetadata(); contextClearDirty(); contextFile = null; $('cxContent').value = ''; $('cxPath').value = ''; await contextReload(); contextMessage('File deleted.');
    });
    $('cxPreviewButton').onclick = () => { $('cxPreview').hidden = !$('cxPreview').hidden; $('cxPreview').textContent = $('cxContent').value || 'Empty file'; };
    $('cxUpload').onchange = () => contextBusy($('cxUpload'), async () => {
      const file = $('cxUpload').files[0]; if (!file || !contextState || !contextCanLeave(true)) return;
      if (file.size > 1024 * 1024) throw new Error('Choose a file up to 1 MiB');
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      await contextCall('context_write', { id: contextState.id, path: file.name, content: btoa(binary), encoding: 'base64', summary: file.name, expected_revision: null });
      await contextReload(); await contextRead(file.name, true); contextMessage('File uploaded.'); $('cxUpload').value = '';
    });
    $('cxDownload').onclick = () => contextBusy($('cxDownload'), async () => {
      if (!contextState || !contextFile) throw new Error('Select a saved file first');
      const r = await contextCall('context_read', { id: contextState.id, path: contextFile.path, encoding: 'base64' });
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.content), c => c.charCodeAt(0))]));
      const link = document.createElement('a'); link.href = url; link.download = r.path.split('/').pop(); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('cxToolFilter').oninput = contextToolList;
    $('cxTool').onchange = () => contextToolSchema(true);
    $('cxHint').onclick = () => contextBusy($('cxHint'), async () => {
      if (!contextState) throw new Error('Open a context first');
      if (!$('cxGoal').value.trim()) throw new Error('Describe what you want to do');
      const r = await contextCall('context_hint', { id: contextState.id, goal: $('cxGoal').value.trim(), use_model: $('cxUseModel').checked });
      $('cxHintOutput').textContent = r.guidance + '\n' + (r.suggestion ? r.suggestion.explanation + '\nMissing: ' + JSON.stringify(r.suggestion.missing || []) + (r.validation.length ? '\nNeeds edits: ' + JSON.stringify(r.validation) : '') : r.candidates.map(t => t.name + ': ' + t.description.slice(0, 150)).join('\n'));
      if (r.suggestion) { $('cxToolFilter').value = ''; contextToolList(); $('cxTool').value = r.suggestion.tool; contextToolSchema(false); $('cxArgs').value = JSON.stringify(r.suggestion.arguments, null, 2); }
    });
    $('cxRun').onclick = () => contextBusy($('cxRun'), async () => {
      if (!contextState) throw new Error('Open a context first');
      const name = $('cxTool').value; if (!name) throw new Error('Select a tool');
      let args; try { args = JSON.parse($('cxArgs').value); } catch { throw new Error('Arguments must be valid JSON'); }
      $('cxRunOutput').textContent = 'Running ' + name + '…';
      const r = await contextCall('context_run', { id: contextState.id, tool: name, arguments: args, summary: $('cxGoal').value.slice(0, 300) });
      try { const captured = JSON.parse(r.preview); if (captured.result?.view && typeof adminMapOpen === 'function' && new URL(captured.result.view, location.href).pathname.startsWith('/map/')) await adminMapOpen(captured.result.view, args.env || env()); } catch {}
      $('cxRunOutput').textContent = r.preview + (r.truncated ? '\n\nPreview truncated. Open the saved file for the full result.' : '') + (r.saveError ? '\n\nCAPTURE FAILED: ' + r.saveError + '\n' + r.guidance : '');
      $('cxCaptured').textContent = r.saved ? 'Open saved result: ' + r.saved : ''; $('cxCaptured').hidden = !r.saved;
      $('cxCaptured').onclick = () => contextRead(r.saved).catch(e => contextMessage(e.message, true));
      await contextReload(); contextMessage(r.ok ? r.saved ? 'Tool completed; result saved.' : 'Tool completed; saving failed. Do not rerun just to save it.' : 'Tool failed; inspect the captured error.', !r.ok || !!r.saveError);
    });
    $('cxEditor').addEventListener('input', e => { if (e.target.closest('[data-context-edit]')) contextMarkDirty(!!e.target.closest('#cxFileEdits')); });
    window.addEventListener('beforeunload', e => { if (contextDirty) { e.preventDefault(); e.returnValue = ''; } });
  }
  if (!contextTools.length) {
    contextTools = (await api('/api/tools')).filter(t => !t.name.startsWith('context_') && !['tool_execute', 'tool_search', 'tool_describe', 'tool_profiles'].includes(t.name));
    contextToolList();
  }
  await contextList();
}
async function contextBusy(button, fn) {
  const controls = [...document.querySelectorAll('#tab-context button, #tab-context input, #tab-context select, #tab-context textarea')].map(el => [el, el.disabled]);
  const label = button.textContent; button.textContent = 'Working…';
  contextPending++; controls.forEach(([el]) => el.disabled = true); button.disabled = true;
  try { await fn(); } catch (e) { contextMessage(e.message, true); } finally { contextPending--; controls.forEach(([el, disabled]) => el.disabled = disabled); button.disabled = false; button.textContent = label; }
}
async function contextList() {
  const query = $('cxSearch').value.trim(); const r = await contextCall('context_find', { query, limit: 100 });
  // Discard an out-of-order search response.
  if (query !== $('cxSearch').value.trim()) return;
  $('cxList').replaceChildren();
  $('cxCount').textContent = `${r.total} context${r.total === 1 ? '' : 's'}`;
  for (const c of r.contexts) {
    const b = document.createElement('button'); b.className = 'cx-item' + (contextState?.id === c.id ? ' on' : '');
    const title = document.createElement('strong'); title.textContent = c.title;
    const sub = document.createElement('span'); sub.textContent = [c.status, ...c.tickets, ...c.repositories].join(' · ');
    const summary = document.createElement('span'); summary.textContent = c.summary || c.id;
    b.append(title, sub, summary); b.onclick = () => contextSelect(c.id).catch(e => contextMessage(e.message, true)); $('cxList').append(b);
  }
  if (!r.contexts.length) $('cxList').textContent = 'No contexts yet. Create one for a task, or search by ticket, repository or workspace.';
  if (r.errors.length) contextMessage(`${r.errors.length} context indexes could not be read. Repair their index.json files to include them in search.`, true);
}
async function contextSelect(id, force = false) {
  if (!force && !contextCanLeave()) return;
  const selection = ++contextSelectSequence, editSequence = contextEditSequence;
  const c = await contextCall('context_get', { id });
  if (selection !== contextSelectSequence) return;
  if (editSequence !== contextEditSequence) { contextMessage('Your draft changed while loading. Select the context again to replace it.', true); return; }
  contextState = c; contextFormRevision = c.revision; contextFile = null; contextClearDirty();
  $('cxEditor').hidden = false; $('cxWorking').hidden = false; $('cxTitle').value = c.title; $('cxSummary').value = c.summary || ''; $('cxStatus').value = c.status;
  contextLinks.forEach(k => $('cx-' + k).value = c[k].join(', ')); $('cxDirty').textContent = ''; $('cxLocation').textContent = c.folder;
  $('cxPath').value = ''; $('cxContent').value = ''; $('cxFileSummary').value = ''; $('cxPreview').hidden = true;
  $('cxRunOutput').textContent = 'Run a tool to save its arguments and result here.'; $('cxCaptured').hidden = true; $('cxHintOutput').textContent = '';
  contextFileList(); await contextList();
  if (!contextDirty && selection === contextSelectSequence && contextState.id === c.id && c.files.some(f => f.path === 'progress.md')) await contextRead('progress.md', true);
}
async function contextReload() {
  const c = await contextCall('context_get', { id: contextState.id }); contextState = c; if (!contextMetaDirty) contextRestoreMetadata(); contextFileList(); await contextList();
}
function contextFileList() {
  $('cxFiles').replaceChildren();
  for (const f of contextState.files) {
    const b = document.createElement('button'); b.className = 'cx-file'; b.textContent = f.path + ' · ' + f.bytes.toLocaleString() + ' B'; b.title = f.summary;
    b.onclick = () => contextRead(f.path).catch(e => contextMessage(e.message, true)); $('cxFiles').append(b);
  }
}
async function contextRead(file, force = false) {
  if (!force && !contextCanLeave()) return;
  const readingId = contextState.id, sequence = ++contextReadSequence, editSequence = contextEditSequence;
  const binary = !/\.(md|txt|json|js|ts|sql|ya?ml|csv|xml|html|sh|log|py|java|kt|properties)$/i.test(file);
  const r = await contextCall('context_read', { id: contextState.id, path: file, encoding: binary ? 'base64' : 'utf8' });
  if (contextState?.id !== readingId || sequence !== contextReadSequence) return;
  if (editSequence !== contextEditSequence) { contextMessage('Your draft changed while loading. Select the file again to replace it.', true); return; }
  contextRestoreMetadata(); contextClearDirty(); contextFile = r; $('cxPath').value = r.path; $('cxContent').value = r.content; $('cxEncoding').value = r.encoding;
  $('cxFileSummary').value = contextState.files.find(f => f.path === file)?.summary || ''; $('cxPreview').hidden = true; contextDirty = false; $('cxDirty').textContent = '';
  contextMessage(binary ? 'Binary file shown as base64. Download to open it in its native application.' : 'File loaded. Save edits to keep them for other chats.');
}
async function contextSaveFile() {
  const file = $('cxPath').value.trim(); if (!file) throw new Error('Enter a relative file name');
  const r = await contextCall('context_write', { id: contextState.id, path: file, content: $('cxContent').value, summary: $('cxFileSummary').value, encoding: $('cxEncoding').value, expected_revision: contextFile?.path === file ? contextFile.revision : null });
  contextFile = r; contextFileDirty = false; contextDirty = contextMetaDirty; $('cxDirty').textContent = contextDirty ? 'Unsaved context edits' : ''; await contextReload(); contextMessage('File saved.');
}
function contextToolList() {
  const current = $('cxTool').value, q = $('cxToolFilter').value.toLowerCase(); $('cxTool').replaceChildren();
  for (const t of contextTools.filter(t => (t.name + ' ' + t.description).toLowerCase().includes(q))) { const o = document.createElement('option'); o.value = t.name; o.textContent = t.name; $('cxTool').append(o); }
  if ([...$('cxTool').options].some(o => o.value === current)) $('cxTool').value = current;
  contextToolSchema(false);
}
function contextToolSchema(reset) {
  const t = contextTools.find(t => t.name === $('cxTool').value); $('cxSchema').textContent = t ? t.description + '\n\n' + JSON.stringify(t.inputSchema, null, 2) : 'No matching tools.';
  if (reset && t) {
    const args = {}; for (const [k, s] of Object.entries(t.inputSchema.properties || {})) if (s.default !== undefined) args[k] = s.default; else if (t.inputSchema.required?.includes(k)) args[k] = s.type === 'object' ? {} : s.type === 'array' ? [] : s.type === 'boolean' ? false : ['integer', 'number'].includes(s.type) ? 0 : '';
    $('cxArgs').value = JSON.stringify(args, null, 2);
  }
}
