const test = require('node:test'), assert = require('node:assert/strict');
const { rank, search, legacyRank } = require('../lib/tool-search');
const schema = (name, description, group = 'code') => ({ name, description, group });

test('discovery ranks exact names despite punctuation, common words and verbose decoys', () => {
  const tools = [schema('table_read', 'Read a table'), schema('log_search', 'Find service exceptions'), schema('other', 'in into within inside testing ' + 'the '.repeat(200))];
  assert.equal(rank(tools, '  TABLE_READ  ')[0].t.name, 'table_read');
  assert.equal(rank(tools, 'the exceptions in a service')[0].t.name, 'log_search');
  assert.deepEqual(rank(tools, 'in the and with'), []);
  assert.deepEqual(rank(tools, 'tin'), [], 'short tokens must not match arbitrary substrings');
  assert.equal(rank(tools, 'TABLE: tables?')[0].t.name, 'table_read');
});
test('discovery deduplicates repeated tokens, preserves exact groups and orders ties', () => {
  const tools = [schema('zebra', 'inspect rows', 'pg'), schema('alpha', 'inspect rows', 'pg'), schema('other', 'inspect rows', 'es')];
  assert.deepEqual(rank(tools, 'inspect inspect inspect').map(x => x.t.name), rank(tools, 'inspect').map(x => x.t.name));
  assert.deepEqual(rank(tools, 'rows', 'pg').map(x => x.t.name), ['alpha', 'zebra']);
  assert.deepEqual(rank(tools, 'rows', 'disabled'), []);
  tools[0].description = 'changed capability';
  assert.deepEqual(rank(tools, 'changed').map(x => x.t.name), ['zebra'], 'metadata changes invalidate cached words');
  assert.deepEqual(rank(tools.slice(1), 'changed'), [], 'cached disabled tools are never returned');
});
test('bounded lexical evidence exposes unsupported symptom words without confidence claims', () => {
  const tools = [schema('session', 'Sessions expire after idling')];
  const r = search(tools, 'production reservations expire');
  assert.deepEqual(r.lexical.matchedTerms, ['expire']);
  assert.deepEqual(r.lexical.unmatchedTerms, ['production', 'reservation']);
  assert.equal(r.lexical.mode, 'normalized-keywords');
  const many = search(tools, Array.from({ length: 40 }, (_, i) => 'word' + i).join(' '));
  assert.equal(many.lexical.unmatchedTerms.length, 12);
  assert.equal(many.lexical.truncated, true);
});
test('legacy compatibility retains original substring, repeated-word and exact-name scoring', () => {
  const tools = [schema('thing', 'in testing'), schema('alpha', 'a table'), schema('pg_query', 'Read query data', 'pg')];
  const reference = (query, group) => { const words = query.toLowerCase().split(/[\s_:-]+/).filter(Boolean); return tools.filter(t => !group || t.group === group).map(t => { const name = t.name.toLowerCase(), text = `${name.replace(/_/g, ' ')} ${t.group} ${t.description}`.toLowerCase(); return { t, score: (name === query.toLowerCase() ? 1000 : 0) + words.reduce((n, w) => n + (text.includes(w) ? 20 : 0) + (name.includes(w) ? 3 : 0), 0) }; }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name)); };
  for (const query of ['in', 'in in', 'PG_QUERY', 'pg:query', 'the', 'table?', 'read query', '  pg_query  ']) for (const group of [undefined, 'pg', 'missing']) assert.deepEqual(legacyRank(tools, query, group), reference(query, group));
});
test('offline benchmark exercises real registry discovery, validation recovery and permission guards', async () => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const { stdout } = await promisify(execFile)(process.execPath, [require.resolve('../dev/benchmark-discovery')], { maxBuffer: 1024 * 1024 });
  const report = JSON.parse(stdout);
  assert.ok(report.metrics.cases >= 24);
  assert.equal(report.profiles.compact.count, 11);
  assert.equal(report.profiles.lean.count, 4);
  assert.equal(report.profiles['lean-find'].count, 5);
  assert.ok(report.profiles.lean.utf8Bytes < report.profiles.compact.utf8Bytes / 3);
  assert.equal(report.contractChecks.invalidArgumentRecovery.recovered, true);
  assert.equal(report.contractChecks.ambiguity.candidates.length, 2);
  assert.equal(report.contractChecks.staleSource.failedUpdateReported, true);
  assert.ok(Object.values(report.contractChecks.permissions).every(Boolean));
  assert.equal(report.modelEvaluation.performed, false);
});
