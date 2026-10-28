// Tools over code: the code index (trigram grep, symbols), impact radius, DDL snapshots, workspaces,
// generated tests and their runs, patches. Part of the registry in tools.js.
module.exports = ({ tabular, str, int, env, clip }) => {
  const bool = (description, def = false) => ({ type: 'boolean', default: def, description });
  const list = (description) => ({ type: 'array', items: { type: 'string' }, description });
  const repos = { description: 'Which indexes: PROJECT/repo, a repo name, globs ("SHOP/*"), a workspace id, comma separated. Empty: all fetched repos.', type: 'string' };
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
      name: 'code_index',
      group: 'code',
      description: 'Fetch a repo (branch, tag or sha; or a service via its passport repo) and build its code index: a trigram index for code_search over every text file, and a symbol graph (classes, methods, fields, calls, Spring roles, tables, SQL, Kafka topics, endpoints, Feign calls) for impact and test_context. Passports and workspaces index their checkout automatically. Without arguments: lists the indexes.',
      input: { service: str('Service (resolved like passport)'), project: str('Project key'), repo: str('Repo slug'), ref: str('Branch, tag or sha (default branch if empty)') },
      limit: (a) => (a.service || a.repo ? 'bitbucket' : null),
      run: async (a) => {
        const CI = require('./codeindex');
        if (!a.service && !a.repo) return tabular('code-indexes', CI.list().map(i => ({ key: i.key, ref: i.ref || '', sha: (i.sha || '').slice(0, 12), files: i.files, classes: i.classes, edges: i.edges, trigrams: i.trigrams, builtAt: i.builtAt, ms: i.ms })), { query: 'code indexes' }, { preview: 30 });
        let { project, repo } = a;
        if (a.service && !(project && repo)) ({ project, repo } = await require('./passport').resolveRepo(a.service));
        const info = await require('./git').fetchRef(project, repo, a.ref);
        const r = CI.build(info.path, `${info.project}/${repo}`, { project: info.project, repo, ref: info.ref, sha: info.sha, service: a.service || null });
        const { root, ...rest } = r;
        return rest;
      },
    },
    {
      name: 'code_search',
      group: 'code',
      description: 'Grep the indexed repos and workspaces (trigram index: fast over all of them at once). Text or a JavaScript regex; filter by path glob ("*.java", "src/main/**", "*.yml,*.sql"). Returns file:line hits with the line (and context lines when asked); the full list is a view.' + ' Use impact for "what uses X", this for anything textual (config keys, SQL, log messages, names in yml/xml).',
      input: { pattern: str('Text, or a regex when regex=true'), regex: bool('pattern is a regex'), repos, glob: str('Path glob(s), comma separated'), ignore_case: bool('Ignore case', true), context: int('Lines around each hit', 0), tests: bool('Include test sources', true), limit: int('Max hits', 100) },
      required: ['pattern'],
      run: (a) => {
        const CI = require('./codeindex');
        const keys = keysOf(a.repos);
        if (!keys.length) return { hits: [], note: a.repos ? `no index matches "${a.repos}" (code_index lists them)` : 'nothing indexed yet: code_index, passport or workspace_open fetch and index repos' };
        const r = CI.grep(keys, a.pattern, { regex: a.regex, ignoreCase: a.ignore_case !== false, glob: a.glob, context: Math.min(a.context || 0, 10), limit: Math.min(a.limit || 100, 2000), tests: a.tests !== false });
        const t = tabular('code-search', r.hits.map(h => ({ repo: h.repo, file: `${h.path}:${h.line}`, text: h.text, ...(h.context ? { context: h.context } : {}) })), { query: `${a.regex ? '/' + a.pattern + '/' : a.pattern}${a.glob ? ` in ${a.glob}` : ''}` }, { preview: 30 });
        return { ...t, files: r.files, repos: keys.length, scanned: r.scanned, candidates: r.candidates, truncated: r.truncated || undefined, ms: r.ms, prefilter: r.plan };
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
          const g = CI.load(key)?.graph_();
          for (const c of g?.classes || []) {
            const hit = (s) => words.every(w => s.toLowerCase().includes(w));
            if ((!a.kind || a.kind === 'class') && hit(c.id)) rows.push({ id: c.id, kind: c.kind, role: c.role || '', repo: key, file: `${c.file}:${c.line}`, signature: `${c.annos.map(x => '@' + x).join(' ')} ${c.kind} ${c.name}`.trim() });
            if (!a.kind || a.kind === 'method') for (const m of c.methods) if (hit(`${c.id}#${m.name}`)) rows.push({ id: `${c.id}#${m.name}`, kind: m.ctor ? 'constructor' : 'method', role: c.role || '', repo: key, file: `${c.file}:${m.line}`, signature: `${m.ret ? m.ret + ' ' : ''}${m.name}(${m.params.map(p => `${p.type} ${p.name}`).join(', ')})` });
            if (!a.kind || a.kind === 'field') for (const f of c.fields) if (hit(`${c.id}.${f.name}`)) rows.push({ id: `${c.id}.${f.name}`, kind: 'field', role: c.role || '', repo: key, file: `${c.file}:${f.line}`, signature: `${f.type} ${f.name}${f.column ? ` -> column ${f.column}` : ''}${f.inject ? ' (injected)' : ''}` });
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
      description: 'Impact radius: what is affected when something changes, walking "who uses it" back through the code graphs of all indexed repos and workspaces, the Postgres usage index of env, and service passports. Target: a class or method ("PaymentService#create", FQN, file.java:42), a table ("pay.payments"), a column ("pay.payments.fee": entity fields, SQL naming it, function bodies, views, indexes/constraints), a database function, a Kafka topic ("topic:payments.created"), an ES index ("es:orders"), an endpoint ("POST /payments/{id}/settle": handlers and Feign callers in other services). Returns layers by distance with file:line and why, the endpoints/topics/tables/services reached, the tests that exercise it (run those), and text mentions in config/SQL files. Shown as a view.',
      input: { target: str('What changes'), env, repos, depth: int('Steps back to walk', 4), limit: int('Max items', 300) },
      required: ['target'],
      run: (a) => {
        keysOf(a.repos);
        const r = require('./impact').impact(a.target, { env: a.env, repos: a.repos, depth: Math.min(a.depth || 4, 8), limit: Math.min(a.limit || 300, 2000) });
        if (!r.resolved?.length) return r;
        const view = R().saveView('impact', r, { title: `impact of ${a.target}` });
        const near = r.items.filter(i => i.depth <= 2).slice(0, 25).map(i => `${i.depth} ${i.kind} ${i.name}${i.file ? ` (${i.file}:${i.line})` : ''} <- ${i.via}`);
        return { target: r.target, resolved: r.resolved, counts: r.counts, endpoints: r.endpoints, topics: r.topics, tables: r.tables, functions: r.functions, services: r.services, tests: r.tests, db: r.db, nearest: near, mentions: (r.mentions || []).slice(0, 10).map(m => `${m.repo} ${m.path}:${m.line} ${m.text}`), truncated: r.truncated, view };
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
      description: 'Check out a repo at master/main, a branch, tag or commit (or what is deployed in env) into a new writable workspace, indexed for code_search, impact and test_context. Write tests and fixes there with workspace_write, run them with test_run, take the result with workspace_patch. Nothing is committed or pushed.',
      input: { service: str('Service (resolved like passport)'), project: str('Project key'), repo: str('Repo slug'), ref: str('Branch, tag or sha (default branch if empty)'), env: str('Check out the commit deployed in this env (with service)') },
      limit: () => 'bitbucket',
      run: async (a) => require('./workspace').open({ service: a.service, project: a.project, repo: a.repo, ref: a.ref, env: a.env }),
    },
    {
      name: 'workspace_list',
      group: 'code',
      description: 'Open workspaces: id, repo, ref, commit.',
      input: {},
      run: () => require('./workspace').list(),
    },
    {
      name: 'workspace_read',
      group: 'code',
      description: 'Read a file of a workspace with line numbers (or list a folder).',
      input: { workspace: str('Workspace id'), path: str('File or folder path'), from: int('First line', 1), to: int('Last line') },
      required: ['workspace', 'path'],
      run: (a) => require('./workspace').read(a.workspace, a.path, { from: a.from || 1, to: a.to }),
    },
    {
      name: 'workspace_write',
      group: 'code',
      description: 'Write a file in a workspace: the whole content (new test files), or edits [{find, replace}] where each find matches exactly once (fixes in existing code). The change shows up in workspace_patch.',
      input: { workspace: str('Workspace id'), path: str('File path'), content: str('Whole file content'), edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'] }, description: 'Replacements, applied in order' } },
      required: ['workspace', 'path'],
      run: (a) => require('./workspace').write(a.workspace, a.path, { content: a.content, edits: a.edits }),
    },
    {
      name: 'workspace_patch',
      group: 'code',
      description: 'The changes of a workspace as one git patch against the commit it was opened at (new tests, DDL snapshot, fixes): files with +/- counts, the patch shown to the user as a diff with a download link, and how to apply it (git apply). Nothing is pushed.',
      input: { workspace: str('Workspace id') },
      required: ['workspace'],
      run: async (a) => {
        const p = await require('./workspace').patch(a.workspace);
        if (!p.files.length) return { ...p, patch: '', note: 'no changes yet' };
        const view = R().saveView('patch', p, { title: `${p.repo} @ ${p.base.slice(0, 10)}: ${p.files.length} files` });
        return { workspace: p.id, repo: p.repo, base: p.base, files: p.files, apply: p.apply, view, download: `${view.replace('/show/', '/patch/')}.patch`, patch: clip(p.patch, 6000) };
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
      description: 'Everything needed to write an isolated test for a class or method of a workspace ("PaymentService", "PaymentService#settle", a file path): its source, Spring role and the test style that fits (unit, Mockito with @Mock/@InjectMocks, @WebMvcTest + MockMvc, @DataJpaTest / @JdbcTest against the real schema), its dependencies and their methods, what each method calls on them (what to stub), endpoints, tables and functions it touches, the project test setup (JUnit, Mockito, AssertJ, Spring Boot version: @MockBean or @MockitoBean, Testcontainers), an existing test to copy the style from, rules, and a skeleton test that compiles. With env, writes the DDL snapshot of the tables it touches into the test resources and suggests insert statements (parents first).',
      input: { workspace: str('Workspace id'), target: str('Class, Class#method or file path'), env: { ...env, description: 'Environment whose synced database gives the DDL snapshot (for repository/DAO tests)' }, db: str('Database (default: the one that has the tables)') },
      required: ['workspace', 'target'],
      run: (a) => require('./testgen').context(a.workspace, a.target, { env: a.env, db: a.db }),
    },
    {
      name: 'test_run',
      group: 'code',
      description: 'Run tests of a workspace with its own build (Maven or Gradle, the wrapper when there is one): each test, its status and time, failures with message and the code parts to work on (the repo frames of the stack trace with the lines around them), compile errors with their lines, and the output tail. With env + db (or ddl_path), the run gets a throwaway Postgres database loaded with the DDL snapshot, passed to Spring as SPRING_DATASOURCE_*. Shown as a view. Takes a while: if it answers "running", call it again with that job id.',
      input: {
        workspace: str('Workspace id'), tests: list('Test classes (FooTest) or Class#method'),
        env: str('With db: the environment of the DDL snapshot'), db: str('Database to snapshot into the throwaway test database'),
        ddl_path: str('Or: a DDL file in the workspace to load (e.g. src/test/resources/dt-schema/pay.sql)'),
        job: str('A job id from an earlier "running" answer'),
      },
      required: ['workspace'],
      run: async (a) => {
        const J = require('./jobs');
        const cfg = require('./config').getTests();
        let job = a.job ? J.find(a.job) : null;
        if (a.job && !job) throw new Error(`no job ${a.job}`);
        if (!job) {
          if (!a.tests?.length) throw new Error('tests: which test classes to run');
          const db = a.ddl_path || a.db ? { env: a.env || require('./config').envNames()[0], db: a.db, ddlPath: a.ddl_path } : null;
          job = J.start(`tests:${a.workspace}:${a.tests.join(',')}`, `tests ${a.tests.join(', ')} in ${a.workspace}`, async (log) => {
            const r = await require('./testrun').run(a.workspace, { tests: a.tests, db, log });
            const view = R().saveView('tests', r, { title: `${r.outcome}: ${a.tests.join(', ')}` });
            const failing = r.cases.filter(c => c.status === 'failed' || c.status === 'error');
            return {
              workspace: r.workspace, outcome: r.outcome, counts: r.counts, ms: r.ms, command: r.command,
              failures: failing.slice(0, 10).map(c => ({ test: `${c.class.split('.').pop()}#${c.name}`, status: c.status, message: (c.message || c.type || '').slice(0, 500), at: (c.parts || []).map(p => `${p.file}:${p.line}`) })),
              compile: r.compile.slice(0, 10),
              parts: r.parts.slice(0, 8).map(p => ({ file: p.file, line: p.line, why: p.why, code: p.snippet?.text })),
              database: r.database, hints: r.hints.length ? r.hints : undefined,
              tail: r.outcome === 'passed' ? undefined : clip(r.tail.split('\n').slice(-25).join('\n'), 3000),
              view,
              next: r.outcome === 'passed' ? 'workspace_patch to take the changes' : 'fix the test or the code at parts (workspace_write edits), then test_run again',
            };
          });
        }
        return waitJob(job, cfg.waitMs, 'test_run');
      },
    },
  ];
};
