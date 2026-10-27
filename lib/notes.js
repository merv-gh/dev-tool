// Notes people attach to catalog objects ("deprecated, use orders_v2", "owned by team X").
// notes.json next to envs.json: { "<object>": "text" }, where object is schema.table, db:schema.table,
// a function schema.fn, an ES index, a Kafka topic or a service. Shown in find lines and object details.
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./config');
const { readJson, writeJson } = require('./util');

const FILE = path.join(CONFIG_DIR, 'notes.json');
const norm = (k) => String(k || '').trim().toLowerCase();

const all = () => readJson(FILE, {});

function get(name, db) {
  const n = all();
  return n[norm(db ? `${db}:${name}` : name)] || (db ? n[norm(name)] : undefined) || null;
}

function set(name, text) {
  const n = all();
  const k = norm(name);
  if (!k) throw new Error('note needs an object name');
  if (text && String(text).trim()) n[k] = String(text).trim(); else delete n[k];
  writeJson(FILE, Object.fromEntries(Object.entries(n).sort()));
  return { name: k, note: n[k] || null };
}

module.exports = { all, get, set, FILE, exists: () => fs.existsSync(FILE) };
