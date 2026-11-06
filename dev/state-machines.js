// Export executable transition tables without starting the app or reading .env.
// The baseline audit remains pinned to its original commit and source hashes.
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), file = path.join(root, 'docs/benchmarks/state-machine-runtime.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(root,'docs/benchmarks/state-machines.json'),'utf8'));
const expected = baseline.machines.map(m=>m.id).sort();
const actual = catalog.families.map(m=>m.id).sort();
if (JSON.stringify(expected)!==JSON.stringify(actual)) throw Error('Runtime ownership map must cover every audited family exactly once');
for (const family of catalog.families) for (const owner of family.owners) if (!fs.statSync(path.join(root,owner)).isFile()) throw Error('Missing owner '+owner);
const { models } = require('../lib/state-machine');
const charts = [...Object.values(require('../lib/lifecycles')), ...Object.values(models), require('../web/map-format').decoding, require('../lib/atomic-file').model].sort((a,b)=>a.name.localeCompare(b.name));
if (new Set(charts.map(c=>c.name)).size!==charts.length) throw Error('Duplicate chart name');
const updated = {...catalog, charts};
const bytes = JSON.stringify(updated,null,2)+'\n';
if (process.argv.includes('--check')) {
  if (bytes !== fs.readFileSync(file,'utf8')) throw Error('State chart catalog is stale: node dev/state-machines.js');
} else fs.writeFileSync(file,bytes);
console.log(`${catalog.families.length} audited families; ${charts.length} shared executable charts`);
