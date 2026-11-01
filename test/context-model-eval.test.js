const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const E = require('../dev/eval-context-model');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-context-oracle-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('context corpus is reproducible, multi-source and every numeric field is independently graded', () => {
  const expected = E.fixtures(root), copy = E.fixtures(path.join(root, 'copy'));
  assert.equal(expected.corpusSha256, copy.corpusSha256); assert.ok(expected.sizes.invoices > 700); assert.ok(expected.sizes.capacity > 1000);
  assert.ok(expected.ledger.merchants.every(m => m.invoice_count > 0));
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'ledger/policy.json'))); assert.deepEqual(policy.merchants.sort(), expected.ledger.merchants.map(m => m.merchant).sort());
  for (const id of ['ledger', 'reserve', 'capacity', 'related']) {
    assert.equal(E.grade(id, { merchants: {}, regions: {} }, expected[id]).passed, false);
    const answer = structuredClone(expected[id]); assert.equal(E.grade(id, answer, expected[id]).passed, true, id);
    const key = id === 'capacity' ? 'regions' : 'merchants';
    for (const [field, value] of Object.entries(answer[key][0])) if (typeof value === 'number') {
      answer[key][0][field]++; assert.equal(E.grade(id, answer, expected[id]).passed, false, `${id}.${field}`); answer[key][0][field]--;
    }
    for (const [field, value] of Object.entries(answer)) if (typeof value === 'number') {
      answer[field]++; assert.equal(E.grade(id, answer, expected[id]).passed, false, `${id}.${field}`); answer[field]--;
    }
    if (answer.totals) { answer.totals.net_cents++; assert.equal(E.grade(id, answer, expected[id]).passed, false); answer.totals.net_cents--; }
    answer[key].pop(); assert.equal(E.grade(id, answer, expected[id]).passed, false);
  }
});
test('evaluation never runs implicitly or permits arbitrary endpoints/budgets', () => {
  assert.throws(() => E.options([]), /model/);
  assert.throws(() => E.options(['--model', 'q', '--output', '/tmp/a', '--endpoint', 'https://outside.example/v1']), /Remote/);
  assert.throws(() => E.options(['--model', 'q', '--output', '/tmp/a', '--maxCalls', 'Infinity']), /budget/);
  assert.deepEqual(E.jsonAnswer('answer:\n```json\n{"a":1}\n```'), { a: 1 }); assert.equal(E.jsonAnswer('no result'), null);
});
