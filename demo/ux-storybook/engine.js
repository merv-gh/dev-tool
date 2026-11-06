/* Deterministic, offline replay shared by the browser and Node. No dev-tool calls. */
(function (root) {
  const fixture = {
    repository: 'DEMO/checkout', revision: 'storybook-fixture-v1', environment: 'dev (synthetic)',
    evidence: [
      { id: 'entry', kind: 'entry', label: 'POST /refunds', source: 'RefundController.java:24', origin: 'illustrative static evidence' },
      { id: 'service', kind: 'service', label: 'RefundService.refund', source: 'RefundService.java:41', origin: 'illustrative static evidence' },
      { id: 'table', kind: 'table', label: 'sales.refund', source: 'RefundRepository.java:18', origin: 'model candidate', uncertainty: 'The singular table name needs catalog verification.' },
      { id: 'topic', kind: 'topic', label: 'refund.created', source: 'RefundPublisher.java:32', origin: 'illustrative static evidence', uncertainty: 'Delivery and transaction ordering are unverified.' }
    ]
  };
  const initial = () => ({ version: 1, story: 'investigate', intent: 'Why does a refund appear successful but never reach the ledger?', ticket: 'SHOP-142', selected: 'table', lens: 'flow', query: 'refund', correction: null, note: '', positions: { table: 0 }, scenario: 'success' });
  function validate(s) {
    if (!s || s.version !== 1 || !['investigate', 'handoff'].includes(s.story)) throw Error('Unsupported story or recipe version. Open a fresh story.');
    for (const key of ['intent', 'ticket', 'query', 'note']) if (typeof s[key] !== 'string' || s[key].length > 2000) throw Error('Invalid ' + key + '. Use at most 2,000 characters.');
    if (!fixture.evidence.some(e => e.id === s.selected) || !['flow', 'evidence'].includes(s.lens)) throw Error('Invalid evidence selection.');
    if (!['success','failure'].includes(s.scenario)) throw Error('Invalid failure scenario.');
    if (s.correction && (typeof s.correction.target !== 'string' || !s.correction.target.trim() || s.correction.target.length > 160 || typeof s.correction.reason !== 'string' || !s.correction.reason.trim() || s.correction.reason.length > 2000 || !['task', 'project-draft'].includes(s.correction.scope))) throw Error('A correction needs a target, scope and reason.');
    if (!s.positions || !Number.isInteger(s.positions.table) || Math.abs(s.positions.table) > 48) throw Error('Invalid graph position.');
    if (s.draft && (typeof s.draft.target !== 'string' || s.draft.target.length > 160 || typeof s.draft.reason !== 'string' || s.draft.reason.length > 2000 || !['task', 'project-draft'].includes(s.draft.scope))) throw Error('Invalid correction draft.');
    if (JSON.stringify(s).length > 12000) throw Error('This draft is too large for a review link.');
    return s;
  }
  function replay(recipe) {
    if (recipe?.format !== 'dt-ux-story/1') throw Error('Expected a dt-ux-story/1 recipe.');
    if (recipe.source?.revision !== fixture.revision) throw Error('Fixture revision differs. Use the matching storybook revision.');
    const s = validate(recipe.state), q = s.query.trim().toLowerCase();
    if (s.scenario === 'failure') return { mode: 'offline fixture', status: 'failed', failedStep: 2, error: 'Catalog unavailable (simulated)', input: q, completed: ['load-pinned-evidence'], runtimeProof: false };
    const matches = fixture.evidence.filter(e => [e.label, e.source, e.kind, e.id === 'table' ? s.correction?.target || '' : ''].join(' ').toLowerCase().includes(q));
    return { mode: 'offline fixture', input: q, matched: matches.map(e => e.id), count: matches.length, originalTarget: 'sales.refund', effectiveTarget: s.correction?.target || 'sales.refund', correction: s.correction || null, runtimeProof: false, gaps: ['No production queries executed.', 'Kafka delivery and database transaction ordering require integration evidence.'] };
  }
  function recipe(s) {
    validate(s);
    return { format: 'dt-ux-story/1', source: { repository: fixture.repository, revision: fixture.revision, environment: fixture.environment }, state: structuredClone(s), steps: [{ adapter: 'offline-fixture', operation: 'filter-evidence', arguments: { q: s.query } }, { adapter: 'offline-fixture', operation: 'apply-declared-correction', arguments: s.correction }], expected: replay({ format: 'dt-ux-story/1', source: fixture, state: s }), limitations: ['Illustrative evidence, distinct from the actual indexed app baseline.', 'No fresh Joern parse or live runtime proof.', 'Task notes and corrections are included. Review content before sharing.'] };
  }
  const api = { fixture, initial, validate, replay, recipe };
  if (typeof module !== 'undefined') module.exports = api;
  else root.StoryEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
