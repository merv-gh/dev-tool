const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-readiness-contracts-')); process.env.DT_HOME = home; process.env.DT_LOG = 'quiet';
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
test('multi-version public contracts describe actual scoped impact, SQL lineage and passport edge DTOs', async () => {
  const T = require('../lib/tools'), contracts = await T.call('tool_contracts', {}), S = require('../lib/schema');
  assert.ok(contracts.some(c => c.name === 'v2/impact.schema.json'));
  const validate = async (name, value) => assert.deepEqual(S.validate(value, (await T.call('tool_contracts', { name })).schema), []);
  await validate('v2/impact.schema.json', await T.call('impact', { env: 'dev', target: 'table:unknown:public.orders' }));
  await validate('v1/identity.schema.json', require('../lib/semantic-identity').pg('table', 'dev', 'orders', 'public.orders'));
  await validate('v1/column-lineage.schema.json', require('../lib/column-lineage').analyze('select id from public.orders', { tables: [{ schema: 'public', name: 'orders', columns: [{ name: 'id' }] }] }));
  await validate('v1/passport-edges.schema.json', require('../lib/passport/edges').normalize({ service: 'orders', env: 'dev', repo: { sha: 'sha' }, effective: { consumes: [{ topic: 'orders.paid', file: 'Listener.java', line: 4 }] } }, { env: 'dev' }));
});
