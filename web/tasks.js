(() => {
  'use strict';
  const $ = id => document.getElementById(id), q = new URLSearchParams(location.search);
  const headers = {'content-type':'application/json',...(q.get('story') ? {'x-dt-story':q.get('story')} : {})};
  let runs = [], selected = null, capability, subscription, busy = false, file = null, memory = [], refreshTimer, refreshing = false, refreshAgain = false, panel = 'brief', reportRun = null;
  const repos = new Set(), events = new Map(), drafts = new Map(); let fileEpoch = 0, latestMemory = null;
  const label = state => String(state || '').replaceAll('_',' ');
  const stamp = value => value ? new Date(value).toLocaleString() : '';
  const settled = r => ['completed','cancelled'].includes(r.state);
  function message(text, error = false) {
    const summary = $('message'); summary.textContent = text; summary.classList.toggle('error',error); summary.setAttribute('aria-live',error ? 'assertive' : 'polite');
    if (error) { summary.focus({preventScroll:true}); summary.scrollIntoView({block:'nearest'}); }
  }
  async function tool(name, args = {}) {
    const response = await fetch('/api/tool/' + name,{method:'POST',headers,credentials:'same-origin',body:JSON.stringify(args)});
    const value = await response.json(); if (!response.ok || value.error) throw Error(value.error || 'Request failed (' + response.status + ')'); return value.result ?? value;
  }
  function node(tag, content, cls) { const n = document.createElement(tag); if (content !== undefined) n.textContent = content; if (cls) n.className = cls; return n; }
  function link(caption, url) { const n = node('a',caption); n.href = url; n.target = '_blank'; n.rel = 'noopener'; return n; }
  function download(value, name, type = 'application/json') { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([value],{type})); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  function renderList() {
    const query = $('taskFilter').value.toLowerCase(), state = $('stateFilter').value;
    const visible = runs.filter(r => (!query || (r.title + ' ' + r.goal + ' ' + r.taskId).toLowerCase().includes(query)) && (!state || state === 'active' && ['queued','running','waiting'].includes(r.state) || state === 'attention' && ['needs_attention','paused'].includes(r.state) || r.state === state));
    $('taskList').replaceChildren(...visible.map(r => {
      const b = node('button',undefined,'task-item'); b.append(node('strong',r.title),node('span',[r.taskId,label(r.state),r.counts.toolCalls + ' tool calls'].filter(Boolean).join(' · '))); b.setAttribute('aria-current',String(r.id === selected?.id ? 'page' : 'false')); b.onclick = () => select(r.id).catch(e => message(e.message,true)); return b;
    }));
    if (!visible.length) $('taskList').append(node('p',runs.length ? 'No matching tasks.' : 'No saved runs yet. Start a task to build lasting knowledge.','muted'));
  }
  async function loadList() { const result = await tool('task_run_list'); runs = result.runs; renderList(); }
  function showPanel(name) {
    panel = name; for (const b of $('runTabs').children) { const on = b.dataset.panel === name; b.setAttribute('aria-current',on ? 'page' : 'false'); $('panel-' + b.dataset.panel).hidden = !on; }
    if (name === 'memory') loadMemory().catch(e => message(e.message,true));
    if (name === 'context') tool('task_run_status',{run:selected.id,detail:true}).then(async r => { if (selected?.id !== r.id) return; const request = r.context?.requestPath ? await tool('task_run_memory',{run:r.id,path:r.context.requestPath}) : null; if (selected?.id !== r.id) return; $('contextRaw').textContent = JSON.stringify({context:r.context,lastOutgoingRequest:request ? JSON.parse(request.content) : null,activeMessages:r.messages,pending:r.pending},null,2); $('reportText').textContent = r.report || ''; }).catch(e => message(e.message,true));
  }
  function renderRun(r) {
    selected = r; $('createPane').hidden = true; $('runPane').hidden = false;
    $('runTitle').textContent = r.title; $('runIdentity').textContent = r.id; $('runState').textContent = label(r.state); $('runState').dataset.state = r.state;
    $('runReason').textContent = r.reason || (r.state === 'running' ? 'Working on the next evidence-backed step.' : 'Admitted on the server; the browser may be closed.');
    $('runGoal').textContent = r.goal;
    const disabled = !!r.controlPending || settled(r); $('pauseRun').disabled = disabled || ['paused','needs_attention'].includes(r.state); $('resumeRun').disabled = disabled || !['paused','needs_attention'].includes(r.state); $('stopRun').disabled = disabled;
    $('continueTask').hidden = !settled(r) && r.state !== 'needs_attention'; $('steerForm').hidden = settled(r);
    if (r.controlPending) $('runReason').textContent += ' · ' + r.controlPending + ' awaiting acknowledgement';
    $('checkpoint').disabled = !['paused','needs_attention'].includes(r.state); $('resolveForm').hidden = !(r.state === 'needs_attention' && r.pending?.kind === 'tool');
    $('budget').textContent = r.counts.steps + '/' + r.spec.maxSteps + ' steps · ' + r.counts.modelCalls + ' model calls · ' + r.counts.tokens.toLocaleString() + '/' + r.spec.maxTokens.toLocaleString() + ' tokens · deadline ' + stamp(r.deadline);
    $('runScope').replaceChildren();
    for (const [title,value] of Object.entries({Mode:r.mode,Repositories:r.spec.repositories.join(', ') || 'No repository required',Confluence:r.spec.spaces.join(', ') || 'Relevant configured pages',Environment:r.spec.env || 'Default configured environment','Global knowledge':r.spec.publish ? r.spec.projectContext + ' · automatic publication authorized' : 'Private task memory','Restart recovery':r.spec.autoResume ? 'Enabled' : 'Manual resume'})) $('runScope').append(node('dt',title),node('dd',value));
    $('watchDetails').replaceChildren(); if (r.watch) $('watchDetails').append(node('h3','Waiting for CI / review'),node('p',r.watch.tool + ' · SHA ' + r.watch.arguments.sha),node('p','Next observation: ' + stamp(r.watch.dueAt) + '. Deadline: ' + stamp(r.watch.deadline) + '. Unchanged polls do not call the model.','muted'));
    $('workspaceLinks').replaceChildren(...r.workspaces.map(id => link('Editor & terminal · ' + id,'/editor?' + new URLSearchParams({workspace:id,task_run:r.id}))));
    if (!r.workspaces.length) $('workspaceLinks').append(node('p','No checkout yet. Research can use repository reads without a workspace.','muted'));
    $('publication').replaceChildren(); if (r.publication) $('publication').append(node('p','Published global revision ' + r.publication.revision.slice(0,12)),link('Open global context','/admin#context?project=' + encodeURIComponent(r.publication.id)));
    for (const publication of r.codePublications || []) { $('publication').append(node('p',publication.branch + ' · ' + publication.commit.slice(0,12) + ' · ' + label(publication.review?.state || publication.state))); if (publication.pr?.url) $('publication').append(link('Open draft PR',publication.pr.url)); }
    $('contextSummary').textContent = 'Active context is inspectable and compaction stays explicit. ' + r.counts.modelCalls + ' model requests have been admitted.';
    $('finalReport').hidden = r.state !== 'completed';
    if (r.state === 'completed' && reportRun !== r.id) { reportRun = r.id; tool('task_run_memory',{run:r.id,path:'runs/' + r.id + '/report.md'}).then(result => { if (selected?.id === r.id) $('reportText').textContent = result.content; }).catch(e => { reportRun = null; message(e.message,true); }); }
    if (r.reset) events.clear(); for (const event of r.events) events.set(event.cursor,event); renderEvents();
    const at = runs.findIndex(x => x.id === r.id); if (at >= 0) runs[at] = r; else runs.unshift(r); renderList();
    if (file) { $('memoryContent').readOnly = !['paused','needs_attention','completed','cancelled'].includes(r.state); $('saveMemory').disabled = $('memoryContent').readOnly; }
  }
  function renderEvents() {
    const all = [...events.values()].sort((a,b) => b.cursor - a.cursor), draw = e => {
      const li = node('li'), time = node('time',stamp(e.at)); li.dataset.cursor = e.cursor; time.dateTime = e.at;
      const details = node('details'), summary = node('summary',label(e.type) + (e.tool ? ' · ' + e.tool : '') + (e.failed ? ' · failed' : ''));
      details.append(summary,node('pre',e.message || e.preview || JSON.stringify(e,null,2))); if (e.artifact) { const b = node('button','Open evidence'); b.onclick = () => { showPanel('memory'); openFile('runs/' + selected.id + '/' + e.artifact).catch(err => message(err.message,true)); }; details.append(b); }
      if (e.type === 'blocked' || e.failed) details.open = true; li.append(time,details); return li;
    };
    // Keep existing disclosure nodes attached: a live update must not close
    // evidence or discard the keyboard focus of someone inspecting it.
    const reconcile = (list,items) => {
      const retained = new Map([...list.children].map(li => [Number(li.dataset.cursor),li])), keep = new Set(items.map(e => e.cursor));
      for (const li of [...list.children]) if (!keep.has(Number(li.dataset.cursor))) li.remove();
      let before = list.firstElementChild;
      for (const e of items) { const li = retained.get(e.cursor) || draw(e); if (li !== before) list.insertBefore(li,before); before = li.nextElementSibling; }
    };
    reconcile($('activity'),all.slice(0,300));
    const checks = all.filter(e => /test|coverage|jenkins|bitbucket_pr/.test(e.tool || '') || e.type.startsWith('watch.'));
    if (checks.length) { let list = $('checkResults').querySelector('ol'); if (!list) { list = node('ol',undefined,'activity-list'); $('checkResults').replaceChildren(list); } reconcile(list,checks.slice(0,100)); }
    else if (!$('checkResults').querySelector('p')) $('checkResults').replaceChildren(node('p','No checks or review observations recorded yet. Research-only tasks may finish without running code.','muted'));
  }
  async function refresh() {
    if (!selected) return; if (refreshing) { refreshAgain = true; return; } refreshing = true;
    const id = selected.id;
    try { const r = await tool('task_run_status',{run:id,after:selected.cursor}); if (selected?.id === id) renderRun(r); }
    catch (e) { message(e.message,true); }
    finally { refreshing = false; if (refreshAgain) { refreshAgain = false; refresh(); } }
  }
  async function select(id) {
    subscription?.close(); clearTimeout(refreshTimer); events.clear(); file = null; reportRun = null; latestMemory = null; $('memoryConflict').hidden = true; $('activity').replaceChildren(); $('checkResults').replaceChildren(); $('reportText').textContent = ''; $('memoryContent').value = ''; $('memoryPath').textContent = 'Select a retained file';
    const r = await tool('task_run_status',{run:id}); renderRun(r); history.replaceState(null,'','/tasks?' + new URLSearchParams({run:id,...(q.get('story') ? {story:q.get('story')} : {})}));
    subscription = window.DTToolSocket?.subscribe({channel:'task:' + id,headers,onEvent:() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh,100); },onReady:refresh,onState:state => { $('connection').textContent = state === 'connected' ? 'Live updates · saved server state' : state + ' · periodic recovery enabled'; }});
    showPanel(panel); if (r.state === 'completed') { const report = await tool('task_run_status',{run:id,detail:true}); if (selected?.id === id) $('reportText').textContent = report.report || ''; }
  }
  async function loadMemory() {
    if (!selected) return; const id = selected.id, result = await tool('task_run_memory',{run:id}); if (selected?.id !== id) return; memory = result.index.files; drawTree();
  }
  function drawTree() {
    const tree = new Map(), query = $('memoryFilter').value.toLowerCase();
    for (const f of memory.filter(f => (f.path + ' ' + f.summary).toLowerCase().includes(query))) { const parts = f.path.split('/'); let at = tree; parts.forEach((part,i) => { if (!at.has(part)) at.set(part,{children:new Map()}); const entry = at.get(part); if (i === parts.length - 1) entry.file = f; at = entry.children; }); }
    const draw = (data,depth = 0) => [...data].map(([name,value]) => { if (value.file) { const b = node('button',name,'memory-tree-file'); b.title = value.file.summary || value.file.path; b.onclick = () => openFile(value.file.path).catch(e => message(e.message,true)); return b; } const d = node('details'); d.open = depth < 1 || !!query; const children = node('div',undefined,'memory-folder'); children.append(...draw(value.children,depth + 1)); d.append(node('summary',name),children); return d; });
    $('memoryTree').replaceChildren(...draw(tree)); if (!tree.size) $('memoryTree').append(node('p','No matching files. Findings appear as the worker saves them.','muted'));
  }
  async function openFile(path) {
    const id = selected.id, epoch = ++fileEpoch; $('memoryPath').textContent = 'Loading ' + path + '…'; $('saveMemory').disabled = true;
    const result = await tool('task_run_memory',{run:id,path}); if (selected?.id !== id || epoch !== fileEpoch) return;
    const draft = drafts.get(id + ':' + path); file = draft ? {...result,revision:draft.revision} : result; $('memoryPath').textContent = result.path + (draft ? ' · unsaved draft restored' : ''); $('memoryContent').value = draft?.content ?? result.content;
    latestMemory = null; $('memoryConflict').hidden = true; if (draft && draft.revision !== result.revision) showConflict(result);
    $('memoryContent').readOnly = !['paused','needs_attention','completed','cancelled'].includes(selected.state); $('saveMemory').disabled = $('memoryContent').readOnly; $('downloadMemory').disabled = false;
  }
  function showConflict(result) { latestMemory = result; $('memoryConflict').hidden = false; $('memoryConflict').open = true; $('latestMemory').textContent = 'Server revision ' + result.revision + '\n\n' + result.content; $('mergeMemory').disabled = false; }
  $('reloadMemory').onclick = async () => { if (!file || !selected) return; const id = selected.id, path = file.path; try { const result = await tool('task_run_memory',{run:id,path}); if (selected?.id === id && file?.path === path) showConflict(result); } catch (e) { message(e.message,true); } };
  $('mergeMemory').onclick = () => { if (!latestMemory || !file || !selected) return; file.revision = latestMemory.revision; drafts.set(selected.id + ':' + file.path,{content:$('memoryContent').value,revision:file.revision}); $('memoryConflict').hidden = true; message('Your merged draft now uses the latest revision. Review it and Save edited file.'); $('memoryContent').focus(); };
  async function sendControl(action,messageText = '') { if (!selected) return; message('Saving ' + action + '…'); const r = await tool('task_run_control',{run:selected.id,action,message:messageText}); renderRun(r); message(action + ' saved. Waiting for worker acknowledgement.'); setTimeout(refresh,300); }
  function chosen() { $('chosenRepos').replaceChildren(...[...repos].map(repo => { const li = node('li',repo), b = node('button','Remove'); b.type = 'button'; b.onclick = () => { repos.delete(repo); chosen(); }; li.append(b); return li; })); }
  $('addRepo').onclick = () => { const repo = $('repoText').value.trim() || $('repoPick').value; if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return message('Choose or enter PROJECT/repository.',true); repos.add(repo); $('repoText').value = ''; chosen(); };
  $('mode').onchange = () => { $('codePolicy').hidden = $('mode').value !== 'change'; };
  $('loadRepos').onclick = async () => { $('loadRepos').disabled = true; $('sourceStatus').textContent = 'Loading repositories…'; try { const result = await tool('bitbucket_repos',{filter:$('repoQuery').value}), rows = result.rows || result; $('repoPick').replaceChildren(new Option('Choose a repository',''),...rows.map(r => new Option(r.project + '/' + r.repo,r.project + '/' + r.repo))); $('sourceStatus').textContent = rows.length + ' of ' + (result.total || rows.length) + ' repositories. Filter names to narrow results.'; } catch (e) { $('sourceStatus').textContent = e.message; } finally { $('loadRepos').disabled = false; } };
  $('createTask').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; $('start').disabled = true; message('Saving task and execution permission…');
    try {
      const r = await tool('task_run_start',{title:$('title').value,goal:$('goal').value,...($('ticket').value ? {ticket:$('ticket').value} : {}),...($('existingTask').value ? {task:$('existingTask').value} : {}),mode:$('mode').value,publish_code:$('mode').value === 'change' && $('publishCode').checked,branch:$('taskBranch').value.trim(),target_branch:$('targetBranch').value.trim(),repositories:[...repos],spaces:$('spaces').value.split(',').map(v => v.trim()).filter(Boolean),env:$('environment').value.trim(),project_context:$('projectContext').value.trim(),publish:$('publish').checked,allow_model:true,auto_resume:$('autoResume').checked,max_steps:Number($('maxSteps').value),max_tokens:Number($('maxTokens').value),hours:Number($('hours').value)});
      message('Task saved. The server owns execution; you may close this browser.'); await select(r.id);
    } catch (e) { message(e.message,true); } finally { busy = false; $('start').disabled = !capability?.configured; }
  };
  $('newTask').onclick = () => { subscription?.close(); selected = null; events.clear(); $('createPane').hidden = false; $('runPane').hidden = true; history.replaceState(null,'','/tasks'); renderList(); $('title').focus(); };
  $('continueTask').onclick = () => {
    const r = selected; $('newTask').click();
    if (![...$('existingTask').options].some(o => o.value === r.task)) $('existingTask').append(new Option(r.title,r.task));
    $('existingTask').value = r.task; $('title').value = r.title; $('goal').value = r.goal + '\n\nContinue from retained task memory; verify source freshness before reuse.';
    repos.clear(); for (const repo of r.spec.repositories) repos.add(repo); chosen(); $('spaces').value = r.spec.spaces.join(', '); $('environment').value = r.spec.env; $('projectContext').value = r.spec.projectContext; $('publish').checked = r.spec.publish;
    $('mode').value = r.mode; $('mode').onchange(); $('publishCode').checked = r.spec.publishCode; $('taskBranch').value = r.spec.branch; $('targetBranch').value = r.spec.targetBranch;
    message('A new run will use this task’s lasting memory. Review the goal and permissions, then Start.');
  };
  $('taskFilter').oninput = renderList; $('stateFilter').onchange = renderList;
  $('refreshTasks').onclick = () => loadList().then(refresh).catch(e => message(e.message,true));
  for (const [id,action] of [['pauseRun','pause'],['resumeRun','resume'],['stopRun','stop']]) $(id).onclick = () => sendControl(action).catch(e => message(e.message,true));
  $('steerForm').onsubmit = event => { event.preventDefault(); sendControl('steer',$('steerText').value).then(() => { $('steerText').value = ''; }).catch(e => message(e.message,true)); };
  $('checkpointForm').onsubmit = event => { event.preventDefault(); sendControl('checkpoint',$('checkpointText').value).catch(e => message(e.message,true)); };
  $('resolveForm').onsubmit = event => { event.preventDefault(); sendControl('resolve',$('resolveText').value).catch(e => message(e.message,true)); };
  for (const b of $('runTabs').children) b.onclick = () => showPanel(b.dataset.panel);
  $('refreshMemory').onclick = () => loadMemory().catch(e => message(e.message,true)); $('memoryFilter').oninput = drawTree;
  $('memoryContent').oninput = () => { if (file && selected) drafts.set(selected.id + ':' + file.path,{content:$('memoryContent').value,revision:file.revision}); };
  $('saveMemory').onclick = async () => { if (!file || !selected) return; const content = $('memoryContent').value, id = selected.id, path = file.path; $('saveMemory').disabled = true; try { const saved = await tool('task_run_memory',{run:id,path,content,expected_revision:file.revision}); if (selected?.id !== id || file?.path !== path) return; if ($('memoryContent').value === content) { drafts.delete(id + ':' + path); await openFile(path); } else { file.revision = saved.revision; drafts.set(id + ':' + path,{content:$('memoryContent').value,revision:saved.revision}); } message('File saved with revision protection.'); } catch (e) { if (selected?.id === id && file?.path === path) { $('memoryConflict').hidden = false; $('memoryConflict').open = true; $('mergeMemory').disabled = true; $('latestMemory').textContent = 'Your draft is retained. Load the latest server revision to compare before retrying.'; } message(e.message + ' Your draft is preserved.',true); } finally { $('saveMemory').disabled = !selected || !['paused','needs_attention','completed','cancelled'].includes(selected.state); } };
  $('downloadMemory').onclick = () => { if (file) download($('memoryContent').value,file.path.split('/').pop(),'text/plain;charset=utf-8'); };
  $('downloadRun').onclick = async () => { try { download(JSON.stringify(await tool('task_run_status',{run:selected.id,detail:true}),null,2),selected.id + '.json'); } catch (e) { message(e.message,true); } };
  $('copyLink').onclick = async () => { try { await navigator.clipboard.writeText(new URL('/tasks?run=' + selected.id,location.origin).href); message('Task link copied. Access is still private to its owner.'); } catch { message('Copy this task URL from the address bar.'); } };
  async function boot() {
    capability = await tool('task_run_catalog'); $('modelStatus').textContent = capability.configured ? 'Model: ' + capability.model : 'Configure model in Admin first'; $('start').disabled = !capability.configured;
    $('publish').disabled = !capability.canPublish; $('publishHelp').textContent = capability.canPublish ? 'Standing permission for this run. Existing global content and immutable history are preserved.' : 'Everyone can read global knowledge. Only admins may publish; this task will retain private findings.';
    await loadList();
    await Promise.allSettled([
      tool('project_context_find').then(r => $('projectOptions').replaceChildren(...r.contexts.map(p => new Option(p.title,p.id)))),
      tool('continuation_find').then(r => $('existingTask').append(...r.continuations.map(t => new Option(t.taskId + ' · ' + t.title,t.id)))),
    ]);
    if (q.get('run')) await select(q.get('run')); else if (runs.length) await select(runs[0].id);
    $('connection').textContent = 'Saved server state';
  }
  // Recovery polling is read-only, never a model request or a task restart.
  const recovery = setInterval(() => { if (!document.hidden) { if (selected) refresh(); else loadList().catch(() => {}); } },10000);
  addEventListener('beforeunload',() => { clearInterval(recovery); subscription?.close(); });
  boot().catch(e => message(e.message,true));
})();
