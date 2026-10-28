#!/usr/bin/env node
// dt — agent-friendly access to dev/uat infrastructure. JSON on stdout, logs on stderr.

const fs = require('fs');
const path = require('path');
const { envNames, getEnv } = require('./lib/config');
const { table, http, CACHE } = require('./lib/util');

const HELP = `
dt — read-only dev environment toolkit (JSON output; add --pretty for tables)

Index (cached, no network to query)
  dt sync [all|pg|es|kafka|consul|passports|bitbucket|confluence|index] [--only a,b] [--spaces SHOP,PAY] [--full]
                                           refresh the index; "index" rebuilds catalog + usage from the cache
  dt find <words...>                       search the catalog (prefix kind: pg: pgfn: es: kafka: consul: svc: api: site:)
  dt usage <schema.table|schema.fn>        who uses it: services, functions, triggers, views, FKs
  dt usage <name> --uses                   what a function / view / service uses
  dt describe <schema.table|schema.fn>     definition + usages

Live
  dt pg "<sql>" [--db name]                read-only query; db picked by schema
  dt pg - [--db name]                      SQL from stdin
  dt es <index> "<field==v && f2~text | JSON>" [--size 10]
  dt kafka <topic> [--n 5]                 last n messages
  dt consul [service]                      services, or instances + /version
  dt tool [name] ['{"json":"args"}']        call any agent tool (list without name)
  dt doctor [--repo PROJECT/slug] [--deep]  why fetching repos or running tests fails here, with fixes
  dt showcase <service> [Class#method] [--envs a,b] [--ref branch] [--test-file Test.java]
                                           health, versions, passport, impact, a test run on master: one page

Serve
  dt serve [--port 4000] [--lan]           tools (MCP /mcp, OpenAPI /openapi.json), pages, /admin
  dt start                                 container entry (serve on 0.0.0.0:$PORT)
  dt webui-setup [--url http://host:3000] [--key <open-webui-api-key>] [--dt-url http://dt-host:4000] [--model a,b]
                                           agent prompt + tools on Open WebUI models; --dt-url also registers dt as a tool server
  dt envs                                  configured envs and what is set
  dt migrate-config [--dry-run]            envs.json + .env.<env> + .env.personal + .env.browser -> config.json + .env
  dt tools-reload [--update]               re-read config.json and plugins (--update re-downloads remote plugins)

Global: --env <name> (default: first env), --pretty.  Config folder: DT_HOME (default: this folder)
`.trim();

const BOOL_FLAGS = new Set(['pretty', 'compact', 'lan', 'help', 'uses', 'dry-run', 'update', 'deep']);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOL_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) { opts[key] = next; i++; } else opts[key] = true;
    } else opts._.push(a);
  }
  return opts;
}

function out(data, opts) {
  if (opts.pretty) {
    const rows = Array.isArray(data) ? data : data.rows || data.hits || data.instances || data.samples;
    if (Array.isArray(rows) && rows.length && typeof rows[0] === 'object') {
      const head = Object.fromEntries(Object.entries(data).filter(([k, v]) => !Array.isArray(v)));
      if (!Array.isArray(data) && Object.keys(head).length) console.log(JSON.stringify(head));
      console.log(table(rows));
      return;
    }
    if (Array.isArray(rows)) { console.log(rows.join('\n')); return; }
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(JSON.stringify(data, null, opts.compact ? 0 : 2));
}

const readStdin = () => new Promise((resolve) => {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks).toString().trim()));
});

const commands = {
  async envs() {
    const p = require('./lib/config').getPersonal();
    const personal = { file: '.env.personal', found: p.found, bitbucket: p.bitbucket.token ? p.bitbucket.url : null, confluence: p.confluence.token ? p.confluence.url : null, llm: p.llm.baseUrl || null, model: p.llm.model || null };
    return [personal, ...envNames().map(name => {
      const e = getEnv(name);
      return {
        env: name, envFile: e.envFile, envFileFound: e.envFileFound,
        pg: Object.entries(e.pg).filter(([, u]) => u).map(([k]) => k),
        pgMissing: Object.entries(e.pg).filter(([, u]) => !u).map(([k]) => k),
        es: e.es.hosts, esAuth: !!e.es.user, kafkaUi: e.kafkaUi, schemaRegistry: e.schemaRegistry, consul: e.consul,
      };
    })];
  },

  async sync(opts) {
    const job = require('./lib/indexer').refresh({ env: opts.env, what: opts._[0] || 'all', only: typeof opts.only === 'string' ? opts.only : undefined, spaces: opts.spaces, full: !!opts.full });
    // stream the job log to stderr while it runs
    let shown = 0;
    const tick = setInterval(() => { while (shown < job.log.length) console.error(job.log[shown++]); }, 200);
    const done = await job.promise;
    clearInterval(tick);
    while (shown < job.log.length) console.error(job.log[shown++]);
    await require('./lib/pg').closeAll();
    if (done.state === 'failed') throw new Error(done.error);
    return done.result;
  },

  async 'migrate-config'(opts) {
    const m = require('./lib/migrate');
    if (opts['dry-run']) { const p = m.plan(); return { config: p.config, secrets: Object.keys(p.secrets) }; }
    return m.migrate();
  },

  async 'tools-reload'(opts) {
    return require('./lib/tools').reload({ update: !!opts.update });
  },

  async usage(opts) {
    const idx = require('./lib/pgindex');
    const rows = opts.uses ? idx.uses(opts.env, opts._.join(' ')) : idx.usages(opts.env, opts._.join(' '));
    return rows.map(e => ({ object: e.target, db: e.db, user: e.user, kind: e.userKind, role: e.role, where: e.where, detail: (e.detail || '').slice(0, 120) }));
  },

  async describe(opts) {
    return require('./lib/pgindex').describe(opts.env, opts._.join(' '));
  },

  async find(opts) {
    return require('./lib/catalog').find(opts.env, opts._.join(' '), { limit: Number(opts.limit) || 200 });
  },

  async pg(opts) {
    let sql = opts._.join(' ');
    if (!sql || sql === '-') sql = await readStdin();
    if (!sql) throw new Error('SQL required: dt pg "select ..."');
    const pg = require('./lib/pg');
    try { return await pg.query(opts.env, sql, { db: opts.db }); }
    finally { await pg.closeAll(); }
  },

  async es(opts) {
    const [index, ...q] = opts._;
    if (!index) throw new Error('Index required: dt es <index> "<query>"');
    return require('./lib/es').search(opts.env, index, q.join(' '), { size: Number(opts.size) || 10 });
  },

  async kafka(opts) {
    const kafka = require('./lib/kafka');
    const topic = opts._[0];
    if (!topic) {
      const idx = JSON.parse(fs.readFileSync(path.join(CACHE, opts.env, 'kafka', '_index.json'), 'utf8'));
      return idx.topics;
    }
    return { topic, samples: await kafka.lastMessages(opts.env, topic, Number(opts.n) || 5) };
  },

  async consul(opts) {
    const consul = require('./lib/consul');
    if (opts._[0]) return consul.service(opts.env, opts._[0]);
    const base = require('./lib/config').endpoint(opts.env, 'consul');
    return Object.keys(await http(`${base}/v1/catalog/services`));
  },

  // dt runner [--port 4100]: the build runner (compose service "runner")
  async runner(opts) {
    require('./lib/runner').serve({ port: Number(opts.port || 4100) });
    return new Promise(() => {});
  },
  // dt doctor [--repo PROJECT/slug] [--deep]: what fetching and test runs need, checked
  async doctor(opts) {
    const d = await require('./lib/doctor').check({ repo: opts.repo, deep: !!opts.deep });
    for (const c of d.checks) console.log(`${{ ok: 'ok  ', warn: 'WARN', fail: 'FAIL' }[c.status]}  ${c.group.padEnd(10)} ${c.check}: ${c.detail}${c.fix ? `\n      fix: ${c.fix}` : ''}`);
    if (d.counts.fail) process.exitCode = 1;
    return d.counts;
  },
  // dt showcase <service> [Class#method] [--envs dev,uat] [--ref master]: every view of one service, one page
  async showcase(opts) {
    const [service, target] = opts._;
    if (!service) throw new Error('usage: dt showcase <service> [Class#method] [--envs a,b] [--ref branch]');
    const S = require('./lib/showcase');
    const test = opts['test-file'] ? require('fs').readFileSync(opts['test-file'], 'utf8') : undefined;
    const r = await S.run({ service, target, envs: opts.envs, ref: opts.ref, test, log: (l) => console.error(l) });
    if (!r.ok) process.exitCode = 1;
    return S.summary(r);
  },
  async tool(opts) {
    const [name, json] = opts._;
    if (!name) return (await require('./lib/tools').schemas()).map(t => `${t.name}: ${t.description}`);
    try { return await require('./lib/tools').call(name, json ? JSON.parse(json) : {}, { source: 'cli' }); }
    finally { await require('./lib/pg').closeAll(); }
  },

  // Give Open WebUI models the agent prompt and default tools (compose runs this once as `setup`).
  async 'webui-setup'(opts) {
    const o = (k) => (typeof opts[k] === 'string' ? opts[k] : undefined);
    return require('./lib/webui').setup({
      ...(o('url') && { base: o('url') }), ...(o('key') && { key: o('key') }), ...(o('model') && { model: o('model') }),
      ...(o('dt-url') && { dtUrl: o('dt-url') }), ...(o('dt-key') && { dtKey: o('dt-key') }),
      ...(o('profile') && { profile: o('profile') }),
    });
  },

  // Container entry point.
  async start() {
    return commands.serve({ lan: true, port: process.env.PORT });
  },

  async serve(opts) {
    require('./server').start({ port: Number(opts.port) || 4000, host: opts.lan ? '0.0.0.0' : (opts.host || '127.0.0.1') });
    return undefined;
  },
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._.shift();
  opts.env = typeof opts.env === 'string' ? opts.env : envNames()[0];
  if (!cmd || cmd === 'help' || opts.help || !commands[cmd]) { console.log(HELP); return; }
  const result = await commands[cmd](opts);
  if (result !== undefined) out(result, opts);
}

main().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
