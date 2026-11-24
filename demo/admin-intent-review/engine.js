(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const guard = 'active & valid & !annulled';
  const effects = 'Offline fixture only. No HTTP, database, model, workspace or worker operations.';
  const fixture = {
    id: 'person-intent-v1', asOf: '2026-11-20', personId: 42,
    registry: { family: 'Petrova', given: 'Anna', middle: 'Ivanovna' },
    documents: [
      { id: 104, effective: '2026-11-18', active: true, annulled: true, expires: null, family: 'Sidorova', given: 'Anna', middle: 'Ivanovna' },
      { id: 103, effective: '2026-10-02', active: true, annulled: false, expires: null, family: 'Petrova', given: 'Anna', middle: 'Ivanovna' },
      { id: 105, effective: '2026-12-01', active: true, annulled: false, expires: null, family: 'Ivanova', given: 'Anna', middle: 'Ivanovna' }
    ]
  };
  const checkoutFixture = {
    id: 'checkout-checkpoint-v1', completedSources: ['DEMO/checkout source', 'Refund behavior page', 'Refund authorization page'],
    notes: ['Authorization is required.', 'Repeated requests must be idempotent.', 'Rejected requests need observable evidence.'],
    missingSource: 'Final Confluence refund requirements page'
  };
  const tasks = [
    { id: 'PERS-218', title: 'Wrong name in person response', service: 'person-service', repository: 'DEMO/person-service' },
    { id: 'SHOP-142', title: 'Gather refund requirements overnight', service: 'checkout', repository: 'DEMO/checkout' }
  ];
  function freeze(value) {
    Object.freeze(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child);
    return value;
  }
  freeze(fixture); freeze(checkoutFixture); freeze(tasks);
  function select(data, corrected) {
    const rows = data.documents.filter(d => d.active && d.effective <= data.asOf &&
      (!d.expires || d.expires >= data.asOf) && String(d.family || '').trim() &&
      String(d.given || '').trim() && (!corrected || !d.annulled));
    rows.sort((a, b) => b.effective.localeCompare(a.effective) || b.id - a.id);
    return { ...(rows[0] || data.registry) };
  }
  function name(row) { return [row.family, row.given, row.middle].filter(Boolean).join(' '); }
  function comparison(scenario = 'ready', corrected = false) {
    if (!['ready', 'empty', 'partial', 'error'].includes(scenario)) throw Error('Unknown offline scenario.');
    if (scenario === 'error') return { scenario, transport: 'failed', verdict: 'not-run', corrected, complete: false, documents: [], actual: null, expected: null };
    const data = clone(fixture);
    if (scenario === 'empty') data.documents = [];
    const selected = select(data, corrected);
    return {
      fixtureId: fixture.id, scenario, transport: '200 OK', corrected,
      complete: scenario !== 'partial', documents: clone(scenario === 'partial' ? data.documents.slice(0, 1) : data.documents),
      chosenId: selected.id || null, actual: name(selected), expected: name(select(data, true)),
      verdict: scenario === 'partial' ? 'inconclusive' : name(selected) === name(select(data, true)) ? 'passed' : 'failed'
    };
  }
  function verify(corrected) {
    const future = clone(fixture); future.documents = [future.documents[2]];
    const empty = clone(fixture); empty.documents = [];
    const coherent = clone(fixture); coherent.documents = [{ ...coherent.documents[1], middle: '' }];
    return [
      { id: 'annulled', title: 'Exclude annulled name change', actual: name(select(fixture, corrected)), expected: name(fixture.documents[1]) },
      { id: 'future', title: 'Future document cannot win', actual: name(select(future, corrected)), expected: name(future.registry) },
      { id: 'fallback', title: 'Fallback uses one complete registry name', actual: name(select(empty, corrected)), expected: name(empty.registry) },
      { id: 'coherent', title: 'Missing name parts are not borrowed from another row', actual: name(select(coherent, corrected)), expected: 'Petrova Anna' }
    ].map(row => ({ ...row, passed: row.actual === row.expected }));
  }
  function taskState(id) {
    if (!tasks.some(task => task.id === id)) throw Error('Unknown demo task.');
    return {
      id, scene: id === 'SHOP-142' ? 'overnight' : 'findings', selected: id === 'SHOP-142' ? 'entry' : 'selection',
      corrected: false, note: '', shareName: id === 'SHOP-142' ? 'SHOP-142/refund-requirements-handoff' : 'PERS-218/person-name-check',
      steering: [], steeringDraft: '', running: false, operation: '', step: 0, readOnly: false,
      scenario: 'ready', requestState: 'retained', lastResult: id === 'PERS-218' ? comparison() : null, previousResult: null,
      replayPolicy: 'original', checkPolicy: 'original', recipePolicy: 'original', checkResults: null,
      revision: 1, draftRevision: 1, correctionConflict: false,
      correctionDraft: { guard, reason: 'Document 104 is annulled; expected winner is 103. Confirmed by the sample rows.', scope: 'private' },
      correctionSaved: null, testPlanOpen: false,
      workerStatus: 'needs_attention', docsState: 'failed', retryPrepared: false, overnightOutput: '', notesOpen: false
    };
  }
  function normalizeTask(id, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    const out = taskState(id);
    const strings = ['scene','selected','note','shareName','steeringDraft','scenario','requestState','replayPolicy','checkPolicy','recipePolicy','workerStatus','docsState','overnightOutput'];
    for (const key of strings) if (typeof input[key] === 'string') out[key] = input[key].slice(0, key === 'note' || key === 'steeringDraft' ? 4000 : 1000);
    for (const key of ['corrected','correctionConflict','testPlanOpen','retryPrepared','notesOpen']) if (typeof input[key] === 'boolean') out[key] = input[key];
    for (const key of ['revision','draftRevision']) if (Number.isSafeInteger(input[key]) && input[key] > 0) out[key] = input[key];
    out.steering = Array.isArray(input.steering) ? input.steering.filter(v => typeof v === 'string').slice(-30).map(v => v.slice(0,4000)) : [];
    if (input.correctionDraft && typeof input.correctionDraft === 'object') {
      for (const key of ['guard','reason','scope']) if (typeof input.correctionDraft[key] === 'string') out.correctionDraft[key] = input.correctionDraft[key].slice(0,4000);
    }
    if (input.correctionSaved && input.correctionSaved.guard === guard && ['private','review'].includes(input.correctionSaved.scope) && typeof input.correctionSaved.reason === 'string') out.correctionSaved = clone(input.correctionSaved);
    out.corrected = !!out.correctionSaved;
    if (input.lastResult && ['ready','partial','empty','error'].includes(input.lastResult.scenario) && typeof input.lastResult.corrected === 'boolean') out.lastResult = comparison(input.lastResult.scenario,input.lastResult.corrected);
    if (input.lastResult === null) out.lastResult = null;
    if (input.previousResult && ['ready','partial','empty'].includes(input.previousResult.scenario) && typeof input.previousResult.corrected === 'boolean') out.previousResult = comparison(input.previousResult.scenario,input.previousResult.corrected);
    if (input.checkResults && typeof input.checkResults.corrected === 'boolean') out.checkResults = { corrected: input.checkResults.corrected, cases: verify(input.checkResults.corrected) };
    for (const key of ['replayPolicy','checkPolicy','recipePolicy']) if (!['original','proposal'].includes(out[key]) || out[key] === 'proposal' && !out.corrected) out[key] = 'original';
    if (!['ready','partial','empty','error'].includes(out.scenario)) out.scenario = 'ready';
    if (!['entry','query','selection','mapping','exit'].includes(out.selected)) out.selected = 'selection';
    if (input.running) {
      out.requestState = input.operation === 'comparison' ? 'interrupted' : out.requestState;
      out.workerStatus = input.operation === 'docs' ? 'paused' : out.workerStatus;
      out.overnightOutput = input.operation === 'docs' ? 'Local simulation paused by reload. No background worker continues.' : out.overnightOutput;
    }
    return out;
  }
  function session(storage) {
    let saved = {};
    try { saved = JSON.parse(storage.getItem('dt-admin-intent-demo-v2') || '{}'); } catch {}
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    const activeTask = tasks.some(t => t.id === saved.activeTask) ? saved.activeTask : 'PERS-218';
    return {
      version: 2, activeTask, destination: ['tasks','services','library','operations'].includes(saved.destination) ? saved.destination : 'tasks',
      configDraft: typeof saved.configDraft === 'string' ? saved.configDraft.slice(0,10000) : '{ "environment": "demo-dev" }',
      tasks: Object.fromEntries(tasks.map(t => [t.id,normalizeTask(t.id,saved.tasks && saved.tasks[t.id])]))
    };
  }
  function persist(storage, value) { try { storage.setItem('dt-admin-intent-demo-v2',JSON.stringify(value)); return true; } catch { return false; } }
  function saveCorrection(task) {
    if (!task.correctionDraft.reason.trim()) return { ok: false, error: 'Add an evidence reason before saving.' };
    if (task.draftRevision !== task.revision) { task.correctionConflict = true; return { ok: false, error: 'Revision changed. Review the latest evidence before retaining this draft.' }; }
    if (task.correctionDraft.guard !== guard) return { ok: false, error: 'This finite fixture supports only the displayed guard. Arbitrary guards are retained as text and never executed.' };
    if (!['private','review'].includes(task.correctionDraft.scope)) return { ok: false, error: 'Choose a supported save scope.' };
    task.correctionSaved = { ...clone(task.correctionDraft), revision: task.revision };
    task.corrected = true; task.correctionConflict = false;
    return { ok: true };
  }
  const personSamples = {
    entry: { title:'Entry point', file:'PersonController.java:18', code:'@GetMapping("/person/{id}")\nPersonResponse get(@PathVariable long id) {\n  return service.person(id, clock.today());\n}', basis:'Illustrative HTTP entry. Request parameters reach the service; this is not a measured runtime trace.' },
    query: { title:'Rows read', file:'PersonDocumentRepository.java:31', code:'select d.*, s.active, s.annulled\nfrom registry.person_document d\njoin registry.document_state s on s.document_id = d.id\nwhere d.person_id = :personId;', basis:'Illustrative read boundary. The join binds each state to the same document. Query completeness must be verified separately.' },
    selection: { title:'Selection policy', file:'DocumentPolicy.java:42', code:'documents.stream()\n  .filter(Document::active)\n  // Missing: exclude annulled documents\n  .filter(d -> !d.effectiveDate().isAfter(asOf))\n  .filter(d -> d.expires() == null\n      || !d.expires().isBefore(asOf))\n  .max(byEffectiveDate.thenComparing(Document::id));', basis:'Original illustrative source remains unchanged when a correction draft is saved.' },
    mapping: { title:'Whole-name mapping', file:'PersonMapper.java:25', code:'Name name = selectedDocument\n  .map(d -> new Name(d.family(), d.given(), d.middle()))\n  .orElseGet(() -> registry.name());\nreturn new PersonResponse(person.id(), name.join());', basis:'All name parts come from the same selected row. Fallback uses a complete registry object.' },
    exit: { title:'Response field', file:'PersonResponse.java:6', code:'record PersonResponse(long id, String fio) {}\n\n// Original retained response\n{ "id": 42, "fio": "Sidorova Anna Ivanovna" }', basis:'A retained response is an observation, not proof that this candidate static path executed.' }
  };
  const checkoutSamples = {
    entry: { title:'Refund entry point', file:'RefundController.java:19', code:'@PostMapping("/orders/{id}/refund")\nRefundResponse refund(long id, RefundRequest request) {\n  return refunds.request(id, request);\n}', basis:'Illustrative retained checkout entry. No person-service source belongs to this task.' },
    query: { title:'Order read', file:'OrderRepository.java:12', code:'select id, payment_state, refund_state\nfrom sales.orders\nwhere id = :orderId;', basis:'Static read boundary. No database was contacted in this prototype.' },
    selection: { title:'Refund eligibility', file:'RefundPolicy.java:28', code:'if (!authorization.allowed()) return rejected("unauthorized");\nif (request.previouslyHandled()) return previousResult();\nreturn prepareRefund(order);', basis:'Retained sample requirements cover authorization and idempotency. The unavailable documentation source remains a gap.' },
    mapping: { title:'Refund response mapping', file:'RefundMapper.java:14', code:'return new RefundResponse(\n  order.id(), result.state(), result.receiptId());', basis:'Illustrative mapping only. Requirements collection is not an executable service test.' },
    exit: { title:'Refund exit evidence', file:'RefundResponse.java:5', code:'record RefundResponse(long orderId, String state, String receiptId) {}', basis:'Static response contract; no runtime receipt has been produced.' }
  };
  function sourceSample(taskId, node) { return clone((taskId === 'SHOP-142' ? checkoutSamples : personSamples)[node] || personSamples.selection); }
  function recipe(options, corrected) {
    if (typeof options !== 'object' || options === null) options = { note: options || '', corrected: !!corrected };
    const id = options.taskId || 'PERS-218';
    if (!tasks.some(t => t.id === id)) throw Error('Unknown recipe task.');
    const base = { format:'dt.admin-intent-proposal/v1', taskId:id, name:options.name || (id === 'SHOP-142' ? 'SHOP-142/refund-requirements-handoff' : 'PERS-218/person-name-check'), environment:'demo-dev', source:{ repository:tasks.find(t => t.id === id).repository, revision:'illustrative-source-v1' }, note:options.note || '', effects };
    if (id === 'SHOP-142') return {
      ...base, kind:'checkout-checkpoint', fixture:clone(checkoutFixture),
      checkpoint:{ workerStatus:options.workerStatus || 'needs_attention', docsState:options.docsState || 'failed', completedSources:clone(checkoutFixture.completedSources), missingSource:checkoutFixture.missingSource, steering:clone(options.steering || []) },
      steps:[{operation:'inspect-retained-checkpoint'},{operation:'assert-completed-sources-retained'}],
      expected:{ completedSources:3, externalOperations:0 },
      limitations:['No worker is started or resumed by replay.', 'Unavailable documentation is not collected by this recipe.']
    };
    const enabled = !!options.corrected;
    if (enabled && options.correction && options.correction.guard !== guard) throw Error('Unsupported correction guard; arbitrary guards are not executed.');
    const scenario = options.scenario || 'ready';
    return {
      ...base, kind:'person-comparison', fixture:clone(fixture), params:{personId:42,asOf:fixture.asOf},
      scenario, correction:options.correction ? clone(options.correction) : null,
      steps:[{operation:'simulate-http',method:'GET',path:'/person/42'},{operation:'read-embedded-candidates'},{operation:'whole-name-contract',corrected:enabled}],
      expected:scenario === 'partial' || scenario === 'error' ? null : name(fixture.registry),
      limitations:['A proposed guard is evaluated only by the finite offline fixture.', 'No source patch, production runtime or integration coverage is proven.']
    };
  }
  function replay(recipeValue) {
    const r = recipeValue;
    if (!r || r.format !== 'dt.admin-intent-proposal/v1' || !r.source || !r.fixture || !Array.isArray(r.steps)) throw Error('Unsupported or incomplete recipe format.');
    if (r.kind === 'checkout-checkpoint') {
      if (r.taskId !== 'SHOP-142' || r.source.repository !== 'DEMO/checkout' || JSON.stringify(r.fixture) !== JSON.stringify(checkoutFixture) || !r.checkpoint || r.params || r.steps.some(s => s.operation === 'whole-name-contract')) throw Error('Recipe task and checkpoint scope disagree.');
      const completed = r.checkpoint.completedSources;
      const passed = Array.isArray(completed) && completed.length === 3 && checkoutFixture.completedSources.every(s => completed.includes(s));
      return { name:r.name, taskId:r.taskId, passed, outcome:passed?'checkpoint-retained':'checkpoint-incomplete', completedSources:completed, localDocumentationState:r.checkpoint.docsState, unresolvedRealSource:checkoutFixture.missingSource, externalOperations:0, effects };
    }
    if ((r.kind && r.kind !== 'person-comparison') || (r.taskId && r.taskId !== 'PERS-218') || JSON.stringify(r.fixture) !== JSON.stringify(fixture) || r.source.repository !== 'DEMO/person-service' || r.params?.personId !== fixture.personId || r.params?.asOf !== fixture.asOf) throw Error('Recipe task and person fixture scope disagree. Only the fixed embedded fixture is supported.');
    const assertion = r.steps.find(s => s.operation === 'whole-name-contract');
    if (!assertion || typeof assertion.corrected !== 'boolean') throw Error('A boolean offline policy is required.');
    if (assertion.corrected && r.correction && r.correction.guard !== guard) throw Error('Unsupported correction guard.');
    const result = comparison(r.scenario || 'ready', assertion.corrected);
    if (result.complete && typeof r.expected !== 'string') throw Error('A complete comparison requires an explicit expected name.');
    const passed = result.complete && result.actual === r.expected;
    return { name:r.name, taskId:'PERS-218', passed, outcome:result.complete ? passed?'passed':'failed' : result.verdict, actual:result.actual, expected:result.complete?r.expected:result.expected, effects };
  }
  const api = { fixture, checkoutFixture, tasks, guard, clone, select, name, comparison, verify, taskState, normalizeTask, session, persist, saveCorrection, sourceSample, recipe, replay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntentDemo = api;
})(typeof window === 'undefined' ? globalThis : window);
