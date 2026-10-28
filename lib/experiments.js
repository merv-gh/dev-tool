// Repeatable read-only investigations: saved sandbox code, assertions and comparable run history.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { HOME } = require('./config');
const { CACHE, readJson, writeJson } = require('./util');
const ALLOWED = new Set(['find', 'pg_query', 'pg_table', 'pg_function', 'pg_usage', 'who_uses', 'es_search', 'kafka_last', 'kafka_topic', 'health', 'logs_search', 'logs_trace', 'passports', 'api_routes', 'code_search', 'code_symbols', 'impact', 'fixture_plan']);
const valid = id => { if (!/^[a-z0-9][\w-]{0,79}$/i.test(id || '')) throw new Error('experiment id: letters, digits, _ and -'); return id; };
const definition = id => path.join(HOME, 'experiments', `${valid(id)}.json`);
const historyFile = id => path.join(CACHE, 'experiments', `${valid(id)}.json`);

function save({ id, description = '', code, defaults = {}, tools = ['find'] }) {
  if (typeof code !== 'string' || !code.trim() || code.length > 100000) throw new Error('experiment needs code (max 100k characters)');
  if (!Array.isArray(tools) || tools.some(t => !ALLOWED.has(t))) throw new Error(`read-only experiment tools: ${[...ALLOWED].join(', ')}`);
  const d = { id: valid(id), description, code, defaults, tools: [...new Set(tools)] };
  writeJson(definition(id), d);
  return { ...d, path: path.relative(HOME, definition(id)) };
}
function list(id) {
  if (id) {
    const d = readJson(definition(id));
    if (!d) throw new Error(`no experiment ${id}`);
    return { ...d, runs: readJson(historyFile(id), []).map(r => ({ run: r.run, at: r.at, ok: r.ok, ms: r.ms, assertions: r.tests.length, codeHash: r.codeHash })) };
  }
  let files = [];
  try { files = fs.readdirSync(path.join(HOME, 'experiments')).filter(f => f.endsWith('.json')); } catch {}
  return files.map(f => readJson(path.join(HOME, 'experiments', f))).filter(Boolean).map(d => ({ id: d.id, description: d.description, tools: d.tools }));
}
async function run(id, { params = {}, capture, timeoutMs = 30000 } = {}, { call } = {}) {
  const d = readJson(definition(id));
  if (!d) throw new Error(`no experiment ${id}`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('timeout_ms must be 1..120000');
  const allowed = new Set((d.tools || []).filter(t => ALLOWED.has(t))), calls = [];
  const vars = { ...d.defaults, ...params };
  if (capture) vars.fixture = require('./reproduction').load(capture);
  const started = Date.now();
  let r;
  try { r = await require('./offline-js').run(d.code, { vars }, {
    timeoutMs,
    onTool: async (name, args) => {
      if (name === '__list') return [...allowed];
      if (!allowed.has(name)) throw new Error(`experiment tool ${name} is not in its read-only allowlist`);
      const start = Date.now();
      try { return await (call || require('./tools').call)(name, args); }
      finally { calls.push({ tool: name, ms: Date.now() - start }); }
    },
  }); } catch (e) { r = { error: e.message, tests: [], logs: [], output: [] }; }
  const result = { run: crypto.randomBytes(10).toString('hex'), at: new Date().toISOString(), codeHash: crypto.createHash('sha256').update(d.code).digest('hex'), params: { ...d.defaults, ...params }, capture,
    ok: !r.error && r.tests.every(t => t.ok), ms: Date.now() - started, tests: r.tests, error: r.error, logs: r.logs, output: r.output, value: r.hasReturn ? r.returned : r.result, calls };
  const history = readJson(historyFile(id), []);
  history.push(result); writeJson(historyFile(id), history.slice(-100));
  return result;
}
function compare(id, before, after) {
  const history = readJson(historyFile(id), []);
  const a = before ? history.find(r => r.run === before) : history.at(-2), b = after ? history.find(r => r.run === after) : history.at(-1);
  if (!a || !b) throw new Error('need two experiment runs (or valid before/after run ids)');
  const { diffLines, diffLists } = require('./diff');
  return { before: a.run, after: b.run, sameCode: a.codeHash === b.codeHash, beforeOk: a.ok, afterOk: b.ok, msDelta: b.ms - a.ms,
    assertions: diffLists(a.tests, b.tests, { key: 'name' }), values: diffLines(JSON.stringify(a.value, null, 2) || 'null', JSON.stringify(b.value, null, 2) || 'null') };
}
module.exports = { save, list, run, compare, ALLOWED };
