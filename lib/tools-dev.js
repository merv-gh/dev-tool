module.exports = ({ str, int, env }) => {
  const obj = description => ({ type: 'object', additionalProperties: true, description });
  const arr = description => ({ type: 'array', items: { type: 'object', additionalProperties: true }, description });
  const bool = (description, def = false) => ({ type: 'boolean', default: def, description });
  const R = () => require('./reproduction');
  async function waitCapture(job) {
    let done = job;
    if (job.state === 'running') {
      let timer;
      try { done = await Promise.race([job.promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.min(50000, require('./config').getTests().waitMs)); })]); }
      finally { clearTimeout(timer); }
    }
    if (!done) return { job: job.id, state: 'running', log: job.log.slice(-3), next: 'Call fixture_capture with job to wait for the result; progress is on /admin.' };
    return { job: done.id, state: done.state, ms: done.ms, ...(done.error ? { error: done.error } : done.result) };
  }
  return [
    { name: 'fixture_schema', group: 'code', description: 'Inspect Kafka correlation paths independently from capture. Reads cached JSON Schema, Avro, flattened fields and samples, with evidence and types. An optional path is checked against the known shape; unknown schemas do not establish a missing path. Headers may have undeclared keys.',
      input: { env, topic: str('Exact cached topic'), path: str('Optional value/key/headers path, including []') }, required: ['topic'],
      run: a => { const environment = a.env || require('./config').envNames()[0], cached = require('./kafka').cached(environment, a.topic); if (!cached) throw new Error(`no cached topic ${a.topic}`); const S = require('./fixture-schema'); return { env: environment, topic: a.topic, paths: S.paths(cached), ...(a.path ? { path: a.path, known: S.validatePath(cached, a.path) } : {}) }; } },
    { name: 'fixture_plan', group: 'code', description: 'Offline plan for related test data across Postgres databases and Kafka. Reads cached schemas, FKs and usage indexes first. Seeds use explicit db/schema.table and equality filters. Follows schema FKs; cross-database joins are explicit relations. Returns candidates for review, never guesses them as facts. Inspect then pass the inputs to fixture_capture.',
      input: { env, service: str('Service whose usage informs candidates'), seeds: arr('Roots: [{db, table:"sales.orders", where:{id:42}}]'), relations: arr('Cross-DB relationships: [{from:{db,table,columns:[...]},to:{db,table,columns:[...]},required:true,evidence:"file:line"}]'), topics: arr('Topics: [{topic,matches:[{path:"value.orderId",from:{db,table,column:"id"}}],match:"all|any",offsets:{partition:offset}}]'), limits: obj('depth, rowsPerTable, totalRows, messagesPerTopic, totalMessages, queries'), includeChildren: bool('Also follow reverse FKs (bounded); default only required parents') },
      run: a => R().plan(a) },
    { name: 'fixture_capture', group: 'code', description: 'Capture one reproducible scenario with bounded, parameterized, read-only reads. Input is fixture_plan inputs or its returned plan. Captures every Kafka partition window, correlation matches, offsets and provenance. Masks sensitive values consistently by default. Returns capture id + interactive explorer; gaps/truncation prevent a claim of completeness. Never writes to the environment.',
      input: { plan: obj('fixture_plan result or input'), mask: bool('Mask personal/secret fields consistently across PG and Kafka', true), job: str('Poll a running capture instead of starting another') },
      run: async a => {
        const J = require('./jobs');
        let job = a.job ? J.find(a.job) : null;
        if (a.job && (!job || !job.key.startsWith('capture:'))) throw new Error('capture job not found');
        if (!job) {
          if (!a.plan) throw new Error('plan is required to start a capture');
          const key = require('crypto').createHash('sha256').update(JSON.stringify([a.plan, a.mask !== false])).digest('hex');
          job = J.start(`capture:${key}`, `fixture capture ${a.plan.env || ''}`, async log => {
            const r = await R().capture(a.plan, { mask: a.mask !== false, log: line => { if (job.state !== 'running') throw new Error('capture cancelled'); log(line); } });
            const id = R().save(r);
            let view, viewError;
            try { view = require('./results').saveView('reproduction', r, { title: 'Reproduction capture' }); } catch (e) { viewError = e.message; }
            return { capture: id, counts: r.counts, complete: r.complete, gaps: r.gaps, view, ...(viewError ? { viewError } : {}) };
          });
        }
        return waitCapture(job);
      } },
    { name: 'fixture_validate', group: 'code', description: 'Inspect one saved fixture capture separately: recheck captured parent relationships and return all capture gaps, completeness and counts. Does not query the environment or write scratch databases; fixture_replay separately validates real SQL and constraints.',
      input: { capture: str('Saved fixture capture id') }, required: ['capture'], run: a => { const capture = R().load(a.capture), validation = R().validate(capture), gaps = [...capture.gaps, ...validation.gaps]; return { capture: a.capture, ok: capture.complete && validation.ok && !gaps.length, counts: capture.counts, gaps }; } },
    { name: 'fixture_export', group: 'code', description: 'Save a capture into [module/]src/test/resources/dt-fixtures/<name>: per-DB schema/data/constraints SQL + JSON, Kafka JSONL/schema/offsets, hashed manifest and loading instructions. Existing fixtures are preserved unless overwrite=true. Generated resources can be committed with tests.',
      input: { workspace: str('Writable workspace id'), capture: str('Capture id'), name: str('Scenario name'), directory: str('Optional resource directory (for a multi-module project)'), overwrite: bool('Replace this fixture if it exists') }, required: ['workspace', 'capture'],
      run: a => R().exportFixture(a.workspace, R().load(a.capture), a) },
    { name: 'fixture_replay', group: 'code', description: 'Verify fixture hashes and load its databases on the configured scratch Postgres, check real constraints, then drop all throwaway databases. No writes to configured environment databases. Kafka files are for the service test producer. For actual tests use test_run fixture_path.',
      input: { workspace: str('Workspace id'), directory: str('Fixture resource directory'), allow_incomplete: bool('Replay despite reported capture gaps') }, required: ['workspace', 'directory'],
      run: async a => { const replay = await R().replay(a.workspace, a.directory, { allowIncomplete: a.allow_incomplete }); try { return { validated: true, databases: Object.keys(replay.databases), topics: replay.topics }; } finally { await replay.cleanup(); } } },
    { name: 'experiment_save', group: 'code', description: 'Save a repeatable read-only investigation with parameters, constrained JS, assertions and an explicit tool allowlist. Code supports await tools.pg_query(...), vars, test/expect/assert and return. No filesystem, subprocess, direct fetch, process or import capability. For trusted project investigations.',
      input: { id: str('Experiment id'), description: str('Question or hypothesis'), code: str('Sandbox JavaScript'), defaults: obj('Default vars'), tools: { type: 'array', items: { type: 'string' }, description: 'Explicit read-only tools, default [find]' } }, required: ['id', 'code'], run: a => require('./experiments').save(a) },
    { name: 'experiment_run', group: 'code', description: 'Run a saved read-only experiment. Retains assertions, returned value, calls and timings for comparison; optionally exposes a masked fixture capture as vars.fixture.',
      input: { id: str('Experiment id'), params: obj('Override vars'), capture: str('Optional fixture capture id'), timeout_ms: int('Time limit, at most 120000', 30000) }, required: ['id'], run: a => require('./experiments').run(a.id, { ...a, timeoutMs: a.timeout_ms }) },
    { name: 'experiment_list', group: 'code', description: 'List saved investigation experiments; with id show its code, parameter defaults and retained run summaries.', input: { id: str('Optional experiment id') }, run: a => require('./experiments').list(a.id) },
    { name: 'experiment_compare', group: 'code', description: 'Compare two retained experiment runs: assertion changes, returned-value diff, code identity and elapsed-time difference. Defaults to the latest two runs.', input: { id: str('Experiment id'), before: str('Earlier run id'), after: str('Later run id') }, required: ['id'], run: a => require('./experiments').compare(a.id, a.before, a.after) },
    ...require('./tools-scenario')({ str, int, env }),
  ];
};
