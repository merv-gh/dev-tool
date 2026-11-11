// Tools over code: the code index (trigram grep, symbols), impact radius, DDL snapshots, workspaces,
// generated tests and their runs, patches. Part of the registry in tools.js.
module.exports = ({ tabular, str, int, env, clip }) => {
  const bool = (description, def = false) => ({ type: 'boolean', default: def, description });
  const list = (description) => ({ type: 'array', items: { type: 'string' }, description });
  // the compile check of written Java files: on by default (tests.compileCheck, tests.compileFix)
  const CHECK = { check: bool('Compile the written Java files right away', true), fix: bool('Apply the clear compile fixes to the files (false: offer them as suggestions)', true) };
  const repos = { description: 'Index keys: PROJECT/repo, name, glob, workspace id or immutable revisionKey from code_index; comma separated. Empty: latest fetched repos.', type: 'string' };
  const R = () => require('./results');
  // the indexes to query; workspaces written to since their last index are indexed again first
  const keysOf = (spec) => {
    const keys = require('./codeindex').select(spec);
    for (const k of keys) if (k.startsWith('work/')) try { require('./workspace').index(k.slice(5)); } catch {}
    return keys;
  };

  // answer a long job before the chat client gives up; asking again with job= joins it
  async function waitJob(job, wait, again) {
    const J = require('./jobs');
    if (job.state !== 'running') { const v = J.get(job.id); return v.error ? { job: v.id, state: v.state, error: v.error } : { job: v.id, state: v.state, ...v.result }; }
    let timer;
    const done = await Promise.race([job.promise, new Promise(r => { timer = setTimeout(() => r(null), wait); })]);
    clearTimeout(timer);
    if (!done) return { job: job.id, state: 'running', log: (J.get(job.id).log || []).slice(-5), note: `Still running after ${Math.round(wait / 1000)} s. Call ${again} with job="${job.id}" to wait for it.` };
    return done.error ? { job: done.id, state: done.state, error: done.error } : { job: done.id, state: done.state, ...done.result };
  }

  return [
    {
      name: 'showcase',
      group: 'showcase',
      description: 'Service showcase: environment health/builds, passport, editable ports/metadata and retained semantic revisions. With target, also impact and an isolated workspace test/patch. Semantic reads never start a parse. If running, observe with job.',
      input: { service: str('Service name'), target: str('Code part to test: Class#method or Class'), refresh_passport: { type: 'boolean', default: false, description: 'Build the passport again (default: the existing one)' }, envs: str('Environments, comma separated (default: all)'), ref: str('Branch, tag or sha for the workspace (default: the default branch)'), test: str('Test source to run instead of the skeleton'), job: str('A job id from an earlier "running" answer') },
      required: [],
      run: async (a) => {
        const J = require('./jobs');
        let job = a.job ? J.find(a.job) : null;
        if (a.job && !job) throw new Error(`no job ${a.job}`);
        if (!job) {
          if (!a.service) throw new Error('service: which service to show');
          job = J.start(`showcase:${a.service}:${a.target || ''}`, `showcase ${a.service}${a.target ? ` ${a.target}` : ''}`, async (log) => {
            const S = require('./showcase');
            return S.summary(await S.run({ service: a.service, target: a.target, envs: a.envs, ref: a.ref, test: a.test, refreshPassport: a.refresh_passport, log }));
          });
        }
        return waitJob(job, require('./config').getTests().waitMs, 'showcase');
      },
    },
    {
      name: 'code_index',
      group: 'code',
      description: 'Index a repo/service at a branch, tag or SHA for code_search, code_symbols and impact. Commit indexes retain source snapshots; revisionKey pins one. A cached full SHA needs no fetch. Without repo/service, list latest indexes; versions=true includes history.',
      input: { service: str('Service (resolved like passport)'), project: str('Project key'), repo: str('Repo slug'), ref: str('Branch, tag or sha (default branch if empty)'), versions: bool('Include stored commit indexes when listing') },
      limit: (a) => (a.service || a.repo ? 'bitbucket' : null),
      run: async (a) => {
        const CI = require('./codeindex');
        if (!a.service && !a.repo) return tabular('code-indexes', CI.list({ versions: a.versions }).map(i => ({ key: i.key, revisionKey: i.revisionKey || '', ref: i.ref || '', sha: (i.sha || '').slice(0, 12), files: i.files, classes: i.classes, edges: i.edges, trigrams: i.trigrams, builtAt: i.builtAt, ms: i.ms })), { query: 'code indexes' }, { preview: 30 });
        let { project, repo } = a;
        if (a.service && !(project && repo)) ({ project, repo } = await require('./passport').resolveRepo(a.service));
        if (/^[a-f0-9]{40}$/i.test(a.ref || '')) {
          const cached = CI.revisions(`${project.toUpperCase()}/${repo}`, a.ref);
          if (cached.length === 1) { const { root, list, dir, tri, graph, ...info } = cached[0]; return { ...info, reused: true }; }
          // Multiple snapshots at a SHA can reflect different extraction settings or
          // dirty sources. Never silently pick one; exact revisionKey stays usable.
        }
        const info = await require('./git').fetchRef(project, repo, a.ref);
        const r = CI.build(info.path, `${info.project}/${repo}`, { project: info.project, repo, ref: info.ref, sha: info.sha, service: a.service || null });
        const { root, ...rest } = r;
        return rest;
      },
    },
    {
      name: 'code_search',
      group: 'code',
      description: 'Search local code by text or JavaScript regex. Uses trigram indexes when present and fast local grep otherwise, without fetching or indexing. repo selects one repository/service/workspace; repos retains multi-repo/glob selection. Single-repo rows omit the repeated repo column. Use impact for semantic callers.',
      input: { pattern: str('Text, or a regex when regex=true'), regex: bool('pattern is a regex'), repo: str('One repository/index key, repo slug, or work/<workspace id>'), repos, glob: str('Path glob(s), comma separated'), ignore_case: bool('Ignore case', true), context: int('Lines around each hit', 0), tests: bool('Include test sources', true), limit: int('Max hits', 100) },
      required: ['pattern'],
      run: async a => {
        const r=await require('./code-search').search(a),single=r.sources.length===1;
        const rows=r.hits.map(h=>({...(!single?{repo:h.repo}:{}),file:`${h.path}:${h.line}`,text:h.text,...(h.context?{context:h.context}:{})}));
        const t=tabular('code-search',rows,{query:`${a.pattern}${a.glob?` in ${a.glob}`:''}`,...(single?{repository:r.sources[0]}:{})},{preview:30});
        return {...t,...(single?{repository:r.sources[0]}:{}),files:r.files,repos:r.sources.length,scanned:r.scanned,candidates:r.candidates,truncated:r.truncated||undefined,ms:r.ms,prefilter:r.plan||r.backends.join(' + '),backends:r.backends,...(r.unindexed.length?{unindexed:r.unindexed}:{}),...(!r.sources.length?{note:'No matching local source or retained index; code_index, passport or workspace_open can fetch it.'}:{}),...(!rows.length&&!a.regex&&/[|[\]()*+?]/.test(a.pattern)?{hint:'This was a literal search (regex=false). If the operators are intended as a regular expression, retry with regex:true; otherwise simplify the text or check the path glob.'}:{})};
      },
    },
    {
      name: 'code_symbols',
      group: 'code',
      description: 'Find classes, methods and fields by name words in the code graphs ("payment service create", "FeeCalculator"): id, kind, Spring role, file:line, signature. Use the ids with impact and test_context.',
      input: { q: str('Words, all must match (case-insensitive)'), repos, kind: { type: 'string', enum: ['', 'class', 'method', 'field'], default: '' }, limit: int('Max results', 50) },
      required: ['q'],
      run: (a) => {
        const CI = require('./codeindex');
        const words = a.q.toLowerCase().split(/[\s#.]+/).filter(Boolean);
        const rows = [];
        for (const key of keysOf(a.repos)) {
          const idx = CI.load(key), g = idx?.graph_();
          const identity = require('./semantic-identity');
          for (const c of g?.classes || []) {
            const hit = (s) => words.every(w => s.toLowerCase().includes(w));
            if ((!a.kind || a.kind === 'class') && hit(c.id)) rows.push({ id: identity.code(key, identity.revision(idx), c.id), legacyId: c.id, revision: identity.revision(idx), kind: c.kind, role: c.role || '', repo: key, file: `${c.file}:${c.line}`, signature: `${c.annos.map(x => '@' + x).join(' ')} ${c.kind} ${c.name}`.trim() });
            if (!a.kind || a.kind === 'method') for (const m of c.methods) if (hit(`${c.id}#${m.name}`)) rows.push({ id: identity.code(key, identity.revision(idx), `${c.id}#${identity.signature(m)}`), legacyId: `${c.id}#${m.name}`, revision: identity.revision(idx), kind: m.ctor ? 'constructor' : 'method', role: c.role || '', repo: key, file: `${c.file}:${m.line}`, signature: `${m.ret ? m.ret + ' ' : ''}${m.name}(${m.params.map(p => `${p.type} ${p.name}`).join(', ')})` });
            if (!a.kind || a.kind === 'field') for (const f of c.fields) if (hit(`${c.id}.${f.name}`)) rows.push({ id: identity.code(key, identity.revision(idx), `${c.id}.${f.name}`), legacyId: `${c.id}.${f.name}`, revision: identity.revision(idx), kind: 'field', role: c.role || '', repo: key, file: `${c.file}:${f.line}`, signature: `${f.type} ${f.name}${f.column ? ` -> column ${f.column}` : ''}${f.inject ? ' (injected)' : ''}` });
            if (rows.length > 2000) break;
          }
        }
        rows.sort((x, y) => (x.kind === 'class' ? 0 : 1) - (y.kind === 'class' ? 0 : 1) || x.id.length - y.id.length);
        return tabular('code-symbols', rows.slice(0, a.limit || 50), { query: `symbols: ${a.q}` }, { preview: 25 });
      },
    },
    {
      name: 'code_read',
      group: 'code',
      description: 'Read a file of an indexed repo or workspace with line numbers (from..to, 400 lines at most).',
      input: { repo: str('PROJECT/repo or work/<workspace id>'), path: str('File path in the repo'), from: int('First line', 1), to: int('Last line (default from+299)') },
      required: ['repo', 'path'],
      run: (a) => {
        const CI = require('./codeindex');
        const key = CI.select(a.repo)[0] || a.repo;
        return CI.read(key, a.path, { from: a.from || 1, to: a.to ? Math.min(a.to, (a.from || 1) + 399) : undefined });
      },
    },
    {
      name: 'impact',
      group: 'code',
      description: 'Impact radius: what is affected when something changes, walking "who uses it" back through the code graphs of all indexed repos and workspaces, the Postgres usage index of env, and service passports. Target: a class or method ("PaymentService#create", FQN, file.java:42), a table ("pay.payments"), a column ("pay.payments.fee": entity fields, SQL naming it, function bodies, views, indexes/constraints), a database function, a Kafka topic ("topic:payments.created"), an ES index ("es:orders"), an endpoint ("POST /payments/{id}/settle": handlers and Feign callers in other services). Returns layers by distance with file:line and why, the endpoints/topics/tables/services reached, candidate tests (inspect coverage before choosing regression scope), and text mentions in config/SQL files. Shown as a view.',
      input: { target: str('Canonical ID or legacy name; ambiguous names return candidates'), env, db: str('Exact logical database for a database target'), repos, depth: int('Steps back to walk (0..32)', 4), limit: int('Items per page', 300), node_limit: int('Maximum visited nodes (1..100000)', 10000), time_ms: int('Traversal budget in milliseconds (1..5000)', 1000), max_output_bytes: int('Result byte budget (4096..262144)', 32768), cursor: str('Continuation for the same query and graph revision') },
      required: ['target'],
      run: (a) => {
        keysOf(a.repos);
        const r = require('./impact').impact(a.target, { env: a.env, db: a.db, repos: a.repos, depth: a.depth ?? 4, limit: a.limit ?? 300, node_limit: a.node_limit ?? 10000, time_ms: a.time_ms ?? 1000, max_output_bytes: a.max_output_bytes ?? 32768, cursor: a.cursor });
        if (!r.resolved?.length) return r;
        const view = R().saveView('impact', r, { title: `impact of ${a.target}` });
        const near = r.items.filter(i => i.depth <= 2).slice(0, 25).map(i => `${i.depth} ${i.kind} ${i.name}${i.file ? ` (${i.file}:${i.line})` : ''} <- ${i.via}`);
        return require('./impact').boundResult({ protocol: r.protocol, identityVersion: r.identityVersion, env: r.env, graphRevision: r.graphRevision, complete: r.complete, traversalComplete: r.traversalComplete, coverage: r.coverage, cutReasons: r.cutReasons, frontier: r.frontier, frontierTotal: r.frontierTotal, continuation: r.continuation, next: r.next, gaps: r.gaps, gapTotal: r.gapTotal, total: r.total, resolvedTotal: r.resolvedTotal, outputBytes: r.outputBytes, summaryTruncated: r.summaryTruncated, target: r.target, resolved: r.resolved, counts: r.counts, endpoints: r.endpoints, topics: r.topics, tables: r.tables, functions: r.functions, services: r.services, tests: r.tests, db: r.db, nearest: near, mentions: (r.mentions || []).slice(0, 10).map(m => `${m.repo} ${m.path}:${m.line} ${m.text}`), truncated: r.truncated, view }, a.max_output_bytes ?? 32768);
      },
    },
    {
      name: 'ddl_snapshot',
      group: 'code',
      description: 'DDL of a synced database (schemas, extensions, enum/domain types, sequences, tables with defaults, identity, constraints, indexes, comments, functions, procedures, views in order, triggers) for tests: all of it, or only some tables, functions or what a service uses, closed over what they need (FK targets, trigger functions, called functions and their tables). With workspace, written to <module>/src/test/resources/dt-schema/<db>.sql (or path).',
      input: { env, db: str('Database name from the env'), tables: list('Tables (schema.name or name)'), functions: list('Functions/procedures'), service: str('A service: the objects its passport uses in this db'), workspace: str('Write it into this workspace'), path: str('File path in the workspace') },
      required: ['db'],
      run: (a) => {
        const s = require('./ddl').snapshot(a.env, a.db, { tables: a.tables, functions: a.functions, service: a.service });
        const out = { env: a.env, db: a.db, syncedAt: s.syncedAt, counts: s.counts, tables: s.tables, views: s.views, functions: s.functions, missing: s.missing.length ? s.missing : undefined };
        if (a.workspace) {
          const p = a.path || `src/test/resources/dt-schema/${a.db}.sql`;
          out.written = require('./workspace').write(a.workspace, p, { content: s.sql });
        } else out.sql = clip(s.sql, 12000);
        return out;
      },
    },
    {
      name: 'workspace_open',
      group: 'code',
      description: 'Open/reuse a writable repo/ref checkout in the current authenticated task. Reconnects and restarts preserve its files and build state; reuse never pulls or resets. fresh=true creates a separate checkout. Different principals/tasks remain isolated. Indexed for code_search, impact and test_context. Edit with workspace_write, run test_run, export workspace_patch; workspace_push publishes only when requested and enabled.',
      input: { service: str('Service (resolved like passport)'), project: str('Project key'), repo: str('Repo slug'), ref: str('Branch, tag or sha (default branch if empty)'), env: str('Check out the commit deployed in this env (with service)'), fresh: { type: 'boolean', default: false, description: 'Create a separate checkout; preserve the existing task workspace unchanged' }, libraries: { type: 'boolean', default: false, description: 'Also fetch and index the sources of its internal libraries now (only for flows through library code when the service has no passport; tests do not need them: the build takes the jars from the company repository)' }, job: str('A job id from an earlier "running" answer') },
      limit: (a) => (a.job ? null : 'bitbucket'),
      // a job: a big repo and its libraries can take longer than the chat client waits
      run: async (a) => {
        const J = require('./jobs');
        let job = a.job ? J.find(a.job) : null;
        if (a.job && !job) throw new Error(`no job ${a.job}`);
        if (!job) {
          if (!a.service && !(a.project && a.repo)) throw new Error('give service, or project and repo');
          job = J.start(`workspace:${a.service || `${a.project}/${a.repo}`}:${a.ref || ''}:${Date.now()}`, `workspace_open ${a.service || `${a.project}/${a.repo}`}${a.ref ? `@${a.ref}` : ''}`, async () => {
            const w = await require('./workspace').open({ service: a.service, project: a.project, repo: a.repo, ref: a.ref, env: a.env, fresh: a.fresh, libraries: a.libraries === true });
            // the classpath for compile checks, in the background: the first workspace_write is checked at once
            require('./javacheck').warm(w.id);
            const notes = require('./trace').current()?.notes || [];
            return { ...w, libs: (w.libs || []).map(l => (l.error ? `${l.artifactId}: ${String(l.error).slice(0, 160)}` : `${l.artifactId} ${l.repo}${l.module ? '/' + l.module : ''}`)), ...(notes.length ? { notes } : {}) };
          });
        }
        return waitJob(job, require('./config').getTests().waitMs, 'workspace_open');
      },
    },
    {
      name: 'workspace_list',
      group: 'code',
      description: 'Retained workspaces in this authenticated task: id, repo, ref, commit, last use and whether files still exist. Another chat/task scope has its own list.',
      input: {},
      run: () => require('./workspace').list(),
    },
    {
      name: 'workspace_read',
      group: 'code',
      description: 'Read copyable workspace source with its line range, or list a folder. line_numbers=true adds display prefixes; never copy those prefixes into workspace_write content. Prefer exact find/replace edits for small fixes.',
      input: { workspace: str('Workspace id'), path: str('File or folder path'), from: int('First line', 1), to: int('Last line'), line_numbers: bool('Add display line-number prefixes (plain source by default)',false) },
      required: ['workspace', 'path'],
      run: (a) => require('./workspace').read(a.workspace, a.path, { from: a.from || 1, to: a.to, lineNumbers:a.line_numbers===true }),
    },
    {
      name: 'workspace_write',
      group: 'code',
      description: 'Write a file in a workspace: the whole content (new test files), or edits [{find, replace}] where each find matches exactly once (fixes in existing code). The change shows up in workspace_patch. A Java file is compiled right away against its module\'s classpath: the answer has compile.errors with their lines, compile.fixed (what was fixed in the file already: missing imports and static imports, throws Exception on tests, @MockBean/@MockitoBean for this Spring Boot, javax -> jakarta) and compile.suggestions (ready edits to choose from, e.g. which of several classes to import). Ambiguous imports are suggestions only, ranked with project and configured internal packages first, with reasons. Read compile before the next step; a file with errors does not need a test run to find them. check=false skips the check; fix=false checks but leaves the file as written (the fixes come as suggestions).',
      input: { workspace: str('Workspace id'), path: str('File path'), content: str('Whole file content'), edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'] }, description: 'Replacements, applied in order' }, expected_revision: {type:['string','null'],description:'Optional SHA256 from an editor read; null requires a new file. Rejects concurrent edits'}, ...CHECK },
      required: ['workspace', 'path'],
      // compiled at once against the module's classpath: errors with their lines, clear fixes applied (imports,
      // throws Exception, @MockBean/@MockitoBean), the rest offered as ready edits
      run: async (a) => {
        const w = require('./workspace').write(a.workspace, a.path, { content: a.content, edits: a.edits, expected_revision: a.expected_revision });
        if (a.check === false) return w;
        const compile = await require('./javacheck').check(a.workspace, [w.path], { fix: a.fix }).catch(e => ({ skipped: e.message }));
        return compile ? { ...w, compile } : w;
      },
    },
    {
      name: 'workspace_patch',
      group: 'code',
      description: 'Export workspace changes against its base commit as a downloadable Git patch, file counts and recorded test proof. Does not commit, push or run tests. Use workspace_push only when publishing is requested.',
      input: { workspace: str('Workspace id') },
      required: ['workspace'],
      run: async (a) => {
        const p = await require('./workspace').patch(a.workspace);
        if (!p.files.length) return { ...p, patch: '', note: 'no changes yet' };
        // the tests in the patch: seen failing before the fix and passing after?
        const testClasses = p.files.filter(f => /(^|\/)src\/test\/(java|kotlin)\/.+\.(java|kt)$/.test(f.path)).map(f => f.path.replace(/^.*src\/test\/(java|kotlin)\//, '').replace(/\.(java|kt)$/, '').replace(/\//g, '.'));
        p.tests = require('./testrun').proof(a.workspace).filter(t => testClasses.includes(t.test.split('#')[0]));
        const never = testClasses.filter(c => !p.tests.some(t => t.test.startsWith(`${c}#`)));
        p.notes = [
          ...p.tests.filter(t => t.verdict === 'green-only').map(t => `${t.test} never failed: it may not test the bug (fine for a test of behaviour that already worked)`),
          ...p.tests.filter(t => t.verdict === 'failing').map(t => `${t.test} still fails`),
          ...never.map(c => `${c} was never run`),
          ...(p.tests.length && !p.tests.every(t => t.fullBuild) ? ['not every test has passed in a full build (test_run mode="build")'] : []),
        ];
        const view = R().saveView('patch', p, { title: `${p.repo} @ ${p.base.slice(0, 10)}: ${p.files.length} files` });
        return { workspace: p.id, repo: p.repo, base: p.base, files: p.files, tests: p.tests.map(t => `${t.verdict}: ${t.test.replace(/^.*\.(?=[^.#]+#)/, '')}${t.fullBuild ? '' : ' (fast runs only)'}`), notes: p.notes.length ? p.notes : undefined, apply: p.apply, view, download: `${view.replace('/show/', '/patch/')}.patch`, patch: clip(p.patch, 6000) };
      },
    },
    {
      name: 'workspace_drop',
      group: 'code',
      description: 'Delete a workspace (its files, git data and index). Take the patch first.',
      input: { workspace: str('Workspace id') },
      required: ['workspace'],
      run: (a) => require('./workspace').drop(a.workspace),
    },
    {
      name: 'test_context',
      group: 'code',
      description: 'Plan an outside-in test from an HTTP/listener/job entry through real service and internal-library code to observable exits. A class target resolves to public callers; multiple callers require choosing the behavior. Returns chain, boundary doubles, fixtures, source, skeleton and an explicit integrationPlan. Database/client mocks do not prove SQL, wire or broker behavior. Use flow=false or strategy=unit for intentional class isolation; env supplies real-schema DDL.',
      input: { workspace: str('Workspace id'), target: str('Class, Class#method, file path, or an entry point: "POST /process/order", "kafka payments.settled"'), env: { ...env, description: 'Environment whose synced database gives the DDL snapshot (for repository/DAO tests)' }, db: str('Database (default: the one that has the tables)'), flow: { type: 'boolean', description: 'true: a flow test from this method (real beans on the chain, the edge mocked); false: a unit test. Default: outside-in for evidenced entry callers' }, strategy: { type:'string',enum:['outside-in','unit'],default:'outside-in',description:'Prefer entry-to-exit behavior; unit explicitly requests class isolation' } },
      required: ['workspace', 'target'],
      run: (a) => require('./testgen').context(a.workspace, a.target, { env: a.env, db: a.db, flow: a.flow, strategy: a.strategy }),
    },
    {
      name: 'workspace_push',
      group: 'code',
      description: 'Commit workspace changes and push to a feature branch only when requested and push.enabled=true. Never force or target protected/default branches. Replays onto a moved branch; conflicts stop the push. Reports recorded test proof but does not run tests or enforce green. Success advances the workspace base to the pushed commit.',
      input: { workspace: str('Workspace id'), branch: str('Branch to push to, e.g. dt/payments-tests or an existing feature branch'), message: str('Commit message') },
      required: ['workspace', 'branch', 'message'],
      run: async (a) => {
        const r = await require('./workspace').push(a.workspace, { branch: a.branch, message: a.message });
        const testClasses = r.files.filter(f => /(^|\/)src\/test\/(java|kotlin)\/.+\.(java|kt)$/.test(f)).map(f => f.replace(/^.*src\/test\/(java|kotlin)\//, '').replace(/\.(java|kt)$/, '').replace(/\//g, '.'));
        const tests = require('./testrun').proof(a.workspace).filter(t => testClasses.includes(t.test.split('#')[0]));
        return { ...r, tests, ...(testClasses.length && !tests.length ? { warning: 'the pushed tests were not run in this workspace (test_run before pushing)' } : {}) };
      },
    },
    {
      name: 'test_data',
      group: 'code',
      description: 'Generate TestData, one helper class in the module\'s test sources with a valid object for every type at the service\'s edges: request bodies and path variables of its controllers, payloads of its Kafka listeners and of what it sends, the entities its repositories read (a row as the database holds it: id and defaults set; dictionary entities from their real rows, all rows as a list), what its Feign clients answer. Built through each type\'s constructor; values from Bean Validation, the database columns the names map to (length, scale, CHECKs, FKs to d_ dictionary tables: a real row), how the code parses strings (Long.parseLong(id): the id as text), names, types. Ids of one concept are one constant (ORDER_ID) so a body, an event and a row agree. Bodies validated with @Valid get <body>Cases(): each constraint broken (false) and the edges that pass (true) for @ParameterizedTest. Also with(obj, "field", value) for variants and json(obj). With env, values come from that environment\'s synced database. Compile-checked; test_context uses it once it exists.',
      input: { workspace: str('Workspace id'), env: { ...env, description: 'Environment whose synced database gives column lengths, CHECKs and dictionary rows' }, db: str('Database (default: the one with the entity tables)'), write: bool('Write it into the workspace (false: return the source)', true) },
      required: ['workspace'],
      run: (a) => require('./testdata').generate(a.workspace, { env: a.env, db: a.db, write: a.write !== false }),
    },
    {
      name: 'test_targets', group: 'code',
      description: 'List reviewed execution target manifests: actual runner placement, dependency environment/access, deployment revision and effects. local, captured-dev and live-dev are distinct. Source env does not imply remote execution.',
      input: {}, run: () => ({ targets: require('./test-targets').list() }),
    },
    {
      name: 'differential_check', group: 'code',
      logArgs: ['profile', 'baseline', 'candidate', 'target', 'baseline_target', 'candidate_target', 'env'],
      description: 'Execute the same declared cases against separate baseline/candidate workspaces with a reviewed differential profile. Compare exact typed values, nulls, array order, errors and independently observed file/database effects. Normalizers must be reviewed config with reasons. Reports revisions, hashes, explicit proof coverage and target provenance.',
      input: { profile: str('Reviewed tests.differentialProfiles id'), baseline: str('Baseline workspace snapshot'), candidate: str('Candidate workspace snapshot'), inputs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, args: { type: 'array', items: {} } }, required: ['id', 'args'], additionalProperties: false } }, target: str('Reviewed test target; default local'), baseline_target: str('Optional separate reviewed baseline dependency target'), candidate_target: str('Optional separate reviewed candidate dependency target'), env: str('Source environment provenance') },
      required: ['profile', 'baseline', 'candidate', 'inputs'],
      run: async a => {
        const r = await require('./differential').check({ ...a, sourceEnv: a.env });
        const view = R().saveView('differential', r, { title: `Differential: ${r.outcome}` });
        return { ...r, view };
      },
    },
    {name:'workspace_coverage_plan',group:'code',description:'Plan added/modified JVM production lines against the workspace base commit (or an exact base), including untracked files. No old project coverage baseline is needed. Lines become executable/missed/unknown only after measurement.',input:{workspace:str('Workspace id'),base:str('Optional Git base commit/ref; defaults to the workspace checkout base')},required:['workspace'],run:async a=>{const p=await require('./workspace-coverage').plan(a.workspace,a);return {...p,files:p.files.map(f=>({...f,changed:undefined,sourceLines:undefined})),next:'test_run with coverage=true measures the selected tests against these changed production lines'};}},
    {name:'workspace_coverage',group:'code',description:'Read retained change coverage: uncovered changed lines/branches, unknown mappings, exact source/base pins and freshness. This is workspace JVM coverage, separate from dev-tool test_coverage. A stale report cannot claim full coverage; covered lines do not prove assertions.',input:{workspace:str('Workspace id'),report:str('Optional retained coverage report id'),file:str('Optional exact source path for full line detail')},required:['workspace'],run:a=>require('./workspace-coverage').get(a.workspace,a)},
    {
      name: 'test_run',
      group: 'code',
      description: 'Run tests of a workspace using reviewed Node node:test file execution or the JVM build. Select target for actual execution placement/dependencies; env is source-catalog provenance. Fast by default on Maven projects: after one Maven prepare per workspace, only changed sources are compiled and the tests run in one JVM (seconds); mode="build" runs the project\'s Maven/Gradle (the final check). files=[{path, content|edits}] writes before running, so a try is one call. Every result is kept per test, so workspace_patch can show which tests failed before the fix and pass after it (red-green). coverage=true measures changed production lines/branches with fresh JaCoCo data; workspace_coverage_plan previews scope; workspace_coverage reads remaining gaps. The answer has: each test, its status and time, failures with message and the code parts to work on (the repo frames of the stack trace with the lines around them), compile errors with their lines, and the output tail. With env + db (or ddl_path), the run gets a throwaway Postgres database loaded with the DDL snapshot, passed to Spring as SPRING_DATASOURCE_*. Shown as a view. Takes a while: if it answers "running", call it again with that job id.',
      input: {
        workspace: str('Workspace id'), tests: list('JVM classes (FooTest), Class#method, or explicit Node .test.js/.cjs/.mjs file paths'),
        files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } } } } }, required: ['path'] }, description: 'Write these first (like workspace_write), then run: one call per try' },
        mode: { type: 'string', enum: ['auto', 'fast', 'build'], default: 'auto', description: 'fast: compile only what changed and run in one JVM (Maven projects; a few seconds); build: the project\'s Maven/Gradle (the final check before the patch); auto: fast where it fits' },
        coverage: bool('Collect fresh JaCoCo coverage of changed JVM production lines only; no project-wide coverage baseline required'), coverage_base: str('Optional Git comparison base for coverage; defaults to the workspace base commit'),
        target: str('Reviewed execution target id from test_targets; default local. env alone never selects a live deployment'),
        env: str('Source catalog environment for db DDL; runtime is selected separately by target'), db: str('Database to snapshot into the throwaway test database'),
        ddl_path: str('Or: a DDL file in the workspace to load (e.g. src/test/resources/dt-schema/pay.sql)'),
        fixture_path: str('Saved src/test/resources/dt-fixtures/<name>; replay its PG databases on scratch Postgres and expose Kafka files as DT_FIXTURE_PATH'),
        fixture_runtime: str('Owned native PG/ES/Kafka lease id from fixture_runtime_start; caller arms, independently checks effects and stops it. Local execution only; choose this or fixture_path/db/ddl_path'),
        fixture_template: bool('Reuse a verified immutable prefilled PostgreSQL template and allocate private leased clones'),
        fixture_bindings: { type: 'object', additionalProperties: { type: 'string' }, description: 'For multiple databases: {orders:"SPRING_DATASOURCE",billing:"BILLING_DATASOURCE"}; each prefix gets _URL, _USERNAME, _PASSWORD' },
        allow_incomplete: bool('Replay a fixture with reported gaps (review fixture explorer first)'),
        job: str('A job id from an earlier "running" answer'), ...CHECK,
      },
      required: ['workspace'],
      run: async (a) => {
        const J = require('./jobs');
        const cfg = require('./config').getTests();
        let job = a.job ? J.find(a.job) : null;
        if (a.job && !job) throw new Error(`no job ${a.job}`);
        if (job && !job.key.startsWith(`tests:${a.workspace}:`)) throw new Error('test job belongs to a different workspace');
        if (!job) {
          if (!a.tests?.length) throw new Error('tests: which test classes to run');
          const db = a.ddl_path || a.db ? { env: a.env || require('./config').envNames()[0], db: a.db, ddlPath: a.ddl_path } : null;
          require('./test-targets').resolve(a.target || 'local', { env: a.env, fixturePath: a.fixture_path, fixtureRuntime: a.fixture_runtime, db });
          job = J.start(require('./test-targets').jobKey(a), `tests ${a.tests.join(', ')} in ${a.workspace}`, async (log) => {
            const r = await require('./testrun').run(a.workspace, { tests: a.tests, target: a.target || 'local', sourceEnv: a.env, db, fixturePath: a.fixture_path, fixtureRuntime: a.fixture_runtime, fixtureBindings: a.fixture_bindings, fixtureTemplate: a.fixture_template, allowIncomplete: a.allow_incomplete, log, mode: a.mode || 'auto', files: a.files || [], check: a.check, fix: a.fix,coverage:a.coverage,coverageBase:a.coverage_base });
            const view = R().saveView('tests', r, { title: `${r.outcome}: ${a.tests.join(', ')}` });
            const failing = r.cases.filter(c => c.status === 'failed' || c.status === 'error');
            return {
              workspace: r.workspace, execution: r.execution,...(r.coverage?{coverage:r.coverage}:{}), outcome: r.outcome, counts: r.counts, failureKinds: r.failureKinds, ms: r.ms, mode: r.mode, ...(r.buildBecause ? { buildBecause: r.buildBecause } : {}), ...(r.fast ? { compiler:r.fast.compiler, compiled: r.fast.compiled, prepared: r.fast.prepared || undefined } : {}), written: r.written, command: r.command, ...(r.gradleProperties ? { gradleProperties: r.gradleProperties } : {}),
              // compact for the model: the message's first lines, expected/actual, the repo's frames; the view has the rest
              failures: failing.slice(0, 10).map(c => {
                const O = require('./testout');
                const cut = (v) => (v == null ? undefined : String(v).length > 300 ? `${String(v).slice(0, 300)}…` : String(v));
                return {
                  test: `${c.class.split('.').pop()}#${c.name}`, status: c.status, failureKind: c.failureKind,
                  message: c.expected != null ? undefined : O.compactMessage(c.message || c.type),
                  expected: cut(c.expected), actual: cut(c.actual),
                  ...(c.expected == null && c.message ? {} : { type: c.type ? c.type.split('.').pop() : undefined }),
                  stack: c.stackShort ? O.framesOnly(c.stackShort).split('\n').slice(0, 12).join('\n') || undefined : undefined,
                };
              }),
              ...(failing.length > 10 ? { moreFailures: failing.length - 10 } : {}),
              compile: r.compile.length ? r.compile.slice(0, 10) : undefined,
              // the compile check of what was written: fixed in the files already, and ready edits for the rest
              ...(r.check?.fixed ? { fixed: r.check.fixed } : {}), ...(r.check?.suggestions || r.suggestions ? { suggestions: [...(r.check?.suggestions || []), ...(r.suggestions || [])].slice(0, 8) } : {}), ...(r.check?.pending || r.check?.skipped ? { check: r.check.pending || r.check.skipped } : {}),
              parts: r.parts.slice(0, 4).map(p => ({ file: p.file, line: p.line, why: p.why, code: p.snippet?.text.split('\n').filter((l, i, a) => Math.abs(i - a.findIndex(x => x.startsWith('>'))) <= 3).join('\n') })),
              ...(r.parts.length > 4 ? { moreParts: r.parts.length - 4 } : {}),
              database: r.database || undefined, hints: r.hints.length ? r.hints : undefined,
              fixture: r.fixture,
              // the build log only when it is the answer: no test results, or the build itself failed
              tail: r.outcome === 'passed' || (r.cases.length && !r.compile.length) ? undefined : r.tail,
              view,
              next: r.outcome === 'passed' ? (r.mode === 'fast' ? 'before the patch: test_run mode="build" once (the project\'s own build), then workspace_patch' : 'workspace_patch to take the changes') : (r.mode === 'check' ? 'not run: fix the compile errors first (suggestions has ready edits)' : 'fix the test or the code at parts (test_run files=[{path, edits}] writes and runs in one call)'),
            };
          });
        }
        return waitJob(job, cfg.waitMs, 'test_run');
      },
    },
  ];
};
