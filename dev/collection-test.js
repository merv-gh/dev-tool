#!/usr/bin/env node
// CI entry point: JSON to stdout, optional JUnit file, explicit non-green exit states.
const fs = require('fs');
const path = require('path');
const C = require('../lib/collections');
async function main(argv) {
  const collection = argv.shift(), options = {}, controller = new AbortController();
  let junit;
  if (!collection || collection.startsWith('-')) throw new Error('usage: node dev/collection-test.js <collection> [--params JSON] [--tags a,b] [--select id,id] [--seed n] [--junit file]');
  while (argv.length) {
    const key = argv.shift(), value = argv.shift();
    if (value === undefined) throw new Error(`missing value for ${key}`);
    if (key === '--params') options.params = JSON.parse(value);
    else if (key === '--tags') options.tags = value.split(',').filter(Boolean);
    else if (key === '--select') options.select = value.split(',').filter(Boolean);
    else if (key === '--seed') options.seed = value;
    else if (key === '--junit') junit = path.resolve(value);
    else if (key === '--timeout-ms') options.timeoutMs = Number(value);
    else throw new Error(`unknown option ${key}`);
  }
  const stop = () => controller.abort(new Error('SIGINT'));
  process.once('SIGINT', stop);
  try {
    const r = await C.run(collection, { ...options, signal: controller.signal });
    if (junit && r.run) { fs.mkdirSync(path.dirname(junit), { recursive:true }); fs.writeFileSync(junit, C.junit(r), { mode:0o600 }); }
    process.stdout.write(JSON.stringify(r.run ? C.summary(r) : r) + '\n');
    process.exitCode = r.status === 'cancelled' ? 130 : r.status === 'invalid' ? 2 : r.ok ? 0 : 1;
  } finally { process.removeListener('SIGINT', stop); }
}
main(process.argv.slice(2)).catch(e => { process.stderr.write(`collection-test: ${e.message}\n`); process.exitCode = 2; });
