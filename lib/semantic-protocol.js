// Shared by the bundled client and the isolated Joern worker. No external runtime library.
const crypto = require('node:crypto');
const VERSION = 'dt.semantic/v1';
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const ID = /^[a-f0-9]{32,64}-[a-f0-9]{16,32}$/;
const error = (message, code = 'DT_SEMANTIC_INVALID', statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
function integer(value, fallback, min, max) {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw error(`Expected an integer in ${min}..${max}`);
  return n;
}
function relative(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || /[\\\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..') || /^[A-Za-z]:/.test(value)) throw error('Source path must be a relative file path');
  return value;
}
async function* lines(stream, { maxBytes = 512 * 1048576, maxLineBytes = 3 * 1048576, signal } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '', bytes = 0;
  for await (const chunk of stream) {
    signal?.throwIfAborted(); bytes += chunk.length;
    if (bytes > maxBytes) throw error('Semantic stream exceeds its byte budget', 'DT_SEMANTIC_LIMIT', 413);
    pending += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index); pending = pending.slice(index + 1);
      if (Buffer.byteLength(line) > maxLineBytes) throw error('Semantic record exceeds its byte budget', 'DT_SEMANTIC_LIMIT', 413);
      if (line.trim()) yield line;
    }
    if (Buffer.byteLength(pending) > maxLineBytes) throw error('Semantic record exceeds its byte budget', 'DT_SEMANTIC_LIMIT', 413);
  }
  pending += decoder.decode();
  if (pending.trim()) { if (Buffer.byteLength(pending) > maxLineBytes) throw error('Semantic record exceeds its byte budget', 'DT_SEMANTIC_LIMIT', 413); yield pending; }
}
module.exports = { VERSION, ID, digest, integer, relative, lines, error };
