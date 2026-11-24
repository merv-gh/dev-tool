'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const query = new URLSearchParams(location.search);
let storage;
try { storage = window.sessionStorage; } catch { storage = {getItem:()=>null,setItem:()=>{throw Error('Storage unavailable');},removeItem:()=>{}}; }
const session = IntentDemo.session(storage);
if (['task','scene','snapshot','state'].some(key=>query.has(key))) session.destination='tasks';
if (['tasks','services','library','operations'].includes(query.get('destination'))) session.destination=query.get('destination');
const tasks = IntentDemo.tasks;
const personScenes = [['findings','Findings'],['request','Request & data'],['source','Source & paths'],['changes','Changes'],['checks','Checks'],['handoff','Handoff']];
const checkoutScenes = [['overnight','Checkpoint'],['source','Source & paths'],['handoff','Handoff']];
let reviewSnapshot = null, storageAvailable = true, toastTimer;
const timers = new Map();
if (tasks.some(t => t.id === query.get('task'))) session.activeTask = query.get('task');
let state = session.tasks[session.activeTask];
if (query.get('snapshot')) {
  try {
    reviewSnapshot = IntentDemo.normalizeTask(session.activeTask, JSON.parse(query.get('snapshot')));
    reviewSnapshot.readOnly = true;
    state = reviewSnapshot;
  } catch { reviewSnapshot = null; }
}
if (query.get('state') === 'readonly') { state = IntentDemo.normalizeTask(state.id,state); state.readOnly = true; reviewSnapshot = state; }
if (query.has('note')) state.note = query.get('note').slice(0,4000);
if (query.get('corrected') === 'true' && !state.corrected && state.id === 'PERS-218') IntentDemo.saveCorrection(state);
if (query.has('scene')) state.scene = query.get('scene');
if (['ready','empty','partial','error'].includes(query.get('state')) && state.id === 'PERS-218') {
  state.scenario = query.get('state'); state.lastResult = IntentDemo.comparison(state.scenario,false); state.requestState = 'retained';
}
if (query.get('state') === 'conflict') { state.revision = Math.max(state.revision,state.draftRevision+1); state.correctionConflict = true; }
if (['paused','cancelled','running'].includes(query.get('state')) && state.id === 'SHOP-142') {
  state.workerStatus = query.get('state') === 'running' ? 'paused' : query.get('state');
  if (query.get('state') === 'running') state.overnightOutput = 'Retained running example paused on opening. Start the local simulation explicitly.';
}
function scenes() { return state.id === 'SHOP-142' ? checkoutScenes : personScenes; }
function validScene(scene,id) { return (id === 'SHOP-142' ? checkoutScenes : personScenes).some(s=>s[0]===scene) || ['start','operations-details'].includes(scene); }
if (!validScene(state.scene,state.id)) state.scene = state.id === 'SHOP-142' ? 'overnight' : 'findings';
function save() {
  if (!state.readOnly) session.tasks[state.id] = state;
  session.activeTask = state.id;
  storageAvailable = IntentDemo.persist(storage,session);
}
function saveTask(task) { if (!task.readOnly) session.tasks[task.id] = task; storageAvailable = IntentDemo.persist(storage,session); }
function announce(message) { $('announcement').textContent=message; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('announcement').textContent='',6000); }
function navigate(scene,task=state.id) {
  save();
  state = reviewSnapshot?.id === task ? reviewSnapshot : session.tasks[task];
  if (!state) state = session.tasks['PERS-218'];
  state.scene = validScene(scene,state.id) ? scene : state.id === 'SHOP-142' ? 'overnight' : 'findings';
  session.destination='tasks'; save();
  if (!state.readOnly) history.replaceState(null,'','demo.html?'+new URLSearchParams({task:state.id,scene:state.scene}));
  render();
}
function statusFor(task) {
  if (task.id === 'SHOP-142') return ({paused:'Simulation paused',running:'Simulation running',completed:'Simulation complete',cancelled:'Simulation stopped'})[task.workerStatus] || 'Needs attention';
  if (task.checkResults?.cases.every(c=>c.passed)) return 'Offline checks passed';
  return task.corrected ? 'Draft saved · unverified' : 'Needs verification';
}
function rail() {
  const q=$('taskSearch').value.toLowerCase();
  $('taskList').innerHTML=tasks.filter(t=>(t.id+' '+t.title+' '+t.service).toLowerCase().includes(q)).map(t=>'<button class="task-pick" data-task="'+t.id+'" aria-pressed="'+(state.id===t.id)+'"><strong>'+t.id+'</strong><span>'+esc(t.title)+'</span><small>'+esc(t.service)+'</small><span class="task-state">'+esc(statusFor(t.id===state.id?state:session.tasks[t.id]))+'</span></button>').join('') || '<p class="note">No matching demo task. Try PERS-218 or SHOP-142.</p>';
  for(const b of document.querySelectorAll('[data-task]')) b.onclick=()=>navigate(session.tasks[b.dataset.task].scene,b.dataset.task);
}
function header() {
  const task=tasks.find(t=>t.id===state.id);
  return '<div class="task-top"><div><p class="breadcrumbs">Tasks / '+esc(state.id)+' / '+esc(task.service)+'</p><h1>'+(state.id==='SHOP-142'?'Gather refund requirements overnight':'Why does an annulled name still appear?')+'</h1></div><div class="top-actions"><span class="state warn">'+esc(statusFor(state))+'</span><button data-go="handoff" class="compact">Share / export</button></div></div><div class="meta-line"><span class="env">DEMO DEV</span><span>'+esc(task.repository)+'</span><code>illustrative-source-v1</code><span>'+(state.readOnly?'Read-only review snapshot':storageAvailable?'Saved in this browser session':'Memory only · browser storage unavailable')+'</span><span>Private local results</span></div>';
}
function tabs() {
  return '<div class="local-tabs" role="tablist" aria-label="Investigation">'+scenes().map(([id,label])=>'<button role="tab" id="task-tab-'+id+'" aria-controls="taskPanel" aria-selected="'+(state.scene===id)+'" tabindex="'+(state.scene===id?0:-1)+'" data-go="'+id+'">'+label+'</button>').join('')+'</div>';
}
function inspector() {
  return '<aside class="inspector" aria-label="Evidence inspector"><h2>Investigation contract</h2><p>Use the newest currently valid, active, non-annulled document’s complete name. Fall back to the complete registry name.</p><dl><dt>Entry point</dt><dd><code>GET /person/{id}</code></dd><dt>Expected exit</dt><dd>One complete, coherent name in the response</dd><dt>Source pin</dt><dd><code>illustrative-source-v1</code><br>Use an exact SHA in the real app.</dd><dt>Evidence limits</dt><dd>Static paths are candidates.<br>No runtime path proof claimed.</dd></dl><h3>What can I do next?</h3><button data-go="source">Inspect the selection path</button><button data-go="request">Compare API and database</button><button data-go="checks">Plan changed-path coverage</button><details><summary>Exact illustrative tool call</summary><pre>'+esc(JSON.stringify({tool:'mapping_debug',arguments:{action:'discover',workspace:'selected-task-workspace'}},null,2))+'</pre><p class="note">Illustration only; no call sent or executable workspace selected.</p></details></aside>';
}
function composer() {
  return '<form class="composer" id="steering"><label for="steer">Steer this investigation</label><textarea id="steer" '+(state.readOnly?'disabled':'')+' placeholder="For example: check the unresolved source before publication.">'+esc(state.steeringDraft)+'</textarea><div class="row"><small>Instructions stay in this browser session.<br>No model or worker is contacted.</small><button type="submit" '+(state.readOnly?'disabled':'')+'>Save instruction locally</button></div></form>';
}
function instructions() {
  return state.steering.map(n=>'<article class="message"><div class="speaker"><strong>You</strong><span>Saved in this session · worker not contacted</span></div><p>'+esc(n)+'</p></article>').join('');
}
function findings() {
  return '<div class="investigation"><div class="conversation"><article class="message"><div class="speaker"><strong>You</strong><span>Task brief</span></div><p>Person 42 still has the name from an annulled document. Find the cause from the API response back to the data, and keep a reproducible check.</p></article><article class="message"><div class="speaker"><strong>Investigation</strong><span>Original illustrative retained evidence</span></div><h2>The request succeeds.<br>The chosen document breaks the name rule.</h2><p>The original response uses document <code>104</code>. Its state is <strong>annulled</strong>. Document <code>103</code> is the newest eligible candidate. HTTP status alone cannot verify the mapping.</p><p><button class="source-link" data-go="request">Response & raw rows</button> <button class="source-link" data-go="source">Selection policy at source</button></p><div class="evidence-list">'+[['GET /person/42 returned Sidorova','Original retained sample response · 200 OK','request','Inspect'],['Document 104 is annulled','3 complete sample rows · expected winner 103','request','Compare'],['Selection omits the annulment guard','Static source · does not prove runtime execution','source','Trace path']].map(([title,description,go,action],i)=>'<div class="evidence-row"><span class="number">'+(i+1)+'</span><div><strong>'+title+'</strong><small>'+description+'</small></div><button data-go="'+go+'">'+action+'</button></div>').join('')+'</div><p class="notice">Still unverified: whether production uses this exact query and whether hidden library code changes eligibility. A saved correction never edits this original source or proves runtime behavior.</p></article><div class="next-action"><h3>Next: reproduce the wrong selection</h3><p>Compare the local fixture response and raw candidates together. Carry the task, person ID and expected rule into the action.</p><button class="primary" data-go="request">Prepare comparison</button></div>'+instructions()+composer()+'</div>'+inspector()+'</div>';
}
function policyOptions(value) {
  return '<option value="original" '+(value==='original'?'selected':'')+'>Original illustrative selection</option><option value="proposal" '+(value==='proposal'?'selected':'')+' '+(!state.corrected?'disabled':'')+'>Saved guard · offline simulation only</option>';
}
function resultView(result,label) {
  if (!result) return '<p class="notice">Comparison prepared. Run it explicitly to obtain a new offline result.</p>';
  if (result.transport==='failed') return '<div class="notice error" role="alert"><strong>Simulated connection failure.</strong><br>No response or current assertion exists. Retained observations remain separate.<div class="wrap-row"><button id="refreshInstances">Review offline target</button><button id="retryRun" '+(state.readOnly?'disabled':'')+'>Retry comparison</button></div></div>';
  const verdict=result.verdict==='inconclusive'?'Inconclusive: candidate rows are truncated. They cannot establish the eligible winner.':result.verdict==='passed'?'Whole-name contract passes for this offline fixture. No source edit or runtime coverage is proven.':'HTTP succeeded. The offline whole-name assertion failed.';
  return '<div class="result-summary"><span class="state good">'+esc(result.transport)+'</span><span>'+esc(label)+' · '+(result.corrected?'saved guard simulation':'original selection')+'</span></div><pre class="code-block">'+esc(JSON.stringify({id:42,fio:result.actual},null,2))+'</pre><div class="compare-fields"><div><label>Actual name</label><strong>'+esc(result.actual)+'</strong></div><div><label>Expected name</label><strong>'+esc(result.expected)+'</strong></div></div><p class="notice '+(result.verdict==='passed'?'success':result.verdict==='failed'?'error':'')+'">'+verdict+'</p>';
}
function request() {
  const result=state.lastResult, docs=result?.documents || [], disabled=state.readOnly||state.running;
  return '<div class="subhead"><div><h2>One request. Its raw data. An explicit expected result.</h2><p>Person 42 at 2026-11-20. All responses are computed from the embedded fixture.</p></div></div><div class="two-pane"><section><div class="request-line"><span class="method">GET</span><code>/person/42</code><button id="replay" class="primary" '+(disabled?'disabled':'')+'>'+(state.running?'Running…':'Replay offline comparison')+'</button></div><label class="field">Target instance<select id="target" disabled><option>Embedded person-service fixture · no HTTP target</option></select></label><label class="field">Selection to simulate<select id="replayPolicy" '+(disabled?'disabled':'')+'>'+policyOptions(state.replayPolicy)+'</select></label><div class="scenario-control"><label for="scenario">Prepared demo outcome</label><select id="scenario" '+(disabled?'disabled':'')+'>'+[['ready','Complete data'],['error','Connection failure'],['partial','Truncated candidates'],['empty','No candidate documents']].map(([id,label])=>'<option value="'+id+'" '+(state.scenario===id?'selected':'')+'>'+label+'</option>').join('')+'</select></div><p class="note">Changing the prepared outcome clears its current verdict. Saving a correction does not apply it to source or automatically replay it.</p>'+(state.running?'<div class="progress-strip" role="status"><span>'+['Preparing task-scoped replay…','Computing fixture response…','Reading embedded candidates…'][Math.min(state.step,2)]+'</span><button id="cancelRun">Cancel local run</button></div>':state.requestState==='interrupted'?'<p class="notice">Local run interrupted by reload. No background work continues; replay explicitly.</p>':state.requestState==='cancelled'?'<p class="notice">Local run cancelled. Retained observations remain; no new result was produced.</p>':'')+resultView(result,state.requestState==='retained'?'Retained scenario sample':['cancelled','interrupted'].includes(state.requestState)?'Retained observation · no new result':'Latest offline run')+(state.previousResult?'<details><summary>Previous observation · not the current assertion</summary><pre class="code-block">'+esc(JSON.stringify(state.previousResult,null,2))+'</pre></details>':'')+'</section><section><div class="subhead"><div><h2>Raw candidates</h2><p>Embedded registry data · same person ID</p></div></div><details open><summary>Read-only query · fixture illustration</summary><pre class="code-block">select d.id, d.effective_date, s.active, s.annulled, d.family_name\nfrom registry.person_document d\njoin registry.document_state s on s.document_id = d.id\nwhere d.person_id = :personId;</pre></details><div class="data-table"><table><thead><tr><th>ID</th><th>Name</th><th>Effective</th><th>Eligibility / selection</th></tr></thead><tbody>'+(!result?'<tr><td colspan="4">No current read. Run the prepared comparison.</td></tr>':result.transport==='failed'?'<tr><td colspan="4">No current rows: simulated transport failed.</td></tr>':!docs.length?'<tr><td colspan="4">No documents. The response uses the complete registry name.</td></tr>':docs.map(d=>'<tr class="'+(result.chosenId===d.id?'chosen':'')+'"><td>'+d.id+'</td><td>'+esc(d.family)+'</td><td>'+d.effective+'</td><td>'+esc(d.annulled?'Excluded by contract · annulled':d.effective>IntentDemo.fixture.asOf?'Excluded · future':'Eligible')+(result.chosenId===d.id?' · selected by '+(result.corrected?'saved guard':'original policy'):'')+'</td></tr>').join(''))+'</tbody></table></div><p class="note">'+(result?.scenario==='partial'?'Only 1 of 3 fixture rows is visible. Candidate completeness is not established.':'Names are coherent per row. A missing patronymic is never borrowed from another document.')+'</p><details><summary>Exact arguments & provenance</summary><pre class="code-block">'+esc(JSON.stringify({fixture:'person-intent-v1',personId:42,asOf:IntentDemo.fixture.asOf,scenario:result?.scenario || 'not-run',readCompleteness:result?.transport==='failed'?'unavailable':result?.complete?'complete offline fixture':result?'truncated':'not-run',source:'illustrative-source-v1'},null,2))+'</pre></details><button data-go="source">Follow the mapping into source</button></section></div>';
}
function source() {
  const sample=IntentDemo.sourceSample(state.id,state.selected), checkout=state.id==='SHOP-142', draft=state.correctionDraft;
  const labels=checkout?[['entry','HTTP ENTRY','RefundController.refund'],['query','POSTGRES READ','OrderRepository.find'],['selection','POLICY','RefundPolicy.request'],['mapping','MAPPING','RefundMapper.response'],['exit','HTTP EXIT','RefundResponse']]:[['entry','HTTP ENTRY','PersonController.get'],['query','POSTGRES READ','person_document + document_state'],['selection','SELECTION','DocumentPolicy.choose'],['mapping','MAPPING','Whole document name'],['exit','HTTP EXIT','PersonResponse.fio']];
  return '<div class="subhead"><div><h2>Entry to exit, with evidence at every boundary</h2><p>Each selection opens its own illustrative source. Static reachability remains separate from runtime proof.</p></div></div><div class="flow" aria-label="Entry-to-exit path">'+labels.map(([id,type,label],i)=>(i?'<span class="connector" aria-hidden="true">→</span>':'')+'<button data-node="'+id+'" aria-pressed="'+(state.selected===id)+'"><span>'+type+'</span>'+label+'</button>').join('')+'</div><div class="two-pane"><section><h2>'+esc(sample.title)+'</h2><p class="note">'+esc(sample.file)+' · original illustrative revision</p><pre class="code-block">'+esc(sample.code)+'</pre><p class="note">'+esc(sample.basis)+'</p><details><summary>Assumptions and unresolved paths</summary><p>Static edges do not establish runtime execution. Exact source and library revisions must be pinned in the real workflow.</p><p>No JUnit, Joern, database or HTTP process is started here.</p></details><button data-go="'+(checkout?'overnight':'request')+'">'+(checkout?'Return to retained checkpoint':'Verify response & raw rows')+'</button></section>'+(checkout?'<aside><h2>Unresolved requirement</h2><p>'+esc(IntentDemo.checkoutFixture.missingSource)+' was unavailable in the retained checkpoint.</p><p>A local retry simulation is separate from collecting that real source.</p><button data-go="overnight">Review recovery</button></aside>':'<aside><h2>Correct a nearby finding</h2><p class="note">Original detection stays inspectable. Revision '+state.revision+'. No draft edits source or publishes knowledge.</p><label class="field">Eligibility guard<input id="guard" value="'+esc(draft.guard)+'" '+(state.readOnly?'disabled':'')+'></label><label class="field">Evidence / reason<textarea id="reason" rows="3" '+(state.readOnly?'disabled':'')+'>'+esc(draft.reason)+'</textarea></label><label class="field">Save scope<select id="correctionScope" '+(state.readOnly?'disabled':'')+'><option value="private" '+(draft.scope==='private'?'selected':'')+'>Private task correction</option><option value="review" '+(draft.scope==='review'?'selected':'')+'>Local proposal for admin review</option></select></label><div class="wrap-row"><button id="saveCorrection" class="primary" '+(state.readOnly?'disabled':'')+'>Save correction draft</button><button id="simulateConflict" '+(state.readOnly?'disabled':'')+'>Simulate concurrent edit</button></div>'+(state.readOnly?'<p class="read-only">Read-only review snapshot. No task fields can be edited here.</p>':'')+(state.correctionConflict?'<p class="notice error" role="alert">Expected revision '+state.draftRevision+' differs from current '+state.revision+'. Your guard, reason and scope remain unchanged.</p><details open><summary>Latest evidence to review</summary><p>Simulated concurrent revision '+state.revision+' adds an expiry-review note. The original rule remains active & valid. No new runtime evidence exists.</p><p>Your draft: <code>'+esc(draft.guard)+'</code></p></details><button id="rebaseDraft" '+(state.readOnly?'disabled':'')+'>Retain my draft against revision '+state.revision+'</button>':state.corrected?'<p class="notice success">Saved '+(state.correctionSaved.scope==='review'?'local review proposal':'private task correction')+'. To evaluate it, explicitly choose the saved guard in an offline replay or check. No source patch or runtime proof exists.</p>':'')+'<details><summary>Original detected rule</summary><pre class="code-block">active & valid\nMissing annulment predicate\nSource: illustrative-source-v1</pre></details></aside>')+'</div>';
}
function changes() {
  return '<div class="subhead"><div><h2>Review a proposed change against the required path</h2><p>Illustrative patch only. The source shown in Source & paths remains original.</p></div></div><div class="two-pane"><section><h2>DocumentPolicy.java · proposed edit</h2><pre class="code-block">  .filter(Document::active)\n+ .filter(d -> !d.annulled())\n  .filter(d -> !d.effectiveDate().isAfter(asOf))</pre><p class="notice">'+(state.corrected?'A correction draft is saved. This patch has not been applied.':'No correction is saved yet. This is a suggested patch, not an applied change.')+'</p><button data-go="source">Inspect original path & correction draft</button></section><section><h2>What the change should prove</h2><ul><li>An annulled recent document loses to a valid older one.</li><li>A future name change cannot win.</li><li>Every name part comes from one selected row.</li><li>Registry fallback is used only when no eligible row exists.</li></ul><div class="next-action"><h3>Test from the public entry point</h3><p>A real integration check needs a workspace and isolated dependencies. Offline fixture checks are a separate demonstration.</p><button class="primary" data-go="checks">Review proposed checks</button></div></section></div>';
}
function checks() {
  const result=state.checkResults, cases=result?.cases || IntentDemo.verify(false);
  return '<div class="subhead"><div><h2>Behavior checks before publication</h2><p>Offline fixture assertions do not run the HTTP entry point or measure changed-line coverage.</p></div><button id="runChecks" class="primary" '+(state.running||state.readOnly?'disabled':'')+'>Run offline fixture checks</button></div><label class="field">Policy to verify<select id="checkPolicy" '+(state.running||state.readOnly?'disabled':'')+'>'+policyOptions(state.checkPolicy)+'</select></label>'+(result?'<p class="note">Last verification: '+(result.corrected?'saved guard simulation':'original selection')+'. Results remain attached to that exact policy.</p>':'<p class="note">Prepared only. No verification has run for this selection.</p>')+(state.running?'<div class="progress-strip" role="status"><span>Computing offline contract cases…</span><button id="cancelRun">Cancel local run</button></div>':'')+cases.map(c=>'<div class="check-row"><span class="'+(result?(c.passed?'pass':'fail'):'')+'">'+(result?(c.passed?'Passed':'Failed'):'Not run')+'</span><div>'+esc(c.title)+'<small>'+(result?'Actual: '+esc(c.actual)+' · Expected: '+esc(c.expected):'Finite embedded fixture · not an integration test')+'</small></div><button '+(c.id==='fallback'?'id="inspectFallback"':'data-go="'+(c.id==='annulled'?'request':'source')+'"')+'>Inspect '+(c.id==='annulled'?'expected / actual':c.id==='fallback'?'empty fixture':'source guard')+'</button></div>').join('')+'<div class="check-row"><span>Not run</span><div>Real integration & changed-line coverage<small>Requires a pinned workspace, runner and isolated database lease</small></div><button id="prepareTests">Prepare test plan</button></div><div id="testPlan" '+(state.testPlanOpen?'':'hidden')+'><pre class="code-block">GET /person/42 → isolated database fixture → complete-name assertion → changed-path coverage\nRequires: pinned workspace + runner + database lease\nNo tests or tools started.</pre></div><p class="notice">No publication, branch push or PR is implemented. Required real checks remain unrun regardless of the offline verdict.</p>';
}
function handoff() {
  const checkout=state.id==='SHOP-142';
  return '<div class="two-pane"><section><h2>Give the next person evidence and a way to reproduce it.</h2><p>Review links contain a read-only browser snapshot. Opening a link executes nothing.</p><label class="field">Named investigation<input id="shareName" value="'+esc(state.shareName)+'" '+(state.readOnly?'disabled':'')+'></label><label class="field">Handoff note<textarea id="handoffNote" rows="4" '+(state.readOnly?'disabled':'')+' placeholder="What changed and what remains uncertain">'+esc(state.note)+'</textarea></label>'+(!checkout?'<label class="field">Offline recipe policy<select id="recipePolicy" '+(state.readOnly?'disabled':'')+'>'+policyOptions(state.recipePolicy)+'</select></label>':'')+'<ul class="plan-list">'+(checkout?'<li><span>Task</span><strong>SHOP-142 · DEMO/checkout · retained refund requirements</strong></li><li><span>Included</span><strong>3 completed source references, notes, failed-source gap and local checkpoint state</strong></li><li><span>Replay</span><strong>Inspect checkpoint integrity; no source is collected and no worker resumes</strong></li>':'<li><span>Task</span><strong>PERS-218 · DEMO/person-service · person 42 at 2026-11-20</strong></li><li><span>Included</span><strong>Complete fixture, original finding and saved correction metadata</strong></li><li><span>Replay</span><strong>Explicitly selected original or saved-guard offline assertion</strong></li>')+'<li><span>Excluded</span><strong>Credentials, applied source patches and production runtime coverage</strong></li></ul><div class="wrap-row"><button id="shareLink" class="primary">Prepare read-only review link</button><button id="exportRecipe">Download offline recipe</button></div><div id="shareOutput" class="saved-bundle" hidden></div></section><aside class="inspector"><h2>Replay outside this browser</h2><p>Download these files alongside the recipe into one folder.</p><p><a href="engine.js" download>engine.js</a> · <a href="replay.js" download>replay.js</a></p><pre>node replay.js recipe.json</pre><p class="note">'+(checkout?'This recipe checks retained checkout checkpoint integrity. It does not contain the person-name request or assertion.':'The original policy fails the complete fixture; the saved supported guard passes only when explicitly selected. Partial reads are inconclusive.')+'</p><h3>Retention limits</h3><p>This browser tab uses sessionStorage. Closing its session or resetting the demo clears local edits. A review link carries a snapshot; it is not account-level or server persistence.</p></aside></div>';
}
function overnight() {
  const busy=state.workerStatus==='running', recovered=state.docsState==='recovered';
  return '<div class="investigation"><section class="conversation"><article class="message"><div class="speaker"><strong>Task checkpoint</strong><span>Illustrative retained evidence · no actual worker</span></div><h2>Sources were collected.<br>'+(recovered?'A local recovery was simulated.':'One source needs attention.')+'</h2><p>Checkout code and two pages are retained. The final Confluence request failed in the original checkpoint. Earlier findings remain; an offline retry never collects the real missing source.</p></article><div class="check-row"><span class="pass">Saved</span><div>Checkout source & API routes<small>Illustrative source pin and discovery arguments retained</small></div><button data-go="source">Inspect checkout source</button></div><div class="check-row"><span class="pass">Saved</span><div>Refund behavior notes<small>Private local task memory; no shared publication</small></div><button id="showNotes">'+(state.notesOpen?'Hide notes':'Read notes')+'</button></div><div class="check-row"><span class="'+(recovered?'pass':'fail')+'">'+(recovered?'Simulated':'Failed')+'</span><div>Confluence collection<small>'+(recovered?'Offline recovery example complete · real source remains uncollected':'Original error: service unavailable · no response body')+'</small></div><button id="retryDocs" '+(state.readOnly||busy?'disabled':'')+'>Prepare failed-step retry</button></div><div class="next-action"><h3>Resume from the checkpoint</h3><p>Local controls demonstrate pause, recovery and retention. Successful source reads are not replayed.</p><div class="wrap-row"><button id="resumeOvernight" class="primary" '+(state.readOnly||busy?'disabled':'')+'>Prepare local resume</button><button id="pauseTask" '+(state.readOnly||!['running','paused'].includes(state.workerStatus)?'disabled':'')+'>'+(state.workerStatus==='paused'?'Resume local simulation':'Pause local simulation')+'</button></div></div>'+(state.retryPrepared?'<div class="notice"><strong>Retry prepared: final Confluence read only.</strong><p>Target: embedded recovery scenario. Retained checkout sources remain untouched. No HTTP or model call will be made.</p><button id="confirmDocsRetry" '+(state.readOnly?'disabled':'')+'>Simulate failed-step recovery</button></div>':'')+(busy?'<div class="progress-strip" role="status"><span>Local documentation-recovery simulation running…</span><button id="cancelRun">Cancel local simulation</button></div>':'')+'<div id="overnightOutput" role="status">'+(state.overnightOutput?'<p class="notice">'+esc(state.overnightOutput)+'</p>':'')+'</div>'+(state.notesOpen?'<pre class="code-block">'+esc(IntentDemo.checkoutFixture.notes.map(n=>'- '+n).join('\n')+'\nGap: real unavailable source has not been collected.')+'</pre>':'')+instructions()+composer()+'</section><aside class="inspector"><h2>Checkpoint</h2><dl><dt>Task identity</dt><dd>SHOP-142 · this browser session</dd><dt>Local state</dt><dd>'+esc(statusFor(state))+'</dd><dt>Source status</dt><dd>3 retained references; real missing source remains unresolved</dd><dt>Model usage</dt><dd>No model requests in this proposal</dd><dt>Resources</dt><dd>No processes, leases or remote workers allocated</dd></dl><button data-go="handoff">Prepare checkout handoff</button><button id="stopWorker" '+(state.readOnly||state.workerStatus==='cancelled'?'disabled':'')+'>Stop local simulation</button></aside></div>';
}
function start() {
  return '<section class="empty-work"><p class="breadcrumbs">Tasks / Demo starting points</p><h1>What do you need to understand or change?</h1><p class="note">Choose one of two fixed tasks. This prototype does not create arbitrary tasks.</p><ul class="intent-list"><li><button data-go="request" data-go-task="PERS-218"><strong>Investigate a wrong API response</strong><small>Compare its data, then follow the mapping into source.</small></button></li><li><button data-go="source" data-go-task="PERS-218"><strong>Understand the impact of a change</strong><small>Inspect the original path, then save a separate correction draft.</small></button></li><li><button data-go="overnight" data-go-task="SHOP-142"><strong>Resume retained overnight work</strong><small>Inspect its checkpoint and prepare a local recovery simulation.</small></button></li><li><button data-go="handoff" data-go-task="PERS-218"><strong>Make an investigation reproducible</strong><small>Export the explicitly selected offline assertion.</small></button></li></ul></section>';
}
function destination() {
  const d=session.destination, title={services:'Find the service. Keep the task.',library:'Reuse what you already learned.',operations:'Operate the harness with the task attached.'}[d];
  const rows=d==='services'?[['person-service','GET /person/{id} · registry tables · selection path','source','PERS-218'],['checkout','Refund routes · retained requirements · failed source read','source','SHOP-142']]:d==='library'?[['PERS-218/person-name-check','Named recipe · response/database contract · explicit replay','handoff','PERS-218'],['Person selection rule','Original evidence · row eligibility · assumptions','findings','PERS-218'],['Checkout requirements','Partial source collection · private task notes','overnight','SHOP-142']]:[['Needs attention: SHOP-142','Failed source read · previous evidence retained · explicit retry','overnight','SHOP-142'],['Runs, tests and coverage','Offline result and real coverage gap','checks','PERS-218'],['Configuration and indices','Local JSON draft only · no activation or refresh','operations-details',state.id]];
  return '<section class="empty-work"><h1>'+title+'</h1><ul class="intent-list">'+rows.map(([name,description,scene,task])=>'<li><button data-go="'+scene+'" data-go-task="'+task+'"><strong>'+name+'</strong><small>'+description+'</small></button></li>').join('')+'</ul><p class="note">These are local examples. Production specialist tools, configuration activation and legacy routing are not connected in this demo.</p></section>';
}
function operationsDetails() {
  return '<section class="empty-work"><h2>Connection and index health · local draft</h2><p>Interaction example only. No connection validation, configuration activation or index refresh is implemented.</p><label class="field">Local JSON draft<textarea id="configDraft" rows="8">'+esc(session.configDraft)+'</textarea></label><button id="sameSection">Reopen selected configuration</button><p class="note">This action re-renders the selected section and preserves its draft in this browser session.</p></section>';
}
function render() {
  rail();
  for(const b of document.querySelectorAll('[data-destination]')) { if(b.dataset.destination===session.destination)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current'); }
  const fn={findings,request,source,changes,checks,handoff,overnight,'operations-details':operationsDetails}[state.scene] || findings;
  const panelLabel=scenes().some(s=>s[0]===state.scene)?'aria-labelledby="task-tab-'+state.scene+'"':'aria-label="Configuration draft"';
  $('content').innerHTML=session.destination!=='tasks'?destination():state.scene==='start'?start():header()+tabs()+'<section id="taskPanel" role="tabpanel" '+panelLabel+'>'+fn()+'</section>';
  bind();
}
function input(id,key,nested) {
  if(!$(id))return;
  $(id).oninput=e=>{if(state.readOnly)return;if(nested)state[nested][key]=e.target.value;else state[key]=e.target.value;save();};
}
function prepareComparison() {
  if(state.lastResult?.transport==='200 OK')state.previousResult=IntentDemo.clone(state.lastResult);
  state.lastResult=null;state.requestState='prepared';save();render();
}
function stop(task,message) {
  clearTimeout(timers.get(task.id));timers.delete(task.id);task.running=false;
  if(task.operation==='docs')task.workerStatus='paused';
  if(task.operation==='comparison')task.requestState='cancelled';
  task.operation='';saveTask(task);
  if(state===task){render();announce(message);}
}
function runComparison() {
  if(state.running||state.readOnly)return;
  const task=state,scenario=task.scenario,corrected=task.replayPolicy==='proposal'&&!!task.correctionSaved;
  task.running=true;task.operation='comparison';task.step=0;save();render();
  const next=()=>{task.step++;if(task.step<3){saveTask(task);if(state===task)render();timers.set(task.id,setTimeout(next,450));}else{
    task.running=false;task.operation='';
    if(task.lastResult?.transport==='200 OK')task.previousResult=IntentDemo.clone(task.lastResult);
    task.lastResult=IntentDemo.comparison(scenario,corrected);task.requestState='complete';saveTask(task);timers.delete(task.id);
    if(state===task){render();announce(task.lastResult.verdict==='not-run'?'Simulated transport failed. No current assertion.':task.lastResult.verdict==='inconclusive'?'Candidate read incomplete. Verdict inconclusive.':'Offline comparison complete. Inspect the contract verdict.');}
  }};timers.set(task.id,setTimeout(next,450));
}
function runChecks() {
  if(state.running||state.readOnly)return;
  const task=state,corrected=task.checkPolicy==='proposal'&&!!task.correctionSaved;
  task.running=true;task.operation='checks';save();render();
  timers.set(task.id,setTimeout(()=>{task.running=false;task.operation='';task.checkResults={corrected,cases:IntentDemo.verify(corrected)};saveTask(task);timers.delete(task.id);if(state===task){render();announce('Offline assertions computed. No integration, code patch or runtime coverage was produced.');}},700));
}
function runDocs() {
  if(state.running||state.readOnly)return;
  const task=state;task.running=true;task.operation='docs';task.workerStatus='running';task.retryPrepared=false;task.overnightOutput='Local recovery simulation started; no real source contacted.';save();render();
  timers.set(task.id,setTimeout(()=>{task.running=false;task.operation='';task.workerStatus='completed';task.docsState='recovered';task.overnightOutput='Offline recovery example completed. The original three sources remain retained. The real missing documentation source remains uncollected.';saveTask(task);timers.delete(task.id);if(state===task){render();announce('Local simulation complete. No worker or remote source was contacted.');}},1000));
}
function exportRecipe() {
  const corrected=state.id==='PERS-218'&&state.recipePolicy==='proposal'&&!!state.correctionSaved;
  const recipe=IntentDemo.recipe({taskId:state.id,name:state.shareName,note:state.note,corrected,correction:state.correctionSaved,scenario:state.scenario,workerStatus:state.workerStatus,docsState:state.docsState,steering:state.steering});
  const url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='recipe.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  announce('Exported '+state.id+' offline recipe. Keep engine.js and replay.js beside it.');
}
function bind() {
  for(const b of document.querySelectorAll('[data-go]'))b.onclick=()=>navigate(b.dataset.go,b.dataset.goTask||state.id);
  for(const b of document.querySelectorAll('[data-node]'))b.onclick=()=>{state.selected=b.dataset.node;save();render();document.querySelector('[data-node="'+state.selected+'"]')?.focus();};
  for(const tab of document.querySelectorAll('[role=tab]'))tab.onkeydown=e=>{const list=scenes(),i=list.findIndex(([id])=>id===state.scene),next=e.key==='ArrowRight'?(i+1)%list.length:e.key==='ArrowLeft'?(i+list.length-1)%list.length:e.key==='Home'?0:e.key==='End'?list.length-1:null;if(next!==null){e.preventDefault();navigate(list[next][0]);document.querySelector('[role=tab][aria-selected=true]')?.focus();}};
  input('guard','guard','correctionDraft');input('reason','reason','correctionDraft');input('correctionScope','scope','correctionDraft');input('handoffNote','note');input('shareName','shareName');input('steer','steeringDraft');
  if($('steering'))$('steering').onsubmit=e=>{e.preventDefault();if(state.readOnly)return;const note=state.steeringDraft.trim();if(!note)return announce('Write an instruction first.');state.steering.push(note);state.steeringDraft='';save();render();announce('Instruction saved to '+state.id+' in this browser session. No worker contacted.');};
  if($('scenario'))$('scenario').onchange=e=>{state.scenario=e.target.value;prepareComparison();};
  if($('replayPolicy'))$('replayPolicy').onchange=e=>{state.replayPolicy=e.target.value;prepareComparison();};
  if($('replay'))$('replay').onclick=runComparison;
  if($('retryRun'))$('retryRun').onclick=runComparison;
  if($('refreshInstances'))$('refreshInstances').onclick=()=>announce('Only the embedded fixture is available. There is no network discovery in this prototype.');
  if($('cancelRun'))$('cancelRun').onclick=()=>stop(state,'Local run cancelled. Retained observations and drafts remain.');
  if($('saveCorrection'))$('saveCorrection').onclick=()=>{if(state.readOnly)return;const result=IntentDemo.saveCorrection(state);save();render();announce(result.ok?'Correction draft saved; original source unchanged. Select it explicitly for offline verification.':result.error);};
  if($('simulateConflict'))$('simulateConflict').onclick=()=>{if(state.readOnly)return;state.revision++;state.correctionConflict=true;save();render();};
  if($('rebaseDraft'))$('rebaseDraft').onclick=()=>{if(state.readOnly)return;state.draftRevision=state.revision;state.correctionConflict=false;save();render();announce('Draft retained against the reviewed revision. Save remains explicit.');};
  if($('checkPolicy'))$('checkPolicy').onchange=e=>{state.checkPolicy=e.target.value;state.checkResults=null;save();render();};
  if($('runChecks'))$('runChecks').onclick=runChecks;
  if($('inspectFallback'))$('inspectFallback').onclick=()=>{state.scenario='empty';prepareComparison();navigate('request');};
  if($('prepareTests'))$('prepareTests').onclick=()=>{state.testPlanOpen=true;save();render();};
  if($('recipePolicy'))$('recipePolicy').onchange=e=>{state.recipePolicy=e.target.value;save();};
  if($('shareLink'))$('shareLink').onclick=()=>{const url=new URL('demo.html',location.href),snapshot=IntentDemo.clone(state);snapshot.running=false;snapshot.operation='';snapshot.scene='handoff';snapshot.readOnly=true;url.search=new URLSearchParams({scene:'handoff',task:state.id,state:'readonly',snapshot:JSON.stringify(snapshot)});$('shareOutput').hidden=false;$('shareOutput').innerHTML='<label class="field">Read-only review URL<input id="reviewUrl" readonly></label><button id="copyReview">Copy review link</button><p class="note">Includes this task’s local notes and snapshot. No credentials. Opening runs nothing; no editable local task is overwritten.</p>';$('reviewUrl').value=url.href;$('copyReview').onclick=async()=>{try{await navigator.clipboard.writeText(url.href);announce('Read-only review link copied.');}catch{$('reviewUrl').select();announce('Clipboard unavailable. Copy the selected review URL.');}};announce('Read-only '+state.id+' snapshot prepared.');};
  if($('exportRecipe'))$('exportRecipe').onclick=exportRecipe;
  for(const id of ['resumeOvernight','retryDocs'])if($(id))$(id).onclick=()=>{if(state.readOnly)return;state.retryPrepared=true;state.overnightOutput='Review the failed step and confirm the local simulation below.';save();render();};
  if($('confirmDocsRetry'))$('confirmDocsRetry').onclick=runDocs;
  if($('pauseTask'))$('pauseTask').onclick=()=>{if(state.readOnly)return;if(state.workerStatus==='running')stop(state,'Local simulation paused. No external operation exists.');else if(state.workerStatus==='paused')runDocs();};
  if($('stopWorker'))$('stopWorker').onclick=()=>{if(state.readOnly)return;clearTimeout(timers.get(state.id));timers.delete(state.id);state.running=false;state.operation='';state.workerStatus='cancelled';state.retryPrepared=false;state.overnightOutput='Local simulation stopped. No worker, process or lease was allocated; retained sources remain.';save();render();};
  if($('showNotes'))$('showNotes').onclick=()=>{state.notesOpen=!state.notesOpen;save();render();};
  if($('configDraft'))$('configDraft').oninput=e=>{session.configDraft=e.target.value;save();};
  if($('sameSection'))$('sameSection').onclick=()=>{render();announce('Configuration section reopened from the browser-session draft. Nothing fetched or activated.');};
}
for(const b of document.querySelectorAll('[data-destination]'))b.onclick=()=>{session.destination=b.dataset.destination;save();render();};
$('taskSearch').oninput=rail;
$('taskPicker').onclick=()=>{const open=document.querySelector('.task-rail').classList.toggle('open');$('taskPicker').setAttribute('aria-expanded',String(open));if(open)$('taskSearch').focus();};
$('newTask').textContent='New demo task';
$('newTask').onclick=()=>navigate('start');
$('resume').onclick=()=>navigate('overnight','SHOP-142');
$('reset').onclick=()=>{for(const timer of timers.values())clearTimeout(timer);try{storage.removeItem('dt-admin-intent-demo-v2');}catch{}location.href='demo.html';};
$('help').onclick=()=>announce('Two fixed offline tasks. Drafts and results persist in this browser session only. Saving a correction never edits source; choose a policy and run an offline check explicitly.');
document.querySelector('.rail-bottom p').innerHTML='<strong>Browser-session memory.</strong><br>Navigation and reload preserve each task. No server or account persistence.';
save();render();
