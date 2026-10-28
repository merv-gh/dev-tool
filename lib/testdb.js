// Throwaway databases for test runs on a scratch Postgres (tests.pgUrl / DT_TEST_DB_URL; the compose
// "testdb" profile runs one). Each run gets dt_test_<id>, loaded with a DDL snapshot, dropped after.
// This is the only place dt writes to a database, so the URL must not be one of the environments'.
const postgres = require('postgres');
const { getTests, envNames, getEnv } = require('./config');

const same = (a, b) => {
  try { const x = new URL(a), y = new URL(b); return x.hostname === y.hostname && (x.port || '5432') === (y.port || '5432') && x.pathname === y.pathname; } catch { return false; }
};

function server() {
  const url = getTests().pgUrl;
  if (!url) throw new Error('no test database: set tests.pgUrl in config.json (or DT_TEST_DB_URL), e.g. the compose testdb profile: postgres://dt:dt@testdb:5432/postgres');
  for (const e of envNames()) for (const [db, u] of Object.entries(getEnv(e).pg)) if (u && same(u, url)) throw new Error(`tests.pgUrl is the ${e} database "${db}": use a scratch Postgres for tests`);
  return url;
}

// statements: from ddl.snapshot(); returns the JDBC settings and the statements that failed
async function create(runId, statements) {
  const url = server();
  const name = `dt_test_${String(runId).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 40)}`;
  const admin = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await admin.unsafe(`drop database if exists ${name}`);
    await admin.unsafe(`create database ${name}`);
  } catch (e) {
    if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo/.test(`${e.code} ${e.message}`)) throw new Error(`the test database at ${new URL(url).host} is not reachable (${e.code || e.message}): with compose add testdb to COMPOSE_PROFILES, or set tests.pgUrl`);
    throw e;
  } finally { await admin.end({ timeout: 2 }); }
  const u = new URL(url);
  u.pathname = `/${name}`;
  const sql = postgres(u.toString(), { max: 1, onnotice: () => {}, connect_timeout: 10 });
  const errors = [];
  try {
    for (const s of statements) {
      try { await sql.unsafe(s); } catch (e) { errors.push({ statement: s.split('\n')[0].slice(0, 160), error: e.message }); }
    }
  } finally { await sql.end({ timeout: 2 }); }
  return {
    database: name,
    jdbcUrl: `jdbc:postgresql://${u.hostname}:${u.port || 5432}/${name}`,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    errors,
  };
}

async function drop(name) {
  if (!/^dt_test_[a-z0-9]+$/.test(name)) throw new Error(`not a dt test database: ${name}`);
  const admin = postgres(server(), { max: 1, onnotice: () => {} });
  try { await admin.unsafe(`drop database if exists ${name} with (force)`); } finally { await admin.end({ timeout: 2 }); }
}

module.exports = { create, drop, server };
