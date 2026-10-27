// One tool registry for MCP (/mcp), OpenAPI (/openapi.json, used by Open WebUI), the HTTP API
// (/api/tool/<name>) and the CLI. Results are kept small on purpose: the model's context is the
// scarce resource. Table-shaped results are stored in full and get a `view` link; in Open WebUI
// that view is embedded in the chat.
//
// Each live tool names a rate-limit key (`limit`): one request per second per key by default.
const fs = require('fs');
const path = require('path');
const { envNames, ROOT } = require('./config');
const { CACHE, readJson, safeName } = require('./util');
const limit = require('./limit');

const env = { type: 'string', enum: envNames(), default: envNames()[0], description: 'Environment' };
const str = (description) => ({ type: 'string', description });
const int = (description, def) => ({ type: 'integer', description, default: def });

const PREVIEW = 10;

// Store the full rows for the viewer and return the preview the model sees.
function tabular(kind, rows, meta, { preview = PREVIEW, summary } = {}) {
  let view;
  try { view = require('./results').save(kind, rows, meta); } catch {}
  return { ...(summary ? { summary } : {}), total: rows.length, rows: rows.slice(0, preview), view };
}

const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `\n... [${s.length - n} more chars]` : s);

const VIEW_NOTE = ' Returns a preview plus `view`, a link to the full result as an interactive table (shown to the user inline). Mention the link.';

const TOOLS = [
  {
    name: 'find',
    description: 'ALWAYS START HERE. Search the cached catalog: Postgres tables/columns and functions with their arguments (each line also says who uses it: services, functions, triggers, views), Elasticsearch indices/fields, Kafka topics/fields, Consul services, and service passports. All words must match; prefix a word with a kind to filter: "pg:", "pgfn:", "es:", "kafka:", "consul:", "svc:". "pg: order-service" lists the tables that service touches. Use the exact names you find here in queries. If the catalog is empty or stale, call catalog_sync.',
    input: { q: str('Words to search, e.g. "order_id" or "kafka: payment" or "svc: order_created"'), env, limit: int('Max lines', 50) },
    required: ['q'],
    run: (a) => {
      const cat = require('./catalog');
      if (!cat.status(a.env).catalog) return [`(catalog for ${a.env} is empty: call catalog_sync with env="${a.env}" first)`];
      const lines = cat.find(a.env, a.q, { limit: Math.min(a.limit || 50, 300) });
      return lines.length ? lines : [`(no match for "${a.q}" in ${a.env}: try fewer or shorter words, a kind prefix, or catalog_sync if it should exist)`];
    },
  },
  {
    name: 'catalog_sync',
    group: 'catalog',
    description: 'Refresh the cached catalog of an environment from the live systems: Postgres schemas, functions, views, triggers (all databases), ES mappings, Kafka topics + schemas + last messages, Consul services; then the usage index. "passports" rebuilds the cached service passports, "index" only rebuilds catalog + usage from the cache. Takes seconds to minutes; run when find says the catalog is empty or something is missing.',
    input: { env, what: { type: 'string', enum: require('./indexer').WHAT, default: 'all' }, only: str('Comma list to limit: db names for pg, name parts for es/kafka, services for passports') },
    run: async (a) => {
      const job = require('./indexer').refresh({ env: a.env, what: a.what, only: a.only });
      const done = await job.promise;
      return { job: done.id, state: done.state, ms: done.ms, ...(done.error ? { error: done.error } : done.result) };
    },
  },
  {
    name: 'pg_table',
    group: 'pg',
    description: 'Full cached definition of a Postgres table or view: columns with types/defaults/comments, constraints (PK/FK), indexes, triggers, view definition, plus who uses it: services (from passports, with file:line), functions/procedures that read or write it, triggers, views, foreign keys. Name as schema.table (or db:schema.table when several databases have it).',
    input: { name: str('schema.table'), env },
    required: ['name'],
    run: (a) => {
      const found = require('./pgindex').describe(a.env, a.name).filter(o => !['function', 'procedure', 'aggregate', 'window'].includes(o.kind));
      if (!found.length) throw new Error(`${a.name} not in the ${a.env} catalog; use find (or catalog_sync if it is new)`);
      return found.map(o => ({ ...o, usedBy: o.usedBy.slice(0, 60), usedByTotal: o.usedBy.length, uses: o.uses.slice(0, 40), note: require('./notes').get(o.object, o.db) }));
    },
  },
  {
    name: 'pg_function',
    group: 'pg',
    description: 'Cached Postgres function or procedure: arguments (name, type, mode, defaults), result, language, volatility, body (clipped), what it reads/writes/calls, and what touches it: services calling it (file:line), other functions, triggers executing it, views. Name as schema.fn or fn.',
    input: { name: str('schema.function'), env, body: { type: 'boolean', default: true, description: 'Include the body' } },
    required: ['name'],
    run: (a) => {
      const found = require('./pgindex').describe(a.env, a.name).filter(o => ['function', 'procedure', 'aggregate', 'window'].includes(o.kind) || o.kind === 'unknown');
      if (!found.length) throw new Error(`${a.name} not in the ${a.env} catalog; use find with "pgfn:"`);
      return found.map(({ body, ...o }) => ({ ...o, ...(a.body !== false ? { body: clip(body, 8000) } : {}), usedBy: o.usedBy.slice(0, 60), usedByTotal: o.usedBy.length, uses: o.uses.slice(0, 60), note: require('./notes').get(o.object, o.db) }));
    },
  },
  {
    name: 'pg_usage',
    group: 'pg',
    description: 'What uses a Postgres table/view/function, or what an object/service uses, across database objects AND code: services (passports: reads, writes, entity, repository, migration owner, SQL calls, with file:line), functions/procedures (bodies), triggers, views, foreign keys. direction=used_by (default) answers "who touches X"; direction=uses answers "what does X touch" (X can be a function, view or service name).' + VIEW_NOTE,
    input: { name: str('schema.table, schema.function, plain name, db:schema.name, or a service (direction=uses)'), env, direction: { type: 'string', enum: ['used_by', 'uses'], default: 'used_by' } },
    required: ['name'],
    run: (a) => {
      const idx = require('./pgindex');
      const edges = a.direction === 'uses' ? idx.uses(a.env, a.name) : idx.usages(a.env, a.name);
      const rows = edges.map(e => ({ user: e.user, user_kind: e.userKind, role: e.role, where: e.where, detail: e.detail, object: e.target, kind: e.targetKind, db: e.db, source: e.source, ...(e.ambiguous ? { ambiguous: true } : {}), ...(e.known === false ? { not_in_db: true } : {}) }));
      if (!rows.length) return { total: 0, hint: `nothing ${a.direction === 'uses' ? 'used by' : 'uses'} "${a.name}" in the ${a.env} index. Check the name with find; code usages need a passport of the service (passport tool).` };
      const by = {};
      for (const r of rows) by[`${r.user_kind}:${r.role}`] = (by[`${r.user_kind}:${r.role}`] || 0) + 1;
      return tabular('pg-usage', rows, { env: a.env, query: `${a.direction === 'uses' ? 'used by' : 'users of'} ${a.name}` }, { preview: 25, summary: by });
    },
  },
  {
    name: 'pg_query',
    description: 'Run read-only SQL. The database is chosen from the schema in the query (or pass db). Always use WHERE and LIMIT.' + VIEW_NOTE,
    input: { sql: str('SQL'), env, db: str('Database name from envs.json (optional)'), limit: int('Rows in the preview', PREVIEW) },
    required: ['sql'],
    limit: (a) => `pg:${a.env}`,
    run: async (a) => {
      const known = require('./catalog').status(a.env).schemas;
      if (known && !a.db) {
        const used = [...a.sql.matchAll(/\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?[a-z_]/gi)].map(m => m[1].toLowerCase());
        const missing = [...new Set(used)].filter(x => !known[x] && !['pg_catalog', 'information_schema'].includes(x));
        if (missing.length) throw new Error(`schema ${missing.join(', ')} is not in the ${a.env} catalog. Use find to get the exact schema.table (or catalog_sync if it is new).`);
      }
      const r = await require('./pg').query(a.env, a.sql, { db: a.db });
      return { db: r.db, route: r.route, ms: r.ms, ...tabular('pg', r.rows, { env: a.env, db: r.db, query: a.sql, ms: r.ms }, { preview: Math.min(a.limit || PREVIEW, 200) }) };
    },
  },
  {
    name: 'es_search',
    description: 'Search an Elasticsearch index. Query is "field==value && other~text" (== term, ~ match) or raw JSON DSL.' + VIEW_NOTE,
    input: { index: str('Index or alias'), query: str('Query'), env, size: int('Hits', 20) },
    required: ['index'],
    limit: (a) => `es:${a.env}`,
    run: async (a) => {
      const r = await require('./es').search(a.env, a.index, a.query || '', { size: Math.min(a.size || 20, 1000) });
      return { totalHits: r.total, ms: r.ms, ...tabular('es', r.hits, { env: a.env, index: a.index, query: a.query || '', ms: r.ms, totalHits: r.total }) };
    },
  },
  {
    name: 'kafka_topic',
    description: 'Cached info about a Kafka topic: message count, schema, field paths, and one sample message.',
    input: { topic: str('Topic name'), env },
    required: ['topic'],
    run: (a) => {
      const t = readJson(path.join(CACHE, a.env, 'kafka', `${safeName(a.topic)}.json`));
      if (!t) throw new Error(`${a.topic} not in cache; try find with "kafka:"`);
      return { ...t, samples: t.samples.slice(0, 1) };
    },
  },
  {
    name: 'kafka_last',
    description: 'Live: the last n messages of a Kafka topic (newest first).' + VIEW_NOTE,
    input: { topic: str('Topic name'), env, n: int('Messages', 5) },
    required: ['topic'],
    limit: (a) => `kafka:${a.env}`,
    run: async (a) => {
      const msgs = await require('./kafka').lastMessages(a.env, a.topic, Math.min(a.n || 5, 200));
      return tabular('kafka', msgs, { env: a.env, topic: a.topic, query: `last ${msgs.length} messages` }, { preview: 3 });
    },
  },
  {
    name: 'health',
    description: 'Live health of ALL services in an environment from Consul in one request: healthy / degraded / down per service, failing check output. Use this for "are services healthy?" instead of checking services one by one.' + VIEW_NOTE,
    input: { env, only_unhealthy: { type: 'boolean', default: false, description: 'Preview only services that are not healthy' } },
    limit: (a) => `consul:${a.env}`,
    run: async (a) => {
      const h = await require('./monitor').health(a.env);
      const rows = a.only_unhealthy ? h.rows.filter(r => r.status !== 'healthy') : h.rows;
      return tabular('health', rows, { env: a.env, query: 'Consul health of all services', summary: h.summary, links: { service: 'link' } }, { summary: h.summary, preview: 15 });
    },
  },
  {
    name: 'es_health',
    description: 'Live Elasticsearch cluster health plus every index that is not green.' + VIEW_NOTE,
    input: { env },
    limit: (a) => `es:${a.env}`,
    run: async (a) => {
      const h = await require('./monitor').esHealth(a.env);
      return tabular('es-health', h.rows, { env: a.env, query: 'ES cluster health, non-green indices', summary: h.summary }, { summary: h.summary });
    },
  },
  {
    name: 'kafka_lag',
    description: 'Live Kafka consumer groups ordered by lag (messages behind), with state and members, in one request.' + VIEW_NOTE,
    input: { env, top: int('Groups to fetch', 100) },
    limit: (a) => `kafka:${a.env}`,
    run: async (a) => {
      const h = await require('./monitor').kafkaLag(a.env, { top: Math.min(a.top || 100, 500) });
      return tabular('kafka-lag', h.rows, { env: a.env, query: 'Kafka consumer groups by lag', summary: h.summary, links: { group: 'link' } }, { summary: h.summary });
    },
  },
  {
    name: 'overview',
    description: 'Live dashboard of an environment: service health (Consul), Elasticsearch health and Kafka consumer lag together. Shown to the user as a live dashboard; returns the summary. Use for "how is dev doing?" or "is anything broken?".',
    input: { env },
    run: async (a) => {
      const { overview } = require('./dashboard');
      const o = await overview(a.env);
      const r = require('./results');
      return { ...o, dashboard: `${r.publicUrl()}/dash?env=${encodeURIComponent(a.env)}&t=${r.sign(`dash:${a.env}`)}` };
    },
  },
  {
    name: 'consul_service',
    description: 'Live: instances of ONE service registered in Consul with health and /version. Fuzzy name match. For all services use health.',
    input: { name: str('Service name or part of it'), env },
    required: ['name'],
    limit: (a) => `consul:${a.env}`,
    run: (a) => require('./consul').service(a.env, a.name),
  },
  {
    name: 'bitbucket_repos',
    description: 'List Bitbucket repositories, optionally filtered by name.',
    input: { filter: str('Part of repo name') },
    limit: () => 'bitbucket',
    run: async (a) => {
      const repos = await require('./atlassian').repos(a.filter);
      return tabular('bitbucket', repos, { query: `repos ${a.filter || ''}`.trim() }, { preview: 30 });
    },
  },
  {
    name: 'bitbucket_files',
    description: 'List file paths in a Bitbucket repo (default branch unless `at`). Filter by substring, e.g. "application" or ".yml".',
    input: { project: str('Project key'), repo: str('Repo slug'), filter: str('Substring of path'), at: str('Branch/tag/commit') },
    required: ['project', 'repo'],
    limit: () => 'bitbucket',
    run: async (a) => {
      const all = await require('./atlassian').files(a.project, a.repo, { at: a.at });
      const hit = a.filter ? all.filter(f => f.toLowerCase().includes(a.filter.toLowerCase())) : all;
      return { total: hit.length, files: hit.slice(0, 500) };
    },
  },
  {
    name: 'bitbucket_file',
    description: 'Raw content of a file in a Bitbucket repo.',
    input: { project: str('Project key'), repo: str('Repo slug'), path: str('File path'), at: str('Branch/tag/commit') },
    required: ['project', 'repo', 'path'],
    limit: () => 'bitbucket',
    run: async (a) => clip(await require('./atlassian').file(a.project, a.repo, a.path, { at: a.at }), 60000),
  },
  {
    name: 'bitbucket_prs',
    description: 'Pull requests of a Bitbucket repo.',
    input: { project: str('Project key'), repo: str('Repo slug'), state: { type: 'string', enum: ['OPEN', 'MERGED', 'DECLINED', 'ALL'], default: 'OPEN' } },
    required: ['project', 'repo'],
    limit: () => 'bitbucket',
    run: (a) => require('./atlassian').prs(a.project, a.repo, { state: a.state }),
  },
  {
    name: 'confluence_search',
    description: 'Full-text search of Confluence pages.',
    input: { text: str('Search text'), space: str('Space key (optional)') },
    required: ['text'],
    limit: () => 'confluence',
    run: (a) => require('./atlassian').confluenceSearch(a.text, { space: a.space }),
  },
  {
    name: 'confluence_page',
    description: 'A Confluence page as plain text.',
    input: { id: str('Page id from confluence_search') },
    required: ['id'],
    limit: () => 'confluence',
    run: async (a) => {
      const p = await require('./atlassian').confluencePage(a.id);
      return { ...p, text: clip(p.text, 60000) };
    },
  },
  {
    name: 'logs_search',
    description: 'Search application logs (ELK) of an environment: free text / Lucene query, optionally by service and level, over a time window. Shown to the user as a log explorer (timeline by level, facets, log lines); returns counts, top services/levels and a preview. Use for errors, exceptions, request ids.',
    input: {
      env, query: str('Lucene/text query, e.g. "NullPointerException" or "order_id:123" (optional)'),
      service: str('Service name (optional)'), level: str('Level, e.g. ERROR or WARN (optional)'),
      from: str('Window: 15m, 2h, 1d, or ISO time'), to: str('End: now (default) or ISO time'), size: int('Log lines to fetch', 200),
    },
    limit: (a) => `logs:${a.env}`,
    run: async (a) => {
      const r = await require('./logs').search(a.env, { query: a.query, service: a.service, level: a.level, from: a.from || '15m', to: a.to || 'now', size: a.size });
      const { rows, ...meta } = r;
      const view = require('./results').save('logs', rows, { env: a.env, query: [a.query, a.service && `service:${a.service}`, a.level && `level:${a.level}`].filter(Boolean).join(' ') || '*', ...meta, matched: r.total });
      return { total: r.total, range: r.range, levels: r.levels, services: r.services.slice(0, 10), kibana: r.kibana, preview: rows.slice(0, 8).map(({ source, ...x }) => x), view };
    },
  },
  {
    name: 'logs_trace',
    description: 'Follow one trace/correlation id through all services in the logs, in time order. Shown as a timeline per service. Use to debug a request across services.',
    input: { env, trace: str('Trace / correlation id'), from: str('How far back to look: 24h default') },
    required: ['trace'],
    limit: (a) => `logs:${a.env}`,
    run: async (a) => {
      const r = await require('./logs').trace(a.env, a.trace, { from: a.from || '24h' });
      const { rows, ...meta } = r;
      const view = require('./results').save('trace', rows, { env: a.env, query: `trace ${a.trace}`, ...meta, matched: r.total });
      return { total: r.total, hops: r.hops, preview: rows.slice(0, 10).map(({ source, ...x }) => x), view };
    },
  },
  {
    name: 'bitbucket_pr',
    description: 'One pull request for review: title, branches, reviewers, changed files with +/- counts, comments, and the unified diff (clipped). Shown to the user as a diff view.',
    input: { project: str('Project key'), repo: str('Repo slug'), id: int('Pull request id') },
    required: ['project', 'repo', 'id'],
    limit: () => 'bitbucket',
    run: async (a) => {
      const pr = await require('./atlassian').prDetails(a.project, a.repo, a.id);
      const view = require('./results').save('pr', pr.files, { query: `${a.project}/${a.repo}#${a.id} ${pr.title}`, pr });
      return { ...pr, diff: clip(pr.diff, 40000), view };
    },
  },
  {
    name: 'bitbucket_my_prs',
    description: 'Pull requests across all repos where you are REVIEWER, AUTHOR or PARTICIPANT.',
    input: { role: { type: 'string', enum: ['REVIEWER', 'AUTHOR', 'PARTICIPANT'], default: 'REVIEWER' }, state: { type: 'string', enum: ['OPEN', 'MERGED', 'DECLINED', 'ALL'], default: 'OPEN' } },
    limit: () => 'bitbucket',
    run: async (a) => tabular('bitbucket', await require('./atlassian').myPrs({ role: a.role, state: a.state }), { query: `PRs as ${a.role} (${a.state})`, links: { title: 'link' } }, { preview: 30 }),
  },
  {
    name: 'repo_fetch',
    description: 'Shallow-fetch a repo at a branch, tag or commit into repos/<PROJECT>/<repo> (for reading code, review, graph). Optionally build its code-review-graph.',
    input: { project: str('Project key'), repo: str('Repo slug'), ref: str('Branch, tag or sha (default branch if empty)'), graph: { type: 'boolean', default: false, description: 'Also build the code graph' } },
    required: ['project', 'repo'],
    limit: () => 'bitbucket',
    run: async (a) => {
      const info = await require('./git').fetchRef(a.project, a.repo, a.ref);
      if (a.graph) info.graph = await require('./passport').graphBuild(info.path).catch(e => ({ error: e.message }));
      return { ...info, path: path.relative(ROOT, info.path) };
    },
  },
  {
    name: 'passport',
    description: 'Static passport of a service from its code: HTTP endpoints (incl. controllers from internal libraries), Feign/HTTP calls, Kafka topics consumed/produced, datasources and tables read/written/owned, ES indices, internal libraries (fetched at their versions) and external dependencies, each with file:line. Cached; refresh=true rebuilds and reports what changed. With env, analyzes the commit deployed there (from /version). Shown to the user as a passport page.',
    input: {
      service: str('Service name (Consul / spring.application.name / repo slug)'),
      env: str('Analyze the commit deployed in this env (optional)'), repo: str('PROJECT/slug if the name does not match the repo'),
      ref: str('Branch, tag or sha (optional)'), refresh: { type: 'boolean', default: false, description: 'Rebuild even if cached' },
      libraries: { type: 'boolean', default: true, description: 'Also fetch internal libraries' },
      graph: { type: 'boolean', default: false, description: 'Also build the code-review-graph of the repo' },
    },
    required: ['service'],
    run: async (a) => {
      const pp = require('./passport');
      let p = !a.refresh && !a.ref && !a.env ? pp.load(a.service) : null;
      const cached = !!p;
      if (!p) p = await pp.build(a.service, { repo: a.repo, ref: a.ref, env: a.env, libraries: a.libraries !== false, graph: !!a.graph });
      const r = require('./results');
      return {
        service: p.service, cached, builtAt: p.builtAt, repo: p.repo, deployed: p.deployed, app: p.app, summary: p.summary,
        changes: p.changes, graph: p.graph,
        view: `${r.publicUrl()}/passport/${encodeURIComponent(p.service)}?t=${r.sign(`passport:${p.service}`)}`,
      };
    },
  },
  {
    name: 'passports',
    description: 'All cached service passports: service, repo@sha, endpoint count, topics consumed/produced, tables, outbound calls.',
    input: {},
    run: () => tabular('passports', require('./passport').list().map(p => ({ ...p, consumes: p.consumes.join(', '), produces: p.produces.join(', '), tables: p.tables.join(', '), calls: p.calls.join(', ') })), { query: 'service passports' }, { preview: 40 }),
  },
  {
    name: 'who_uses',
    description: 'Across all passports and the Postgres usage index: which services consume/produce a Kafka topic, read/write a table, call a database function, expose or call an HTTP path, use an ES index or connect to a database; plus database objects (functions, triggers, views, FKs) using a matching table/function. Substring match. Use it to trace flows between services.',
    input: { name: str('Topic, table, function, path, service or index name (substring)'), env },
    required: ['name'],
    run: (a) => {
      const rows = require('./passport').whoUses(a.name);
      const q = String(a.name).toLowerCase();
      for (const e of require('./pgindex').load(a.env).edges) {
        if (e.userKind === 'service' && e.role !== 'calls') continue; // tables are already in the passport rows
        if (!e.target.includes(q)) continue;
        rows.push({ service: e.userKind === 'service' ? e.user : '', kind: e.targetKind, role: e.userKind === 'service' ? 'calls' : `${e.userKind} ${e.role}`, name: e.target, detail: e.userKind === 'service' ? e.detail : `${e.user}${e.detail ? ` ${e.detail}` : ''}`, where: e.where || (e.db ? `db ${e.db}` : ''), source: e.source || '' });
      }
      return tabular('who-uses', rows, { query: `who uses "${a.name}"` }, { preview: 30 });
    },
  },
  {
    name: 'browser_sites',
    description: 'Sites configured for the browser tools: name, URL, and the secret NAMES to type for login. To log in, pass the secret name (for example CRM_PASSWORD) as the text to type; the browser fills in the real value, and you never see it.',
    input: {},
    run: () => browserSites(),
  },
];

// Sites from config (browser.sites): name, URL and the secret NAMES the model types; values never leave config.
function browserSites() {
  const { sites } = require('./config').getBrowser();
  return sites.length ? { sites } : { sites: [], note: 'No browser sites configured (browser.sites in config.json)' };
}

// Tool groups, for tools.enable / tools.disable in config.json (or DT_TOOLS="all,-confluence").
const GROUP = {
  find: 'catalog', catalog_sync: 'catalog', pg_query: 'pg',
  es_search: 'es', es_health: 'es', kafka_topic: 'kafka', kafka_last: 'kafka', kafka_lag: 'kafka',
  health: 'consul', consul_service: 'consul', overview: 'consul',
  bitbucket_repos: 'bitbucket', bitbucket_files: 'bitbucket', bitbucket_file: 'bitbucket', bitbucket_prs: 'bitbucket', bitbucket_pr: 'bitbucket', bitbucket_my_prs: 'bitbucket', repo_fetch: 'bitbucket',
  confluence_search: 'confluence', confluence_page: 'confluence', logs_search: 'logs', logs_trace: 'logs',
  passport: 'passport', passports: 'passport', who_uses: 'passport', browser_sites: 'browser',
};
for (const t of TOOLS) { t.group = t.group || GROUP[t.name] || 'other'; t.origin = 'built-in'; }

const ctx = { tabular, clip, getEnv: (e) => require('./config').getEnv(e), pg: () => require('./pg'), http: require('./util').http, limit };

// ── tools from config (no code): tools.custom = [{ name, type: "sql" | "http", ... }] ──
const PARAM_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
function paramsSchema(params = {}) {
  const input = {}, required = [];
  for (const [k, p] of Object.entries(params)) {
    if (!/^\w+$/.test(k)) throw new Error(`bad parameter name "${k}"`);
    const type = p.type || 'string';
    if (!PARAM_TYPES.has(type)) throw new Error(`parameter ${k}: type must be one of ${[...PARAM_TYPES].join(', ')}`);
    input[k] = { type, description: p.description || k, ...(p.default !== undefined ? { default: p.default } : {}), ...(p.enum ? { enum: p.enum } : {}) };
    if (p.required) required.push(k);
  }
  return { input, required };
}

// ":name" -> $n for postgres.js (leaves "::type" casts alone)
function bindSql(sql, args) {
  const values = [], index = {};
  const text = sql.replace(/(?<!:):([a-zA-Z_]\w*)/g, (m, k) => {
    if (!(k in args)) throw new Error(`Missing argument: ${k}`);
    if (!(k in index)) { values.push(args[k]); index[k] = values.length; }
    return `$${index[k]}`;
  });
  return { text, values };
}

function declarative(def) {
  if (!def || !/^[a-z][a-z0-9_]{1,63}$/.test(def.name || '')) throw new Error(`custom tool needs a name like "orders_by_status" (got ${JSON.stringify(def && def.name)})`);
  if (!def.description) throw new Error(`${def.name}: description required (the model reads it)`);
  const { input, required } = paramsSchema(def.params);
  const base = { name: def.name, description: def.description, group: def.group || 'custom', origin: 'config', input, required };
  if (def.type === 'sql') {
    if (!def.sql) throw new Error(`${def.name}: sql required`);
    if (!def.env) input.env = env;
    return {
      ...base, description: def.description + VIEW_NOTE,
      limit: (a) => `pg:${def.env || a.env}`,
      run: async (a) => {
        const e = def.env || a.env;
        const { text, values } = bindSql(def.sql, a);
        const r = await require('./pg').query(e, text, { db: def.db, params: values });
        return { db: r.db, ms: r.ms, ...tabular('pg', r.rows, { env: e, db: r.db, query: `${def.name}: ${def.sql}`, ms: r.ms }, { preview: def.preview || PREVIEW }) };
      },
    };
  }
  if (def.type === 'http') {
    if (!/^https?:\/\//.test(def.url || '')) throw new Error(`${def.name}: url must start with http(s)://`);
    const method = (def.method || 'GET').toUpperCase();
    const host = new URL(def.url.replace(/\{\w+\}/g, 'x')).host;
    return {
      ...base, description: def.description + VIEW_NOTE,
      limit: () => `http:${host}`,
      run: async (a) => {
        const used = new Set();
        let url = def.url.replace(/\{(\w+)\}/g, (m, k) => { used.add(k); if (a[k] === undefined) throw new Error(`Missing argument: ${k}`); return encodeURIComponent(a[k]); });
        const rest = Object.fromEntries(Object.entries(a).filter(([k, v]) => !used.has(k) && v !== undefined && input[k]));
        if (method === 'GET' && Object.keys(rest).length) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(rest);
        const raw = await require('./util').http(url, { method, headers: def.headers || {}, body: method === 'GET' ? undefined : rest, timeout: def.timeoutMs || 30000, raw: true });
        let res = raw;
        try { res = JSON.parse(raw); } catch {} // plain text answers are returned as text
        const rows = def.rows ? String(def.rows).split('.').reduce((o, k) => (o == null ? o : o[k]), res) : res;
        if (Array.isArray(rows) && rows.every(r => r && typeof r === 'object')) return tabular('http', rows, { query: `${def.name} ${url.replace(/\?.*$/, '')}` }, { preview: def.preview || PREVIEW });
        return typeof res === 'string' ? clip(res, 60000) : res;
      },
    };
  }
  throw new Error(`${def.name}: type must be "sql" or "http"`);
}

// ── plugins: JS files exporting tools; local paths, files in plugins/, or remote URLs ──
// "plugins/x.js" | "/abs/x.js" | "https://host/x.js" | "github:owner/repo/path/x.js@ref" | { url, sha256 }
const crypto = require('crypto');
const { PATHS, HOME, CONFIG_FILE } = require('./config');
const REMOTE_DIR = path.join(CACHE, 'plugins');

function pluginSource(spec) {
  const s = typeof spec === 'string' ? { url: spec } : { ...spec };
  if (!s.url) throw new Error(`plugin entry needs a path or url: ${JSON.stringify(spec)}`);
  const gh = s.url.match(/^github:([\w.-]+)\/([\w.-]+)\/(.+?)(?:@([\w./-]+))?$/);
  if (gh) s.url = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[4] || 'main'}/${gh[3]}`;
  if (/^https?:\/\//.test(s.url)) {
    s.remote = true;
    s.file = path.join(REMOTE_DIR, crypto.createHash('sha1').update(s.url).digest('hex').slice(0, 16) + '.js');
  } else s.file = path.resolve(HOME, s.url);
  return s;
}

async function fetchRemote(specs, { force = false } = {}) {
  const out = [];
  for (const spec of specs) {
    let s;
    try { s = pluginSource(spec); } catch (e) { out.push({ spec, error: e.message }); continue; }
    if (!s.remote || (!force && fs.existsSync(s.file))) continue;
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const code = await res.text();
      const sha256 = crypto.createHash('sha256').update(code).digest('hex');
      if (s.sha256 && s.sha256 !== sha256) throw new Error(`sha256 mismatch: expected ${s.sha256}, got ${sha256}`);
      fs.mkdirSync(REMOTE_DIR, { recursive: true });
      fs.writeFileSync(s.file, code);
      fs.writeFileSync(s.file + '.json', JSON.stringify({ url: s.url, sha256, fetchedAt: new Date().toISOString() }, null, 2));
      out.push({ url: s.url, sha256 });
    } catch (e) { out.push({ url: s.url, error: e.message }); }
  }
  return out;
}

function loadPluginFile(file, label, taken) {
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  const out = [];
  for (const t of [].concat(mod.tools || mod)) {
    if (!t || !/^[a-z][a-z0-9_]{1,63}$/.test(t.name || '') || typeof t.run !== 'function') throw new Error('each tool needs a name like "my_tool" and run()');
    if (taken.has(t.name)) throw new Error(`tool ${t.name} already exists`);
    taken.add(t.name);
    out.push({ input: {}, group: 'plugin', ...t, origin: label, run: (a) => t.run(a, ctx) });
  }
  return out;
}

const pluginFiles = () => { try { return fs.readdirSync(PATHS.plugins).filter(f => f.endsWith('.js')).sort().map(f => path.join(PATHS.plugins, f)); } catch { return []; } };

function enabled({ enable = ['all'], disable = [] } = {}) {
  const on = new Set(enable), off = new Set(disable);
  return (t) => (on.has('all') || on.has(t.group) || on.has(t.name)) && !off.has(t.group) && !off.has(t.name);
}

// The registry is rebuilt when config.json or plugins/ change (checked on every use), or on reload().
let reg = null;
const signature = () => {
  const st = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const cfg = require('./config');
  return [st(CONFIG_FILE), st(cfg.SECRETS_FILE), st(cfg.ENVS_FILE), st(PATHS.plugins), ...pluginFiles().map(st)].join(':');
};

function build() {
  const cfg = require('./config');
  const t = cfg.getTools();
  const errors = [];
  const taken = new Set(TOOLS.map(x => x.name));
  const all = [...TOOLS];
  for (const def of t.custom) {
    try {
      if (taken.has(def.name)) throw new Error(`tool ${def.name} already exists`);
      all.push(declarative(def)); taken.add(def.name);
    } catch (e) { errors.push({ source: `custom ${def && def.name}`, error: e.message }); }
  }
  const files = [...pluginFiles().map(f => ({ file: f, label: `plugins/${path.basename(f)}` })), ...t.plugins.map(spec => {
    try { const s = pluginSource(spec); return { file: s.file, label: s.url, remote: s.remote }; } catch (e) { errors.push({ source: JSON.stringify(spec), error: e.message }); return null; }
  }).filter(Boolean)];
  for (const f of files) {
    if (!fs.existsSync(f.file)) { errors.push({ source: f.label, error: f.remote ? 'not downloaded yet (reload tools)' : 'file not found' }); continue; }
    try { all.push(...loadPluginFile(f.file, f.label, taken)); } catch (e) { errors.push({ source: f.label, error: e.message }); }
  }
  for (const e of errors) console.error(`tools: ${e.source}: ${e.error}`);
  const active = all.filter(enabled(t));
  reg = { sig: signature(), all, active, byName: Object.fromEntries(active.map(x => [x.name, x])), errors, builtAt: new Date().toISOString(), plugins: t.plugins };
  return reg;
}

// Make sure remote plugins are downloaded and the registry matches the config on disk.
async function ready() {
  if (reg && reg.sig === signature()) return reg;
  require('./config').reload();
  await fetchRemote(require('./config').getTools().plugins);
  try { require('./browser').writeSecrets(); } catch {}
  return build();
}

// Admin / API: re-read config, optionally re-download remote plugins.
async function reload({ update = false } = {}) {
  require('./config').reload();
  const fetched = await fetchRemote(require('./config').getTools().plugins, { force: update });
  try { require('./browser').writeSecrets(); } catch {}
  const r = build();
  return { tools: r.active.length, all: r.all.length, errors: r.errors, fetched };
}

// The env parameter follows the current config.
const liveEnv = () => ({ ...env, enum: envNames(), default: envNames()[0] });
const props = (input) => Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === env ? liveEnv() : v]));

async function schemas() {
  const r = await ready();
  return r.active.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: 'object', properties: props(t.input), required: t.required || [] },
  }));
}

async function call(name, args = {}) {
  const t = (await ready()).byName[name];
  if (!t) throw new Error(`Unknown tool ${name}`);
  const a = { ...args };
  for (const [k, s] of Object.entries(props(t.input))) if (a[k] === undefined && s.default !== undefined) a[k] = s.default;
  for (const k of t.required || []) if (a[k] === undefined || a[k] === '') throw new Error(`Missing argument: ${k}`);
  if (t.limit) await limit.take(t.limit(a));
  return t.run(a);
}

// For /admin: every tool with its group, origin and whether it is on, plus load errors.
async function groups() {
  const r = await ready();
  return {
    groups: [...new Set(r.all.map(t => t.group))].map(g => ({ group: g, tools: r.all.filter(t => t.group === g).map(t => ({ name: t.name, enabled: !!r.byName[t.name], origin: t.origin })) })),
    errors: r.errors, builtAt: r.builtAt,
    plugins: r.plugins.map(spec => {
      try { const s = pluginSource(spec); const meta = s.remote ? readJson(s.file + '.json') : null; return { source: s.url, remote: !!s.remote, pinned: s.sha256 || null, sha256: meta?.sha256 || null, fetchedAt: meta?.fetchedAt || null, present: fs.existsSync(s.file) }; }
      catch (e) { return { source: JSON.stringify(spec), error: e.message }; }
    }),
  };
}

module.exports = { schemas, call, groups, enabled, reload, ready, declarative, bindSql, pluginSource };
