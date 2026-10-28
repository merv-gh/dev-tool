const fs = require('fs'), path = require('path');
function put(home, file, value) {
  const dest = path.join(home, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, typeof value === 'string' ? value : JSON.stringify(value));
}
function configure(home, tools = {}) {
  put(home, 'config.json', { envs: { dev: {}, staging: {}, prod: {} }, tools, server: { ratePerSec: 0 }, knowledge: { sources: [{ id: 'guide', type: 'json', path: 'sources/guide.json' }] } });
}
function seed(home) {
  configure(home);
  put(home, 'sources/guide.json', { version: 1, entities: [{ id: 'service:orders', name: 'orders-service', kind: 'service' }], documents: [{ title: 'Synthetic evaluation policy', text: 'Synthetic evaluation requires source revision evidence.' }] });
  for (const environment of ['dev', 'staging', 'prod']) {
    const dbs = environment === 'staging' ? ['orders', 'archive'] : ['orders'];
    for (const db of dbs) put(home, `cache/${environment}/pg/${db}.json`, { db, tables: [{ schema: 'public', name: 'orders', kind: 'table', columns: [{ name: 'id', type: 'bigint' }, { name: environment === 'prod' ? 'prod_only' : 'status', type: 'text' }] }], functions: [] });
    put(home, `cache/${environment}/catalog.txt`, dbs.map(db => `pg ${db} public.orders [table] ~1: id bigint, status text`).join('\n'));
  }
}
module.exports = { configure, seed, put };
