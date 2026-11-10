// Conversation ownership/compaction belongs to the chat client. Bound only its
// tool transport here; scripts and Admin still receive the complete tool value.
const crypto = require('node:crypto');
const fs = require('node:fs');
const invalid = message => Object.assign(Error(message), { code: 'DT_CONTEXT_ARGUMENT', statusCode: 400 });
const missing = () => Object.assign(Error('Retained tool response is unavailable or expired in this story'), { code: 'DT_NOT_FOUND', statusCode: 404 });
function integer(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw invalid(`${name} must be an integer from ${min} to ${max}`);
  return number;
}
function policy(model) {
  const llm = require('./config').getPersonal().llm;
  const selected=model || llm.model, override = llm.contextWindows?.[selected];
  const qwen27b=/(?:^|\/)qwen3\.8(?::|-)27b(?:$|[-_])/i.test(selected || '');
  const window = integer(override ?? llm.contextWindow, qwen27b ? 262144 : 32768, 4096, 10000000, 'llm.contextWindow');
  const reserve = integer(llm.contextReserve, Math.min(32768, Math.floor(window / 4)), 256, window - 1024, 'llm.contextReserve');
  const threshold = integer(llm.compactAt, Math.min(Math.floor(window * 0.75), window - reserve), 512, window - reserve, 'llm.compactAt');
  const mode=String(llm.compactionMode || 'manual').trim().toLowerCase();
  if(!['manual','auto'].includes(mode))throw invalid('llm.compactionMode must be manual or auto');
  // Native WebUI uses one enable flag for both the Compact action and automatic
  // summaries. An unreachable trigger keeps the action without rewriting WebUI.
  const automaticThreshold=mode==='auto'?threshold:2147483647;
  return { enabled: !['false','0','off','no'].includes(String(llm.compaction).trim().toLowerCase()), mode, contextWindow: window, reserveTokens: reserve, compactAt: threshold, automaticThreshold, retentionPercent: 25,
    modelResultBytes: require('./config').getTools().modelResultBytes, counting: 'Client/provider token estimates; configure the actual serving window, including tool definitions and output.' };
}
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function prefix(text, limit) {
  const b = Buffer.from(text); let end = Math.min(limit, b.length);
  while (end < b.length && end > 0 && (b[end] & 0xc0) === 0x80) end--;
  return b.subarray(0, end).toString('utf8');
}
// Bounded structural preview: identifiers/flags remain usable and every omitted
// detail is explicitly recoverable. Never mutate the actual result or retry it.
function short(value, depth = 0, budget = { left: 5000 }) {
  if (budget.left < 30 || depth > 4) return '[details in result_read]';
  if (typeof value === 'string') { const text = prefix(value, Math.min(700, budget.left - 20)); budget.left -= Buffer.byteLength(text) + 20; return text === value ? value : text + '… [preview]'; }
  if (Array.isArray(value)) { const out = []; for (const v of value.slice(0, depth < 2 ? 3 : 1)) { if (budget.left < 30) break; budget.left -= 4; out.push(short(v, depth + 1, budget)); } return out; }
  if (value && typeof value === 'object') { const out = {}; for (const [k,v] of Object.entries(value).slice(0, 35)) { if (budget.left < 30) break; if (k.length > 200) continue; budget.left -= Buffer.byteLength(k) + 8; Object.defineProperty(out,k,{value:short(v,depth+1,budget),enumerable:true}); } return out; }
  budget.left -= 20;
  return value;
}
function prepare(tool, value, {reserveBytes=0}={}) {
  if (value === undefined) return value;
  const configured = require('./config').getTools().modelResultBytes;if(!configured)return value;
  const limit=Math.max(1024,configured-Math.min(1024,reserveBytes));
  const serialized=JSON.stringify(value),originalBytes=Buffer.byteLength(serialized);
  if (originalBytes <= limit) return value;
  let stored, saveError;
  try { stored = require('./results').saveTool(tool,serialized); }
  catch (error) { saveError = require('./redact').clean(error.message); }
  const id = stored?.split('/').pop();
  const priority=['ok','outcome','job','id','state','status','workspace','executionId','error','view'];
  const ordered=value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries([...priority.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]),...Object.entries(value).filter(([k])=>!priority.includes(k))]):null;
  const out = { ...(ordered ? short(ordered) : { preview: short(value) }),
    modelContext: { compacted: true, originalBytes, budgetBytes: limit, ...(id ? { resultId: id, read: { tool: 'result_read', arguments: { id } }, evidenceView: stored } : { evidenceSaved: false, saveError }),
      guidance: 'Preview only. Read a JSON pointer with result_read (tool_execute if not listed), or aggregate pages inside code. Save constraints, progress and evidence with context_write. The original tool already ran; do not repeat an action to recover output.' } };
  if (!out.view && stored) out.view = stored;
  // Remove bulky preview fields atomically; never return malformed cut JSON.
  for (const key of Object.keys(out).filter(k => !['modelContext','view','id','job','state','status','ok','outcome','workspace','executionId'].includes(k)).reverse()) {
    if (bytes(out) <= limit) break; delete out[key];
  }
  // An unusual structured job/id can itself be huge. Its exact value is retained.
  for (const key of ['job','id','workspace','executionId','view']) if (bytes(out) > limit && typeof out[key] !== 'string') delete out[key];
  if (bytes(out) > limit) return { modelContext: out.modelContext, ...(stored ? { view: stored } : {}) };
  return out;
}
function read({ id, path = '', cursor, max_bytes }) {
  if (typeof path !== 'string' || path.length > 2000 || path && !path.startsWith('/')) throw invalid('path must be an RFC 6901 JSON pointer, such as /rows/0');
  const meta=require('./results').toolMeta(id);
  if (!meta) throw missing();
  let value;
  if(path){const record=require('./results').load(id);if(!record)throw missing();value=record.data;}
  if (path) for (const raw of path.slice(1).split('/')) {
    if (/~(?![01])/.test(raw)) throw invalid('Invalid JSON pointer escape');
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw invalid('JSON pointer does not exist in the retained response');
    value = value[key];
  }
  const buffer = path?Buffer.from(JSON.stringify(value)):null,total=buffer?buffer.length:meta.info.bodyBytes,hash = crypto.createHash('sha256').update(id + '\0' + path).digest('hex');
  let offset = 0;
  if (cursor) {
    try { if (cursor.length > 1024) throw Error(); const c = JSON.parse(Buffer.from(cursor, 'base64url')); if (c.hash !== hash || !Number.isSafeInteger(c.offset) || c.offset < 0 || c.offset > total) throw Error(); offset = c.offset; }
    catch { throw invalid('Cursor does not belong to this result/path'); }
  }
  const max = Math.floor((require('./config').getTools().modelResultBytes||12288) / 8), limit = integer(max_bytes, Math.min(1024, max), 128, max, 'max_bytes');
  let chunk;
  if(buffer)chunk=buffer.subarray(offset,Math.min(total,offset+limit+4));
  else{let fd;try{fd=fs.openSync(meta.file,'r');chunk=Buffer.alloc(Math.min(total-offset,limit+4));const n=fs.readSync(fd,chunk,0,chunk.length,meta.offset+offset);if(n!==chunk.length)throw invalid('Retained response is incomplete');}catch(error){if(error.code==='ENOENT')throw missing();throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}}
  if(chunk.length&&(chunk[0]&0xc0)===0x80)throw invalid('Cursor starts inside a UTF-8 character');
  let end=Math.min(limit,chunk.length);while(end<chunk.length&&end>0&&(chunk[end]&0xc0)===0x80)end--;
  const text=chunk.subarray(0,end).toString('utf8'),next=offset+end;
  return { id, path, encoding: 'json/utf8', text, startByte: offset, totalBytes: total, complete: next === total,
    nextCursor: next < total ? Buffer.from(JSON.stringify({ hash, offset: next })).toString('base64url') : null };
}
module.exports = { policy, prepare, read };
