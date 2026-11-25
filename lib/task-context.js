// Compaction changes model input only. Receipts and executable queues stay durable.
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function limits(cfg) {
  const budget = Math.min(768000, Math.max(8192, (Number(cfg.contextWindow) || 262144) * 2));
  return {budget, threshold:Math.floor(budget * .75), automatic:cfg.compactionMode === 'auto' && cfg.compaction !== false};
}
function prefix(messages,maxBytes) {
  let end=0;
  for(let i=1;i<=messages.length;i++) {
    if(i<messages.length && messages[i].role==='tool') continue;
    if(bytes(messages.slice(0,i))>maxBytes) break;
    end=i;
  }
  return {head:messages.slice(0,end),tail:messages.slice(end)};
}
function retry(error, attempt, cfg, random = Math.random) {
  const status = Number(error.statusCode), message = String(error.message || '');
  const transient = [408,429,500,502,503,504].includes(status) || !status && /\b(408|429|500|502|503|504|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|EAI_AGAIN)\b|overloaded|timeout|temporar(?:ily|y).*unavailable|fetch failed/i.test(message);
  const max = Math.max(0,Math.min(10,Number.isFinite(Number(cfg.taskModelRetries)) ? Number(cfg.taskModelRetries) : 5));
  if (!transient || attempt >= max) return null;
  const base = Math.max(1000,Math.min(60000,Number(cfg.taskRetryBaseMs) || 15000));
  return Math.min(300000,Math.max(Number(error.retryAfterMs) || 0,base * 2 ** attempt * (1 + random() * .2)));
}
module.exports = {bytes,limits,prefix,retry};
