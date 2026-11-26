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
  const priority=['ok','outcome','job','id','state','status','workspace','executionId','error','requiredParams','complete','truncated','nextCursor','gaps','proof','cleanupErrors','total','view'];
  const ordered=value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries([...priority.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]),...Object.entries(value).filter(([k])=>!priority.includes(k))]):null;
  const out = { ...(ordered ? short(ordered) : { preview: short(value) }),
    modelContext: { compacted: true, originalBytes, budgetBytes: limit, ...(Array.isArray(value?.rows)?{retainedRows:value.rows.length}:{}), ...(id ? { resultId: id, read: { tool: 'result_read', arguments: { id } }, evidenceView: stored } : { evidenceSaved: false, saveError }),
      guidance: 'Preview only; these rows are not the dataset. For arithmetic use result_read with aggregate (sum/count/avg/min/max) and field over all retained rows. Source gaps do not prevent calculations on retained rows; such totals cover retained rows only. For inspection use fields and all=true, or read a JSON pointer (tool_execute if not listed). Save constraints, progress and evidence with context_write. The original tool already ran; do not repeat an action to recover output.' } };
  const numericSummary=require('./result-operations').numericSummary(value?.rows);
  if(numericSummary){out.modelContext.numericSummary=numericSummary;if(bytes(out.modelContext)>limit)delete out.modelContext.numericSummary;}
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
function read({ id, path = '', cursor, max_bytes, all = false, fields, aggregate, field }) {
  const requestedPath=path;
  const transform = fields !== undefined || aggregate !== undefined;
  if (transform && cursor) throw invalid('Projection/aggregation reads all retained rows; omit cursor');
  if (fields !== undefined && aggregate !== undefined) throw invalid('Choose fields or aggregate, not both');
  if (field !== undefined && aggregate === undefined) throw invalid('field requires aggregate');
  if (typeof path !== 'string' || path.length > 2000 || path && !path.startsWith('/')) throw invalid('path must be an RFC 6901 JSON pointer, such as /rows/0');
  const meta=require('./results').toolMeta(id);
  let value, backing;
  if (!meta) {
    const record=require('./results').load(id);if(!record || record.toolResponse)throw missing();
    backing=record.kind==='view'?record.data:{rows:record.rows,total:record.total,truncated:record.truncated};
    value=backing;
  } else if(path || all || transform){const record=require('./results').load(id);if(!record)throw missing();value=backing=record.data;}
  if (transform && !path && !Array.isArray(value) && Array.isArray(value?.rows)) path='/rows';
  const pointer=path?path.slice(1).split('/'):[];
  for (const [index,raw] of pointer.entries()) {
    if (/~(?![01])/.test(raw)) throw invalid('Invalid JSON pointer escape');
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (transform && Array.isArray(value) && index===pointer.length-1 && !Object.hasOwn(value,key) && (fields?.length===1&&fields[0]===key || aggregate&&field===key)) {
      path=path.slice(0,path.lastIndexOf('/'));break;
    }
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw invalid('JSON pointer does not exist in the retained response; use path=/rows with fields=["column"] for an array column, or aggregate and field for arithmetic');
    value = value[key];
  }
  const facts = backing === undefined ? null : require('./tool-output').facts(backing);
  const sourceCoverage = facts ? {status: facts.reasons.length || facts.omissions.length ? 'partial' : 'unknown', provenComplete:false, ...(facts.reasons.length || facts.omissions.length ? {limits:facts.reasons.length?facts.reasons:['retained-output-partial']} : {}), ...(facts.omissions.length ? {omitted:facts.omissions} : {})} : undefined;
  const coverage = {...(sourceCoverage ? {sourceCoverage} : {}),...(requestedPath&&requestedPath!==path?{normalizedFrom:requestedPath}:{})};
  if (transform) {
    if (!Array.isArray(value)) throw invalid('Projection/aggregation requires an array; choose its JSON pointer with path');
    const rows = value.length, read = {tool:'result_read',arguments:{id,path,all:true}};
    if (fields !== undefined) {
      if (!Array.isArray(fields) || !fields.length || fields.length>64 || fields.some(k=>typeof k!=='string'||!k||k.length>200) || new Set(fields).size!==fields.length) throw invalid('fields must be 1–64 unique nonempty field names');
      const selected=value.map((row,i)=>Object.fromEntries(fields.map(k=>{
        if (!row || typeof row!=='object' || !Object.hasOwn(row,k)) throw invalid(`Field ${k} is missing in retained row ${i}; inspect the exact field names`);
        return [k,row[k]];
      })));
      const next=fields.length===1&&selected.every(r=>typeof r[fields[0]]==='number'&&Number.isFinite(r[fields[0]]))?{next:{tool:'result_read',arguments:{id,path,aggregate:'sum',field:fields[0]},guidance:'For a sum of this numeric column, use this call; it computes over all retained rows.'}}:{};
      return {id,path,fields,value:selected,rows,retainedComplete:true,...coverage,...next,read};
    }
    if (!['count','sum','avg','min','max'].includes(aggregate)) throw invalid('aggregate must be count, sum, avg, min or max');
    if (aggregate==='count' && field!==undefined) throw invalid('count counts rows; omit field');
    if (aggregate!=='count' && (typeof field!=='string'||!field||field.length>200)) throw invalid('A numeric aggregate requires the exact field name');
    const answer=require('./result-operations').calculate(value,aggregate,field);
    return {id,path,aggregate,...(field!==undefined?{field}:{}),value:answer,rows,retainedComplete:true,...coverage,read};
  }
  if(all){if(cursor)throw invalid('Use all=true without cursor to read the whole selected value');return {id,path,value,complete:true,completeScope:'retained-value',...coverage};}
  const buffer = path || !meta?Buffer.from(JSON.stringify(path?value:backing)):null,total=buffer?buffer.length:meta.info.bodyBytes,hash = crypto.createHash('sha256').update(id + '\0' + path).digest('hex');
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
  return { id, path, ...coverage, encoding: 'json/utf8', completeScope:'retained-json-bytes', text, startByte: offset, totalBytes: total, complete: next === total,
    nextCursor: next < total ? Buffer.from(JSON.stringify({ hash, offset: next })).toString('base64url') : null };
}
module.exports = { policy, prepare, read };
