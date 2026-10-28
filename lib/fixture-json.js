// Reject numeric precision loss before JSON.parse can erase evidence. Numeric strings remain strings.
// This port can be replaced by an encoded/lossless worker; decoded JS cannot represent every JSON number.
function normalized(text) {
  const match = String(text).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  let digits = (match[2] + (match[3] || '')).replace(/^0+/, ''), exponent = Number(match[4] || 0) - (match[3]?.length || 0);
  if (!digits) return '0';
  while (digits.endsWith('0')) { digits = digits.slice(0,-1); exponent++; }
  return `${match[1]}${digits}e${exponent}`;
}
function parse(text) {
  if (typeof text !== 'string') return text;
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('fixture JSON exceeds 16 MiB');
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  for (const token of text.matchAll(tokens)) if (token[1]) {
    const value = Number(token[1]);
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value) || normalized(token[1]) !== normalized(String(value))) throw new Error('fixture JSON numeric precision would be lost; encode exact integers/decimals as strings or use an encoded-payload adapter');
  }
  return JSON.parse(text);
}
function object(text) { return typeof text === 'string' && /^\s*[\[{]/.test(text) ? parse(text) : text; }
module.exports = { parse, object };
