// The server sees delivered tool bytes, not the client's whole prompt. Estimates
// and optional caller-reported token counts stay advisory and story/session scoped.
const states = new Map(), { digest } = require('./ci-action');
function key(session) { return require('./access').owner().scopeKey + ':' + digest(String(session || require('./trace').current()?.session || require('./access').owner().storyId).slice(0,1000)); }
function state(session) {
  const id = key(session), now = Date.now();
  if (!states.has(id)) {
    if (states.size >= 1024) for (const [k,v] of states) { if (now-v.touched > 3600000 || states.size >= 1024) states.delete(k); if (states.size < 900) break; }
    states.set(id,{bytes:0,calls:0,since:new Date().toISOString(),touched:now});
  }
  const value = states.get(id); value.touched = now; return value;
}
function report(value, session) {
  if (!value) return;
  const r = typeof value === 'string' && value.length < 2048 ? JSON.parse(value) : value;
  if (!r || typeof r !== 'object' || !Number.isSafeInteger(r.usedTokens) || r.usedTokens < 0 || r.usedTokens > 100000000 || r.contextWindow !== undefined && (!Number.isSafeInteger(r.contextWindow) || r.contextWindow < 4096 || r.contextWindow > 10000000) || r.checkpointId !== undefined && (typeof r.checkpointId !== 'string' || r.checkpointId.length > 200)) throw Error('Invalid caller context usage');
  const s = state(session);
  s.reported = {usedTokens:r.usedTokens,...(r.contextWindow?{contextWindow:r.contextWindow}:{}),...(typeof r.model==='string'?{model:r.model.slice(0,200)}:{}),at:new Date().toISOString()}; s.bytesSinceReport = 0;
  if (typeof r.checkpointId === 'string' && r.checkpointId !== s.checkpointId) { s.bytes = 0; s.calls = 0; s.checkpointId = r.checkpointId.slice(0,200); s.since = new Date().toISOString(); }
}
function status(session) {
  const s = state(session), p = require('./chat-context').policy(s.reported?.model), window = s.reported?.contextWindow || p.contextWindow;
  const toolTokens = Math.ceil(s.bytes/3), estimated = s.reported ? s.reported.usedTokens + Math.ceil((s.bytesSinceReport || 0)/3) : null;
  const ratio = (estimated ?? toolTokens)/window, recommended = ratio >= .8;
  return { source:s.reported?'caller-report-plus-tool-estimate':'tool-responses-only',contextWindow:window,reportedUsedTokens:s.reported?.usedTokens??null,estimatedUsedTokens:estimated,estimatedToolTokens:toolTokens,toolResponses:s.calls,since:s.since,
    pressure:recommended?'high':ratio>=.6?'caution':s.reported?'normal':'unknown',compactionRecommended:recommended,advisory:true,
    limitations:'Tool tokens use UTF-8 bytes/3, not a tokenizer. Without client usage, system prompt, tool schemas, user/assistant text and attachments are unknown. Counts begin at process/session observation; a request is not proof of compaction.' };
}
function response(tool, original, {session,usage}={}) {
  const C = require('./chat-context'); let value = C.prepare(tool,original), meta;
  try {
    let reportError;try { report(usage,session); } catch { reportError = 'Caller usage was invalid and ignored'; }
    const s = state(session), bytes = Buffer.byteLength(JSON.stringify(value) || ''); s.bytes += bytes; s.bytesSinceReport = (s.bytesSinceReport || 0)+bytes;s.calls++;
    meta = {...status(session),...(reportError?{reportError}:{})};
    if (meta.compactionRecommended) {
      const hint = {pressure:'high',source:meta.source,contextWindow:meta.contextWindow,estimatedUsedTokens:meta.estimatedUsedTokens,estimatedToolTokens:meta.estimatedToolTokens,advisory:true,next:{tool:'chat_compaction_request',guidance:'Save task progress/checkpoint, then explicitly request compaction. Use native context_compact if available; otherwise ask the client to Compact. Do not claim it happened from this hint.'}};
      const wrap = result => result && typeof result === 'object' && !Array.isArray(result) ? {...result,modelContext:{...result.modelContext,pressure:hint}} : {result,modelContext:{pressure:hint}};
      const limit = require('./config').getTools().modelResultBytes;
      if (limit && Buffer.byteLength(JSON.stringify(wrap(value)))>limit) value=C.prepare(tool,original,{reserveBytes:1024});
      value=wrap(value);
    }
  } catch { meta={source:'unavailable',advisory:true,limitation:'Context diagnostics unavailable; the tool result is still valid'}; }
  return {value,meta};
}
function compactRequest({context,checkpoint}) {
  const C=require('./context');C.get(context);
  const path='compaction/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+require('node:crypto').randomBytes(3).toString('hex')+'.md';
  const saved=C.write({id:context,path,content:checkpoint,summary:'Explicit compaction checkpoint; keep task IDs, constraints, revision pins and next steps',expected_revision:null});
  return {requested:true,compacted:false,context,checkpoint:{path:saved.path,revision:saved.revision},clientAction:{type:'compact',nativeTool:'context_compact',fallback:'/compact'},guidance:'The checkpoint was saved; this server has not compacted the chat. Native Open WebUI context_compact can queue the action for when this reply finishes. Other clients must implement their own compaction action. A request never resets the observed context budget.'};
}
module.exports={status,report,response,compactRequest};
