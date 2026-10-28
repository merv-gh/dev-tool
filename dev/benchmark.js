#!/usr/bin/env node
// Synthetic, deterministic, local-only benchmark. No environment connections are opened.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bench-'));
process.env.DT_HOME = home;
for (const k of ['DT_CONFIG_DIR', 'DT_CACHE_DIR', 'DT_PASSPORTS_DIR']) delete process.env[k];
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ envs: { dev: {} } }));
function time(n, fn) { const start = performance.now(); for (let i = 0; i < n; i++) fn(i); return Math.round((performance.now() - start) * 100) / 100; }
try {
  const root = path.join(home, 'source');
  fs.mkdirSync(root);
  const count = Number(process.env.DT_BENCH_FILES || 600);
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(root, `Service${i}.java`), `package bench; public class Service${i} { public String lookup(String id) { return "order-${i}" + id; } }\n`);
    fs.writeFileSync(path.join(root, `config${i}.properties`), `service=${i}\n${'spring.application.name=benchmark\n'.repeat(100)}`);
  }
  const CI = require('../lib/codeindex');
  const coldBuildMs = time(1, () => CI.build(root, 'BENCH/service'));
  const repeatedBuildMs = time(5, () => CI.build(root, 'BENCH/service'));
  CI.load('BENCH/service');
  const load1000Ms = time(1000, () => CI.load('BENCH/service'));
  const grep100Ms = time(100, i => CI.grep(['BENCH/service'], `order-${i % count}`, { limit: 5 }));
  const dir = path.join(home, 'cache', 'dev');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'catalog.txt'), Array.from({ length: 10000 }, (_, i) => `pg service${i % 10} data.table${i} ~100: id bigint, order_id bigint, status text | used by: svc orders(read,write)`).join('\n') + '\n');
  const C = require('../lib/catalog');
  C.find('dev', 'missing');
  const find100Ms = time(100, i => C.find('dev', `pg: table${i + 10000}`));
  const pgFile = path.join(dir, 'pg', '_usage.json');
  require('../lib/util').writeJson(pgFile, { builtAt: new Date().toISOString(), edges: Array.from({ length: 10000 }, (_, i) => ({ db: 'orders', target: `data.t${i}`, user: 'order-service', role: 'read' })) });
  const PI = require('../lib/pgindex');
  PI.load('dev');
  const usageLoad1000Ms = time(1000, () => PI.load('dev'));
  process.stdout.write(JSON.stringify({ node: process.version, sourceFiles: count * 2, catalogLines: 10000, usageEdges: 10000, coldBuildMs, repeatedBuild5Ms: repeatedBuildMs, manifestLoad1000Ms: load1000Ms, grep100Ms, catalogFind100Ms: find100Ms, usageLoad1000Ms }, null, 2) + '\n');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
