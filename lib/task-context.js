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
// Operational request dumps stay recoverable by exact path, but should not
// outrank authored notes when the model is trying to continue its actual work.
function memoryIndex(files,query='',includeInternal=false){
 const internal=f=>/^runs\/[^/]+\/(?:requests|transcripts)\//.test(f.path)||/^runs\/[^/]+\/transcript-\d+\.json$/.test(f.path);
 const terms=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)||[])];
 const priority=f=>/\/notes\//.test(f.path)?3:f.path==='progress.md'?2:/\/evidence\//.test(f.path)?1:0;
 const visible=files.filter(f=>includeInternal||!internal(f)).map(f=>{const text=(f.path+' '+(f.summary||'')).toLowerCase();return {file:f,score:terms.reduce((n,t)=>n+(text.includes(t)?1:0),0)+(query&&text.includes(query.toLowerCase())?terms.length:0)};}).filter(r=>!terms.length||r.score>0).sort((a,b)=>b.score-a.score||priority(b.file)-priority(a.file)||a.file.path.localeCompare(b.file.path));
 return {total:visible.length,files:visible.slice(0,80).map(r=>r.file),truncated:visible.length>80,internalFiles:files.filter(internal).length};
}
function anchors(r){
 return {savedNotes:{total:r.notes.length,latest:r.notes.slice(-30).map(p=>'runs/'+r.id+'/notes/'+p)},recentReceipts:r.events.filter(e=>e.type==='tool.completed'&&typeof e.tool==='string'&&typeof e.artifact==='string'&&!e.tool.startsWith('task_memory')).slice(-4).map(e=>({tool:e.tool,path:'runs/'+r.id+'/'+e.artifact,toolError:!!e.failed}))};
}
module.exports.memoryIndex=memoryIndex;
module.exports.anchors=anchors;
