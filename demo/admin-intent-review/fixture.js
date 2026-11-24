#!/usr/bin/env node
// Disposable current-app corpus. Never uses the developer's real config home.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const port = Number(process.argv[2] || 4096);
const manifest = path.resolve(process.argv[3] || 'work/admin-intent-review/fixture.json');
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw Error('Choose a port with its next port free.');
fs.mkdirSync(path.dirname(manifest), { recursive: true });
// A fresh manifest prevents accidentally seeding an old, still-running fixture.
if (fs.existsSync(manifest)) throw Error('Use a new manifest path or remove the old manifest after stopping its fixture.');
const child = spawn(process.execPath, [path.resolve(__dirname, '../ui-ux.js'), String(port), manifest], { env: { ...process.env, DT_DEMO_WORKBENCH: '1' }, stdio: ['ignore', 'inherit', 'inherit'] });
let timer, home, stopped = false;
const stop = () => { if (stopped) return; stopped = true; clearTimeout(timer); child.kill('SIGTERM'); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
child.once('exit', code => { clearTimeout(timer); if (home) fs.rmSync(home, { recursive: true, force: true }); process.exitCode = stopped ? 0 : code || 0; });
const deadline = Date.now() + 30000;
function ready() {
  if (stopped || child.exitCode !== null) return;
  if (!fs.existsSync(manifest)) { if (Date.now() > deadline) { console.error('Fixture did not start in 30 seconds.');process.exitCode=1;return stop(); } timer = setTimeout(ready, 100);return; }
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  home = m.home;
  const file = path.join(home, 'config.json'), config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.browser = { sites: { shop: { url: m.apiBase + '/shop', description: 'Synthetic checkout back office', links: { person: { path: '/person/<id>', description: 'Inspect one person' } }, secrets: [] } } };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  fs.cpSync(path.resolve(__dirname, '../scripts'), path.join(home, 'scripts'), { recursive: true });
  console.log('Review fixture ready: ' + m.admin + ' (Ctrl-C stops it and removes its temporary home).');
}
ready();
