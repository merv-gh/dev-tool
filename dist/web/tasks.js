(() => {
  'use strict';
  const $ = id => document.getElementById(id), q = new URLSearchParams(location.search);
  const headers = {'content-type':'application/json',...(q.get('story') ? {'x-dt-story':q.get('story')} : {})};
  let runs = [], selected = null, capability, subscription, busy = false, file = null, memory = [], refreshTimer, refreshing = false, refreshAgain = false, panel = 'brief', reportRun = null;
  const repos = new Set(), events = new Map(), drafts = new Map(), composerDrafts = new Map(); let fileEpoch = 0, latestMemory = null, selectionEpoch = 0, inspectorEpoch = 0, inspectionOrigin = null, followLatest = true, lastCursor = -1, controlNotice = null, steeringSubmitting = false;
  const conversation = window.DTTaskConversation;
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
  function safeUrl(value) { try { const url = new URL(value,location.origin); return ['http:','https:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
  function link(caption, url) { const n = node('a',caption), safe = safeUrl(url); if (safe) n.href = safe; n.target = '_blank'; n.rel = 'noopener noreferrer'; return n; }
  // Render a deliberately small Markdown vocabulary as DOM text, never HTML.
  function prose(host,text) {
    host.replaceChildren(); const inline = (parent,value) => { const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g; let at = 0;
      for (const match of value.matchAll(pattern)) { parent.append(document.createTextNode(value.slice(at,match.index))); const token = match[0]; if (token.startsWith('**')) parent.append(node('strong',token.slice(2,-2))); else if (token.startsWith('`')) parent.append(node('code',token.slice(1,-1))); else { const [,caption,url] = token.match(/^\[(.*?)\]\((.*?)\)$/); parent.append(safeUrl(url) ? link(caption,url) : document.createTextNode(caption)); } at = match.index + token.length; } parent.append(document.createTextNode(value.slice(at))); };
    let code = null, paragraph = []; const flush = () => { if (paragraph.length) { const p = node('p'); inline(p,paragraph.join('\n')); host.append(p); paragraph = []; } };
    for (const line of String(text || '').split('\n')) { if (line.startsWith('```')) { flush(); if (code) { host.append(node('pre',code.join('\n'))); code = null; } else code = []; } else if (code) code.push(line); else if (!line.trim()) flush(); else if (/^#{1,4} /.test(line)) { flush(); const h = node('h3'); inline(h,line.replace(/^#{1,4} /,'')); host.append(h); } else paragraph.push(line); } if (code) host.append(node('pre',code.join('\n'))); flush();
  }
  function nearLatest() { const s = $('conversationScroll'); return s.scrollHeight - s.scrollTop - s.clientHeight < 64; }
  function jumpLatest() { $('conversationScroll').scrollTop = $('conversationScroll').scrollHeight; followLatest = true; $('latestBar').hidden = true; }
  function revealInspector() { if (!$('inspector').contains(document.activeElement)) inspectionOrigin = document.activeElement; $('inspector').hidden = false; $('openDetails').setAttribute('aria-expanded','true'); }
  const followUpNeeded = r => settled(r) || conversation.status(r).action === 'continue';
  function visualization(views) {
    const choices = (views || []).filter(v => { try { const u = new URL(v.url,location.origin); return u.origin === location.origin && /^\/(show|view|map|map-preview|logs|pr|architecture)\/[a-z0-9]+$/.test(u.pathname); } catch { return false; } }).slice(0,8);
    if (!choices.length) return node('p','No saved visualization is available. Inspect the raw result below.','hint');
    const root = node('div',undefined,'native-preview'), toolbar = node('div',undefined,'native-toolbar'), status = node('p','Loading saved visualization…','hint native-status'), frame = node('iframe',undefined,'task-result-frame'), select = node('select');
    select.setAttribute('aria-label','Result visualization'); choices.forEach((v,i) => select.append(new Option(v.label + ' · ' + v.view,String(i))));
    const open = link('Open full result',choices[0].url), retry = node('button','Reload preview'); retry.type = 'button'; frame.setAttribute('sandbox','allow-scripts allow-popups allow-downloads'); frame.title = 'Saved tool result visualization'; frame.loading = 'lazy';
    const load = () => { const v = choices[Number(select.value) || 0]; frame.title = v.label + ' · ' + v.view; open.href = v.url; status.textContent = 'Loading saved ' + v.view + ' visualization…'; root.dataset.ready = 'false'; (globalThis.DTToolSocket?.resultFrame || ((f,u)=>{f.src=u;}))(frame,v.url); setTimeout(() => { if (root.isConnected && root.dataset.ready !== 'true') status.textContent = 'Preview has not confirmed readiness. Reload, open the full result, or inspect raw evidence below. This does not rerun the tool.'; },8000); };
    select.onchange = load; retry.onclick = load; toolbar.append(select,open,retry); root.append(toolbar,status,frame); load(); return root;
  }
  addEventListener('message',event => { if (event.data?.type !== 'iframe:height' || !Number.isFinite(event.data.height)) return; for (const frame of document.querySelectorAll('iframe.task-result-frame')) if (frame.contentWindow === event.source) { frame.style.height = Math.max(180,Math.min(700,event.data.height + 8)) + 'px'; const root = frame.closest('.native-preview'); root.dataset.ready = 'true'; root.querySelector('.native-status').textContent = 'Saved result · no tool replay'; } });
  function download(value, name, type = 'application/json') { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([value],{type})); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  function renderList() {
    const query = $('taskFilter').value.toLowerCase(), state = $('stateFilter').value;
    const visible = runs.filter(r => (!query || (r.title + ' ' + r.goal + ' ' + r.taskId).toLowerCase().includes(query)) && (!state || state === 'active' && ['queued','running','waiting'].includes(r.state) || state === 'attention' && ['needs_attention','paused'].includes(r.state) || r.state === state));
    const list = $('taskList'), retained = new Map([...list.children].map(b => [b.dataset.run,b])), keep = new Set(visible.map(r => r.id));
    for (const b of [...list.children]) if (!keep.has(b.dataset.run)) b.remove();
    let before = list.firstElementChild;
    for (const r of visible) {
      let b = retained.get(r.id); if (!b) { b = node('button',undefined,'task-item'); b.dataset.run = r.id; b.append(node('strong'),node('span')); b.onclick = () => select(r.id).catch(e => message(e.message,true)); }
      if (b.firstElementChild.textContent !== r.title) b.firstElementChild.textContent = r.title;
      b.lastElementChild.textContent = [r.taskId,label(r.state),r.counts.toolCalls + ' tool calls'].filter(Boolean).join(' · '); b.setAttribute('aria-current',r.id === selected?.id ? 'page' : 'false');
      if (b !== before) list.insertBefore(b,before); before = b.nextElementSibling;
    }
    if (!visible.length) list.append(node('p',runs.length ? 'No matching tasks.' : 'No saved runs yet. Start a task to build lasting knowledge.','muted'));
  }
  async function loadList() { const result = await tool('task_run_list'); runs = result.runs; renderList(); }
  function showPanel(name) {
    if (!selected) return; revealInspector(); inspectorEpoch++; panel = name; $('receiptPanel').hidden = true; $('inspectorTitle').textContent = 'Task details';
    for (const b of $('runTabs').children) { const on = b.dataset.panel === name; b.setAttribute('aria-current',on ? 'page' : 'false'); $('panel-' + b.dataset.panel).hidden = !on; }
    if (name === 'memory') loadMemory().catch(e => message(e.message,true));
    if (name === 'context') tool('task_run_status',{run:selected.id,detail:true}).then(async r => { if (selected?.id !== r.id) return; const request = r.context?.requestPath ? await tool('task_run_memory',{run:r.id,path:r.context.requestPath}) : null; if (selected?.id !== r.id) return; $('contextRaw').textContent = JSON.stringify({context:r.context,lastOutgoingRequest:request ? JSON.parse(request.content) : null,activeMessages:r.messages,pending:r.pending},null,2); }).catch(e => message(e.message,true));
    $('inspector').focus({preventScroll:true});
  }
  async function inspectReceipt(event) {
    revealInspector(); const epoch = ++inspectorEpoch, id = selected.id; panel = 'receipt';
    for (const b of $('runTabs').children) { b.setAttribute('aria-current','false'); $('panel-' + b.dataset.panel).hidden = true; }
    $('inspectorTitle').textContent = 'Tool evidence'; $('receiptPanel').hidden = false; $('receiptTitle').textContent = conversation.toolName(event.tool); $('receiptBody').textContent = 'Loading the original retained receipt…'; $('receiptFile').hidden = true; $('inspector').focus({preventScroll:true});
    try { const path = 'runs/' + id + '/' + event.artifact, result = await tool('task_run_memory',{run:id,path}); if (selected?.id !== id || epoch !== inspectorEpoch) return;
      const receipt = JSON.parse(result.content); $('receiptBody').replaceChildren();
      const views = receipt.visualizations || event.visualizations || (typeof receipt.result?.view === 'string' ? [{label:'Result',url:receipt.result.view,view:'native'}] : []);
      if (views.length) $('receiptBody').append(visualization(views));
      if (receipt.presentationError) $('receiptBody').append(node('p',receipt.presentationError,'hint'));
      const exact = node('details'), raw = node('details'); exact.append(node('summary','Exact inputs')); raw.append(node('summary','Raw result'));
      let inputs; try { inputs = typeof receipt.arguments === 'string' ? JSON.parse(receipt.arguments) : receipt.arguments; } catch { inputs = receipt.arguments; }
      exact.append(node('pre',JSON.stringify(inputs,null,2))); raw.append(node('pre',typeof receipt.result === 'string' ? receipt.result : JSON.stringify(receipt.result,null,2))); raw.open = !views.length; $('receiptBody').append(exact,raw);
      $('receiptFile').hidden = false; $('receiptFile').onclick = () => { showPanel('memory'); openFile(path).catch(e => message(e.message,true)); };
    } catch (e) { if (selected?.id === id && epoch === inspectorEpoch) { $('receiptBody').textContent = 'Could not load retained evidence: ' + e.message; const retry = node('button','Retry receipt'); retry.onclick = () => inspectReceipt(event); $('receiptBody').append(retry); } }
  }
  function renderRun(r) {
    if (selected?.id === r.id && r.cursor < selected.cursor) return;
    const moved = r.cursor !== lastCursor, stick = followLatest || nearLatest(); lastCursor = r.cursor;
    selected = r; $('createPane').hidden = true; $('runPane').hidden = false;
    $('runTitle').textContent = r.title; $('runIdentity').textContent = r.id; $('runState').textContent = label(r.state); $('runState').dataset.state = r.state;
    const current = conversation.status(r); $('currentAction').textContent = current.title; $('runReason').textContent = current.detail; $('statusBanner').dataset.state = r.state;
    $('runSubtitle').textContent = [r.taskId,r.mode === 'change' ? 'Prepare change' : 'Research',r.spec.repositories.join(', ')].filter(Boolean).join(' · ');
    $('recoverRun').hidden = !current.action; $('recoverRun').textContent = current.action === 'context' ? 'Review context' : current.action === 'resolve' ? 'Reconcile outcome' : current.action === 'checks' ? 'View checks' : current.action === 'continue' ? 'Prepare next run' : 'Review details';
    $('recoverRun').onclick = () => { if (current.action === 'continue') return $('continueTask').click(); showPanel(current.action === 'resolve' ? 'context' : current.action); if (current.action === 'context') $('checkpointText').focus(); if (current.action === 'resolve') $('resolveText').focus(); };
    $('runGoal').textContent = r.goal; if ($('chatGoal').dataset.run !== r.id) { prose($('chatGoal'),r.goal); $('chatGoal').dataset.run = r.id; } $('goalTime').textContent = new Date(r.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); $('goalTime').dateTime = r.createdAt;
    const disabled = !!r.controlPending || settled(r); $('pauseRun').disabled = disabled || ['paused','needs_attention'].includes(r.state); $('resumeRun').disabled = disabled || !['paused','needs_attention'].includes(r.state); $('stopRun').disabled = disabled;
    $('pauseRun').hidden = settled(r) || ['paused','needs_attention'].includes(r.state); $('resumeRun').hidden = !['paused','needs_attention'].includes(r.state); $('stopRun').hidden = settled(r);
    if (r.state === 'needs_attention' && (/context|compact/i.test(r.reason || '') || current.action === 'continue')) $('resumeRun').disabled = true;
    $('continueTask').hidden = !settled(r) && r.state !== 'needs_attention'; $('finished').hidden = true; $('steerForm').hidden = false;
    const followUp = followUpNeeded(r); document.querySelector('label[for=steerText]').textContent = followUp ? 'Follow up on this task' : 'Message the worker'; $('sendSteer').textContent = followUp ? 'Prepare follow-up' : 'Send';
    $('sendSteer').disabled = steeringSubmitting || !!r.controlPending; $('composerHint').textContent = followUp ? 'Prepares a new run with retained memory · review before starting' : r.controlPending ? 'Instruction saved · waiting for worker acknowledgement. You can keep typing.' : 'Saved now · received at the next safe boundary';
    $('checkpoint').disabled = !!r.controlPending || !['paused','needs_attention'].includes(r.state); $('resolveForm').hidden = !(r.state === 'needs_attention' && r.pending?.kind === 'tool');
    $('budget').textContent = r.counts.steps + '/' + r.spec.maxSteps + ' steps · ' + r.counts.modelCalls + ' model calls · ' + r.counts.tokens.toLocaleString() + '/' + r.spec.maxTokens.toLocaleString() + ' tokens · deadline ' + stamp(r.deadline);
    $('usageSummary').textContent = r.counts.toolCalls + ' tool calls · ' + r.counts.modelCalls + ' model calls · ' + r.counts.tokens.toLocaleString() + ' tokens · saved on server';
    $('runScope').replaceChildren();
    for (const [title,value] of Object.entries({Mode:r.mode,Repositories:r.spec.repositories.join(', ') || 'No repository required',Confluence:r.spec.spaces.join(', ') || 'Relevant configured pages',Environment:r.spec.env || 'Default configured environment','Global knowledge':r.spec.publish ? r.spec.projectContext + ' · automatic publication authorized' : 'Private task memory','Restart recovery':r.spec.autoResume ? 'Enabled' : 'Manual resume'})) $('runScope').append(node('dt',title),node('dd',value));
    $('watchDetails').replaceChildren(); if (r.watch) $('watchDetails').append(node('h3','Waiting for CI / review'),node('p',r.watch.tool + (r.watch.arguments.sha ? ' · SHA ' + r.watch.arguments.sha : '')),node('pre',JSON.stringify(r.watch.arguments,null,2)),node('p','Next observation: ' + stamp(r.watch.dueAt) + '. Deadline: ' + stamp(r.watch.deadline) + '. Unchanged polls do not call the model.','muted'));
    if (r.watch) $('runReason').textContent += ' Next observation: ' + stamp(r.watch.dueAt) + '.';
    $('workspaceLinks').replaceChildren(...r.workspaces.map(id => link('Editor & terminal · ' + id,'/editor?' + new URLSearchParams({workspace:id,task_run:r.id}))));
    if (!r.workspaces.length) $('workspaceLinks').append(node('p','No checkout yet. Research can use repository reads without a workspace.','muted'));
    $('publication').replaceChildren(); if (r.publication) $('publication').append(node('p','Published global revision ' + r.publication.revision.slice(0,12)),link('Open global context','/admin#context?project=' + encodeURIComponent(r.publication.id)));
    for (const publication of r.codePublications || []) { $('publication').append(node('p',publication.branch + ' · ' + publication.commit.slice(0,12) + ' · ' + label(publication.review?.state || publication.state))); if (publication.pr?.url) $('publication').append(link('Open draft PR',publication.pr.url)); }
    $('contextSummary').textContent = 'Active context is inspectable and compaction stays explicit. ' + r.counts.modelCalls + ' model requests have been admitted.';
    $('finalReport').hidden = r.state !== 'completed';
    if (r.state === 'completed' && reportRun !== r.id) { reportRun = r.id; $('reportText').textContent = 'Loading the saved response…'; tool('task_run_memory',{run:r.id,path:'runs/' + r.id + '/report.md'}).then(result => { if (selected?.id === r.id) { const follow = followLatest || nearLatest(); prose($('reportText'),result.content); if (follow) requestAnimationFrame(jumpLatest); } }).catch(e => { if (selected?.id === r.id) { reportRun = null; $('reportText').textContent = 'Saved response could not be loaded. Refresh to retry.'; message(e.message,true); } }); }
    if (r.reset) events.clear(); for (const event of r.events) events.set(event.cursor,event); renderEvents(); renderConversation();
    if (controlNotice?.id === r.id && [...events.values()].some(e => e.type === 'control' && e.action === controlNotice.action && e.cursor > controlNotice.cursor)) { controlNotice = null; message(''); }
    if (moved && stick) requestAnimationFrame(() => { if (selected?.id === r.id && followLatest) jumpLatest(); });
    const at = runs.findIndex(x => x.id === r.id); if (at >= 0) runs[at] = r; else runs.unshift(r); renderList();
    if (file) { $('memoryContent').readOnly = !['paused','needs_attention','completed','cancelled'].includes(r.state); $('saveMemory').disabled = $('memoryContent').readOnly; }
  }
  function renderConversation() {
    const list = $('conversation'), all = [...events.values()], rows = conversation.rows(all), lastModel = [...all].reverse().find(e => e.type === 'model.completed');
    const meaningful = rows.filter(row => !(selected.state === 'completed' && row.key === 'message-' + lastModel?.cursor && !lastModel.tools?.length));
    if (selected.pendingControl?.action === 'steer') meaningful.push({key:'pending-steer',kind:'user',at:selected.pendingControl.at,text:selected.pendingControl.message,acknowledged:false});
    const shown = meaningful.slice(-300), retained = new Map([...list.children].map(li => [li.dataset.key,li]));
    $('historyNotice').hidden = meaningful.length <= 300 && (!all.length || Math.min(...all.map(e => e.cursor)) <= 1);
    for (const li of [...list.children]) if (!shown.some(row => row.key === li.dataset.key)) li.remove();
    let before = list.firstElementChild;
    for (const row of shown) {
      let li = retained.get(row.key);
      if (!li) {
        li = node('li',undefined,row.kind === 'work' ? 'work-message' : row.kind === 'failure' ? 'tool-failure' : row.kind === 'blocker' ? 'chat-blocker' : row.kind === 'notice' ? 'chat-notice' : 'chat-message ' + (row.kind === 'user' ? 'user-message' : 'assistant-message')); li.dataset.key = row.key;
        if (row.kind === 'work') { const d = node('details',undefined,'tool-work'); d.append(node('summary'),node('div',undefined,'tool-rows')); li.append(d); }
        else if (row.kind === 'failure') { li.append(node('strong',conversation.toolName(row.event.tool) + ' failed'),node('p',row.event.preview)); if (row.event.artifact) { const b = node('button','Inspect failure'); b.onclick = () => inspectReceipt(row.event); li.append(b); } }
        else if (['user','assistant'].includes(row.kind)) { const by = node('div',row.kind === 'user' ? 'You' : 'Assistant','message-byline'), time = node('time',new Date(row.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})); time.dateTime = row.at; by.append(time); if (row.kind === 'user') by.append(node('span',row.acknowledged ? 'Received by worker' : 'Saved · awaiting acknowledgement','instruction-state')); const content = node('div',undefined,'message-content'); prose(content,row.text); li.append(by,content); if (row.truncated) { const b = node('button','Inspect full model context'); b.onclick = () => showPanel('context'); li.append(b); } }
        else li.append(node('p',row.text));
      }
      if (row.kind === 'work') { const d = li.firstElementChild, summary = d.querySelector('summary'), container = d.querySelector('.tool-rows'); summary.textContent = row.events.length + ' tool ' + (row.events.length === 1 ? 'call' : 'calls') + ' · ' + [...new Set(row.events.map(e => conversation.toolName(e.tool)))].slice(0,3).join(', '); for (const e of row.events) if (!container.querySelector('[data-cursor="' + e.cursor + '"]')) { const b = node('button'), text = node('span',conversation.toolName(e.tool),'tool-label'); text.append(node('small',e.tool)); b.type = 'button'; b.dataset.cursor = e.cursor; b.append(text,node('span',Number.isFinite(e.durationMs) ? (e.durationMs < 1000 ? e.durationMs + 'ms' : (e.durationMs / 1000).toFixed(1) + 's') : 'Receipt','tool-duration')); b.onclick = () => inspectReceipt(e); container.append(b); if (e.visualizations?.length) { const preview = node('details',undefined,'inline-tool-visualization'), body = node('div'); preview.append(node('summary','Show result · ' + conversation.toolName(e.tool)),body); preview.ontoggle = () => { if (preview.open && !body.firstChild) body.append(visualization(e.visualizations)); else if (!preview.open) body.replaceChildren(); }; d.append(preview); } } }
      if (li !== before) list.insertBefore(li,before); before = li.nextElementSibling;
    }
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
    if (selected) composerDrafts.set(selected.id,$('steerText').value);
    const epoch = ++selectionEpoch; selected = null; inspectorEpoch++; subscription?.close(); clearTimeout(refreshTimer); events.clear(); file = null; fileEpoch++; reportRun = null; latestMemory = null; lastCursor = -1; followLatest = true; $('memoryConflict').hidden = true; $('activity').replaceChildren(); $('conversation').replaceChildren(); $('checkResults').replaceChildren(); $('reportText').textContent = ''; $('memoryContent').value = ''; $('memoryPath').textContent = 'Select a retained file'; $('inspector').hidden = true; $('openDetails').setAttribute('aria-expanded','false');
    const r = await tool('task_run_status',{run:id}); if (epoch !== selectionEpoch) return; $('steerText').value = composerDrafts.get(id) || ''; renderRun(r); document.querySelector('.task-desk').dataset.view = 'conversation'; history.replaceState(null,'','/tasks?' + new URLSearchParams({run:id,...(q.get('story') ? {story:q.get('story')} : {})}));
    subscription = window.DTToolSocket?.subscribe({channel:'task:' + id,headers,onEvent:() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh,100); },onReady:refresh,onState:state => { $('connection').textContent = state === 'connected' ? 'Live updates · saved server state' : state + ' · periodic recovery enabled'; }});
    requestAnimationFrame(() => { if (selected?.id === id) jumpLatest(); });
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
    const draft = drafts.get(id + ':' + path); file = draft ? {...result,revision:draft.revision} : result; $('memoryPath').textContent = result.path.split('/').slice(-2).join('/') + (draft ? ' · unsaved draft restored' : ''); $('memoryPath').title = result.path; $('memoryContent').value = draft?.content ?? result.content;
    latestMemory = null; $('memoryConflict').hidden = true; if (draft && draft.revision !== result.revision) showConflict(result);
    $('memoryContent').readOnly = !['paused','needs_attention','completed','cancelled'].includes(selected.state); $('saveMemory').disabled = $('memoryContent').readOnly; $('downloadMemory').disabled = false;
  }
  function showConflict(result) { latestMemory = result; $('memoryConflict').hidden = false; $('memoryConflict').open = true; $('latestMemory').textContent = 'Server revision ' + result.revision + '\n\n' + result.content; $('mergeMemory').disabled = false; }
  $('reloadMemory').onclick = async () => { if (!file || !selected) return; const id = selected.id, path = file.path; try { const result = await tool('task_run_memory',{run:id,path}); if (selected?.id === id && file?.path === path) showConflict(result); } catch (e) { message(e.message,true); } };
  $('mergeMemory').onclick = () => { if (!latestMemory || !file || !selected) return; file.revision = latestMemory.revision; drafts.set(selected.id + ':' + file.path,{content:$('memoryContent').value,revision:file.revision}); $('memoryConflict').hidden = true; message('Your merged draft now uses the latest revision. Review it and Save edited file.'); $('memoryContent').focus(); };
  async function sendControl(action,messageText = '') { if (!selected) return; const id = selected.id; controlNotice = {id,action,cursor:selected.cursor}; message('Saving ' + action + '…'); try { const r = await tool('task_run_control',{run:id,action,message:messageText}); if (selected?.id !== id) return; renderRun(r); if (controlNotice) message(action + ' saved. Waiting for worker acknowledgement.'); setTimeout(refresh,300); } catch (e) { controlNotice = null; throw e; } }
  function chosen() { $('chosenRepos').replaceChildren(...[...repos].map(repo => { const li = node('li',repo), b = node('button','Remove'); b.type = 'button'; b.onclick = () => { repos.delete(repo); chosen(); }; li.append(b); return li; })); }
  $('addRepo').onclick = () => { const repo = $('repoText').value.trim() || $('repoPick').value; if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return message('Choose or enter PROJECT/repository.',true); repos.add(repo); $('repoText').value = ''; chosen(); };
  $('mode').onchange = () => { $('codePolicy').hidden = $('mode').value !== 'change'; };
  $('loadRepos').onclick = async () => { $('loadRepos').disabled = true; $('sourceStatus').textContent = 'Loading repositories…'; try { const result = await tool('bitbucket_repos',{filter:$('repoQuery').value}), rows = result.rows || result; $('repoPick').replaceChildren(new Option('Choose a repository',''),...rows.map(r => new Option(r.project + '/' + r.repo,r.project + '/' + r.repo))); $('sourceStatus').textContent = rows.length + ' of ' + (result.total || rows.length) + ' repositories. Filter names to narrow results.'; } catch (e) { $('sourceStatus').textContent = e.message; } finally { $('loadRepos').disabled = false; } };
  $('createTask').onsubmit = async event => {
    event.preventDefault(); if (busy) return; busy = true; $('start').disabled = true; message('Saving task and execution permission…');
    try {
      const r = await tool('task_run_start',{title:$('title').value.trim() || $('goal').value.trim().split('\n')[0].slice(0,100),goal:$('goal').value,...($('ticket').value ? {ticket:$('ticket').value} : {}),...($('existingTask').value ? {task:$('existingTask').value} : {}),mode:$('mode').value,publish_code:$('mode').value === 'change' && $('publishCode').checked,branch:$('taskBranch').value.trim(),target_branch:$('targetBranch').value.trim(),repositories:[...repos],spaces:$('spaces').value.split(',').map(v => v.trim()).filter(Boolean),env:$('environment').value.trim(),project_context:$('projectContext').value.trim(),publish:$('publish').checked,allow_model:true,auto_resume:$('autoResume').checked,max_steps:Number($('maxSteps').value),max_tokens:Number($('maxTokens').value),hours:Number($('hours').value)});
      message('Task saved. The server owns execution; you may close this browser.'); await select(r.id);
    } catch (e) { message(e.message,true); } finally { busy = false; $('start').disabled = !capability?.configured; }
  };
  $('newTask').onclick = () => { if (selected) composerDrafts.set(selected.id,$('steerText').value); selectionEpoch++; inspectorEpoch++; subscription?.close(); clearTimeout(refreshTimer); selected = null; events.clear(); $('createTask').reset(); repos.clear(); chosen(); $('mode').onchange(); $('sourceSettings').open = false; $('createPane').hidden = false; $('runPane').hidden = true; document.querySelector('.task-desk').dataset.view = 'conversation'; history.replaceState(null,'','/tasks' + (q.get('story') ? '?story=' + encodeURIComponent(q.get('story')) : '')); message(''); renderList(); $('goal').focus(); };
  $('continueTask').onclick = () => {
    const r = selected; $('newTask').click();
    if (![...$('existingTask').options].some(o => o.value === r.task)) $('existingTask').append(new Option(r.title,r.task));
    $('existingTask').value = r.task; $('title').value = r.title; $('goal').value = r.goal + '\n\nContinue from retained task memory; verify source freshness before reuse.';
    repos.clear(); for (const repo of r.spec.repositories) repos.add(repo); chosen(); $('spaces').value = r.spec.spaces.join(', '); $('environment').value = r.spec.env; $('projectContext').value = r.spec.projectContext; $('publish').checked = r.spec.publish;
    $('mode').value = r.mode; $('mode').onchange(); $('publishCode').checked = r.spec.publishCode; $('taskBranch').value = r.spec.branch; $('targetBranch').value = r.spec.targetBranch; $('sourceSettings').open = true;
    message('A new run will use this task’s lasting memory. Review the goal and permissions, then Start.');
  };
  $('taskFilter').oninput = renderList; $('stateFilter').onchange = renderList;
  $('refreshTasks').onclick = () => loadList().then(refresh).catch(e => message(e.message,true));
  for (const [id,action] of [['pauseRun','pause'],['resumeRun','resume'],['stopRun','stop']]) $(id).onclick = () => sendControl(action).catch(e => message(e.message,true));
  $('steerForm').onsubmit = event => { event.preventDefault(); if (!$('steerText').value.trim() || !selected || steeringSubmitting) return; const id = selected.id, value = $('steerText').value;
    if (followUpNeeded(selected)) { $('continueTask').click(); $('goal').value = value; message('Follow-up prepared with retained task memory. Review scope, permissions and budget, then Start.'); $('goal').focus(); return; }
    steeringSubmitting = true; $('sendSteer').disabled = true; sendControl('steer',value).then(() => { if (selected?.id === id && $('steerText').value === value) { $('steerText').value = ''; composerDrafts.delete(id); } }).catch(e => message(e.message,true)).finally(() => { steeringSubmitting = false; if (selected?.id === id) $('sendSteer').disabled = !!selected.controlPending; }); };
  $('steerText').oninput = () => { if (selected) composerDrafts.set(selected.id,$('steerText').value); };
  $('steerText').onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !$('sendSteer').disabled) { event.preventDefault(); $('steerForm').requestSubmit(); } };
  $('checkpointForm').onsubmit = event => { event.preventDefault(); sendControl('checkpoint',$('checkpointText').value).catch(e => message(e.message,true)); };
  $('resolveForm').onsubmit = event => { event.preventDefault(); sendControl('resolve',$('resolveText').value).catch(e => message(e.message,true)); };
  for (const b of $('runTabs').children) b.onclick = () => showPanel(b.dataset.panel);
  $('openDetails').onclick = () => showPanel('brief');
  $('closeInspector').onclick = () => { inspectorEpoch++; $('inspector').hidden = true; $('openDetails').setAttribute('aria-expanded','false'); if (inspectionOrigin?.isConnected) { inspectionOrigin.focus({preventScroll:true}); inspectionOrigin.scrollIntoView({block:'nearest'}); } else $('openDetails').focus(); };
  $('jumpLatest').onclick = jumpLatest; $('conversationScroll').onscroll = () => { followLatest = nearLatest(); $('latestBar').hidden = followLatest; };
  const switchView = view => { document.querySelector('.task-desk').dataset.view = view; (view === 'tasks' ? $('newTask') : selected ? $('showTasks') : $('createShowTasks')).focus(); };
  $('showTasks').onclick = $('createShowTasks').onclick = () => switchView('tasks'); $('hideTasks').onclick = () => switchView('conversation');
  $('refreshMemory').onclick = () => loadMemory().catch(e => message(e.message,true)); $('memoryFilter').oninput = drawTree;
  $('memoryContent').oninput = () => { if (file && selected) drafts.set(selected.id + ':' + file.path,{content:$('memoryContent').value,revision:file.revision}); };
  $('saveMemory').onclick = async () => { if (!file || !selected) return; const content = $('memoryContent').value, id = selected.id, path = file.path; $('saveMemory').disabled = true; try { const saved = await tool('task_run_memory',{run:id,path,content,expected_revision:file.revision}); if (selected?.id !== id || file?.path !== path) return; if ($('memoryContent').value === content) { drafts.delete(id + ':' + path); await openFile(path); } else { file.revision = saved.revision; drafts.set(id + ':' + path,{content:$('memoryContent').value,revision:saved.revision}); } message('File saved with revision protection.'); } catch (e) { if (selected?.id === id && file?.path === path) { $('memoryConflict').hidden = false; $('memoryConflict').open = true; $('mergeMemory').disabled = true; $('latestMemory').textContent = 'Your draft is retained. Load the latest server revision to compare before retrying.'; } message(e.message + ' Your draft is preserved.',true); } finally { $('saveMemory').disabled = !selected || !['paused','needs_attention','completed','cancelled'].includes(selected.state); } };
  $('downloadMemory').onclick = () => { if (file) download($('memoryContent').value,file.path.split('/').pop(),'text/plain;charset=utf-8'); };
  $('downloadRun').onclick = async () => { try { download(JSON.stringify(await tool('task_run_status',{run:selected.id,detail:true}),null,2),selected.id + '.json'); } catch (e) { message(e.message,true); } };
  $('copyLink').onclick = async () => { try { await navigator.clipboard.writeText(new URL('/tasks?' + new URLSearchParams({run:selected.id,...(q.get('story') ? {story:q.get('story')} : {})}),location.origin).href); message('Task link copied. Access is still private to its owner.'); } catch { message('Copy this task URL from the address bar.'); } };
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
