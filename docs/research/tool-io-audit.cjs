// Research only: inspect schemas in a disposable configuration; never run builds or live queries.
// node docs/research/tool-io-audit.cjs > /tmp/tool-io-current.json
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-io-audit-'));
for (const key of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR', 'DT_TOOLS']) delete process.env[key];
Object.assign(process.env, { DT_HOME: home, DT_STATE_BACKEND: 'legacy', DT_LOG: 'quiet', DT_NO_DOCTOR: '1' });
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} }, scripts: { starters: false }, tools: { plugins: [] } }));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
async function main() {
  const T = require(path.join(root, 'lib/tools'));
  const schemas = await T.schemas();
  const meta = await T.schemas({ metadata: true });
  const profiles = require(path.join(root, 'lib/tool-profiles'));
  const inventory = meta.map(t => ({
    name: t.name, group: t.group, required: t.inputSchema.required,
    parameters: Object.keys(t.inputSchema.properties),
    strict: t.inputSchema.additionalProperties === false,
    descriptionBytes: Buffer.byteLength(t.description),
    definitionBytes: bytes(schemas.find(s => s.name === t.name)),
    adapterResultContract: !!t.execution?.resultSchema,
  }));
  const groups = Object.fromEntries([...new Set(inventory.map(t => t.group))].map(group => [group, inventory.filter(t => t.group === group).map(t => t.name)]));
  const output = {
    method: 'Clean dev environment; starters/plugins/custom tools disabled. Registry/schema inspection only; no tool actions executed. Byte counts are minified UTF-8 JSON, not tokens.',
    toolCount: inventory.length, groupCount: Object.keys(groups).length,
    definitionsBytes: bytes(schemas), adapterResultContractCount: inventory.filter(t => t.adapterResultContract).length,
    profiles: profiles.list(meta).map(p => ({ name: p.name, tools: p.count, definitionsBytes: bytes(profiles.select(schemas, p.name)) })),
    groups, inventory,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await require(path.join(root, 'lib/state-store')).close();
  fs.rmSync(home, { recursive: true, force: true });
});
