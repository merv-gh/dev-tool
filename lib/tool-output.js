// Presentation metadata describes the returned value, separately from source coverage.
// Internal API/script values stay unchanged unless all=true is explicitly requested.
const ALL = { type: 'boolean', description: 'Full available output; source and model context limits apply.' };
const canonicalName = name => name === 'search_tools' ? 'tool_search' : name;
function full(value, depth = 0) {
  // A retained read/projection already contains its complete selected value.
  // Its data may itself have a business field named view; never reinterpret it.
  if(value?.completeScope==='retained-value'||value?.retainedComplete===true||value?.output?.status==='all'&&value.output.scope==='retained-evidence')return value;
  if(depth<3 && value && typeof value==='object' && !Array.isArray(value))for(const key of ['result','value'])if(value[key]&&typeof value[key]==='object')value={...value,[key]:full(value[key],depth+1)};
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.view !== 'string') return value;
  const id = require('./results').referenceId(value.view);
  const record = id && require('./results').load(id);
  if (!record) return value;
  if (Array.isArray(record.rows)) {
    if(Array.isArray(value.rows)&&value.rows.length>=record.rows.length)return value;
    return { ...value, rows: record.rows, ...(record.truncated ? { truncated: true } : {}) };
  }
  if (record.kind === 'view' && record.data && typeof record.data === 'object') {
    if(Array.isArray(record.data))return {...value,data:record.data};
    const result={...value,...record.data,view:value.view};
    if(value.counts&&record.data.counts&&typeof value.counts==='object'&&typeof record.data.counts==='object'&&!Array.isArray(value.counts)&&!Array.isArray(record.data.counts))result.counts={...value.counts,...record.data.counts};
    for(const key of ['omitted','previewTruncated','summaryTruncated','moreFailures','moreParts','shown'])if(!Object.hasOwn(record.data,key))delete result[key];
    if(value.outputBudgetBytes&&!Object.hasOwn(record.data,'truncated'))delete result.truncated;
    return result;
  }
  return value;
}
function facts(value) {
  const reasons = new Set(), omissions = new Set();
  const seen = new Set();
  function visit(v, depth = 0) {
    if (!v || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); return; }
    if(depth<3 && typeof v.view==='string'){
      const id=require('./results').referenceId(v.view),record=id&&require('./results').load(id),data=record?.data;
      if(data&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).some(k=>data[k]!==undefined && (v[k]===undefined || Array.isArray(data[k])&&Array.isArray(v[k])&&data[k].length>v[k].length)))omissions.add('retained-details');
    }
    if (v.truncated === true || v.previewTruncated === true || v.summaryTruncated === true) reasons.add('source-or-tool-limit');
    if(v.sourceCoverage?.status==='partial') for(const reason of v.sourceCoverage.limits?.length?v.sourceCoverage.limits:['incomplete-source']) reasons.add(reason);
    if (v.complete === false && !v.completeScope || v.traversalComplete === false) reasons.add('incomplete-source');
    if(v.completeScope==='retained-json-bytes'&&!v.complete)omissions.add('retained-json-bytes');
    if ((v.nextCursor || v.continuation)&&!v.completeScope) reasons.add('more-pages');
    if (Number.isFinite(v.totalHits) && Number.isFinite(v.total) && v.totalHits > v.total) reasons.add('query-limit');
    if (v.omitted && Object.values(v.omitted).some(n => typeof n === 'number' && n > 0)) omissions.add('tool-preview');
    for (const key of ['rows','results','nodes','edges','fields','tools','scripts','matches','samples','usedBy','uses']) {
      const n = v[key]?.length;
      const total = key === 'rows' || key === 'results' || key === 'tools' || key === 'scripts' || key === 'matches' ? v.total : v[key + 'Total'];
      if (Array.isArray(v[key]) && Number.isFinite(total) && total > n) omissions.add(key);
    }
    if (Number.isFinite(v.shown) && Number.isFinite(v.total) && v.shown < v.total) omissions.add('items');
    if(Number.isFinite(v.lines)&&Number.isFinite(v.to)&&(v.to<v.lines || v.from>1))omissions.add('lines');
    for (const [k, x] of Object.entries(v)) {
      if (/^(moreFailures|moreParts|usedByTotal)$/.test(k) && x > (k === 'usedByTotal' ? (v.usedBy?.length || 0) : 0)) omissions.add(k);
      if (typeof x === 'string' && /\[(?:\d+ more chars|preview)\]|\.\.\. \(cut\)|… \(\d+ chars\)/.test(x)) omissions.add('text');
      const retainedPayload=k==='value'&&(v.completeScope==='retained-value'||v.retainedComplete===true);
      if (!retainedPayload&&!['modelContext', 'view', 'read', 'next', 'inputSchema', 'resultSchema','rows'].includes(k)) visit(x, depth + 1);
    }
  }
  visit(value);
  return { reasons: [...reasons], omissions: [...omissions] };
}
function annotate(original, delivered, { all = false } = {}) {
  const { reasons, omissions } = facts(original);
  const compacted = !!delivered?.modelContext?.compacted;
  const retainedReceipt=original?.retainedComplete===true||!!original?.completeScope||original?.output?.status==='all'&&original.output.scope==='retained-evidence';
  const output = {
    status: compacted || !retainedReceipt&&reasons.includes('source-or-tool-limit') ? 'truncated' : omissions.length || reasons.includes('more-pages') ? 'part' : 'all',
    source: reasons.length ? 'partial' : 'unknown',
    ...(reasons.length ? { limits: reasons } : {}),
    ...(omissions.length ? { omitted: omissions } : {}),
    ...(all ? { requestedAll: true } : {}),
  };
  const value = delivered && typeof delivered === 'object' && !Array.isArray(delivered) ? delivered : { result: delivered };
  return { ...value, modelContext: { ...value.modelContext, output } };
}
module.exports = { ALL, canonicalName, full, facts, annotate };
