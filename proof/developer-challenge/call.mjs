#!/usr/bin/env node
// Record the public dt registry boundary, with no direct application access.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.env.DT_PROOF_SETUP) {
  const setup = JSON.parse(readFileSync(process.env.DT_PROOF_SETUP, 'utf8'));
  process.env.DT_HOME = setup.home;
  process.env.GIT_CONFIG_GLOBAL = resolve(dirname(process.env.DT_PROOF_SETUP), 'gitconfig');
}
const [tool, supplied = '{}', label = tool] = process.argv.slice(2);
if (!tool) throw new Error('Usage: DT_HOME=... node proof/developer-challenge/call.mjs TOOL JSON_OR_@FILE [LABEL]');
const args = supplied.startsWith('@') ? JSON.parse(readFileSync(supplied.slice(1), 'utf8')) : JSON.parse(supplied);
const evidence = resolve(process.env.DT_PROOF_OUT || root + '/proof/developer-challenge/evidence');
mkdirSync(evidence, { recursive: true });
const started = new Date();
const result = spawnSync(process.execPath, ['cli.js', 'tool', tool, JSON.stringify(args)], {
  cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const safeString = value => value.replace(/(postgres(?:ql)?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[redacted]@')
  .replace(/("[^"\n]*(?:password|token|secret|authorization)[^"\n]*"\s*:\s*)"[^"\n]*"/gi, '$1"[redacted]"');
function safe(value, key='') {
  if (/(password|passwd|token|secret|authorization)/i.test(key)) return '[redacted]';
  if (typeof value === 'string') return safeString(value);
  if (Array.isArray(value)) return value.map(v=>safe(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safe(v,k)]));
  return value;
}
const record = {
  started: started.toISOString(), ended: new Date().toISOString(), durationMs: Date.now() - started.getTime(),
  tool, args: safe(args), env: { DT_HOME: process.env.DT_HOME || root, JAVA_HOME: process.env.JAVA_HOME || null,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || null, DT_PROOF_SETUP: process.env.DT_PROOF_SETUP || null },
  exitCode: result.status, stdoutBytes: Buffer.byteLength(result.stdout || ''), stderrBytes: Buffer.byteLength(result.stderr || ''),
  stdout: safeString(result.stdout || ''), stderr: safeString(result.stderr || ''), error: result.error?.message,
};
try { record.result = safe(JSON.parse(result.stdout)); record.stdout = JSON.stringify(record.result, null, 2)+'\n'; } catch {}
const sha=value=>createHash('sha256').update(value).digest('hex');
record.requestSha256=sha(JSON.stringify(record.args));
record.stdoutSha256=sha(record.stdout);
record.stderrSha256=sha(record.stderr);
const bound=65536;
if(Buffer.byteLength(record.stdout)>bound){record.stdout=record.stdout.slice(0,bound);record.stdoutTruncated=true;record.result={truncated:true,sha256:record.stdoutSha256};}
if(Buffer.byteLength(record.stderr)>bound){record.stderr=record.stderr.slice(0,bound);record.stderrTruncated=true;}
const name = started.toISOString().replace(/[:.]/g, '-') + '-' + label.replace(/[^a-zA-Z0-9_-]/g, '_');
writeFileSync(resolve(evidence, name + '.json'), JSON.stringify(record, null, 2) + '\n');
appendFileSync(resolve(evidence, 'calls.jsonl'), JSON.stringify({ ...record, stdout: undefined, stderr: undefined, result: undefined, artifact: name + '.json' }) + '\n');
console.log(JSON.stringify({ artifact: name + '.json', durationMs: record.durationMs, exitCode: record.exitCode,
  stdoutBytes: record.stdoutBytes,
  result: process.env.DT_PROOF_BRIEF ? { keys: Object.keys(record.result || {}), status: record.result?.status,
    error: record.result?.error, summary: record.result?.summary, workspace: record.result?.workspace,
    job: record.result?.job } : record.result || record.stdout,
  stderr: record.exitCode ? record.stderr : undefined }, null, 2));
process.exitCode = result.status || 0;
