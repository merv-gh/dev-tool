// Public schema names are stable; source implementation directories may change independently.
const path = require('path');
const fs = require('fs');
const aliases = {
  'v1/collection.schema.json': 'schemas/collection-contract.schema.json',
  'v1/scenario-package.schema.json': 'schemas/scenario-package-v1.json',
  'v1/postgres-template.schema.json': 'docs/contracts/postgres-template-v1.schema.json',
};
function resolve(name, root = require('./config').ROOT) {
  if (!/^v\d+\/[a-z][a-z0-9-]*\.schema\.json$/.test(name)) return null;
  const direct = path.join(root, 'contracts', name), fallback = aliases[name] && path.join(root, aliases[name]);
  return fs.existsSync(direct) ? direct : fallback && fs.existsSync(fallback) ? fallback : null;
}
function list() {
  const root = require('./config').ROOT, names = new Set(Object.keys(aliases));
  try { for (const f of fs.readdirSync(path.join(root, 'contracts/v1'))) if (f.endsWith('.schema.json')) names.add(`v1/${f}`); } catch {}
  return [...names].sort().filter(name => resolve(name)).map(name => ({ name, url: `/contracts/${name}`, schema: JSON.parse(fs.readFileSync(resolve(name), 'utf8')) }));
}
module.exports = { aliases, resolve, list };
