// Declarative row selection over captured evidence. This evaluates a declared
// business contract; it never claims that the service executed these predicates.
const { isDeepStrictEqual } = require('node:util');
const invalid = message => require('./durable-private-store').invalid(message);
const own = (o,k) => Object.hasOwn(o,k);
function evidence(value){
  const text=typeof value==='string'?value:JSON.stringify(value);
  return text?.length>1024?{preview:text.slice(0,1024),truncated:true}:value;
}
function validate(rules, probes, pointer) {
  if (!Array.isArray(rules) || rules.length > 10) throw invalid('Use at most 10 selection contracts');
  const ids = new Set();
  for (const s of rules) {
    if (!s || !/^[a-z][a-z0-9-]{0,79}$/.test(s.id || '') || ids.has(s.id) || !probes.has(s.probe)) throw invalid('Selections need unique ids and an existing probe');
    ids.add(s.id);
    if (typeof s.label !== 'string' || s.label.length > 160) throw invalid('Selection needs a short label');
    pointer({},s.row_id); // explicit identity prevents silently conflating duplicate rows
    if (!Array.isArray(s.filters) || s.filters.length > 20 || !Array.isArray(s.order) || !s.order.length || s.order.length > 5 || !Array.isArray(s.fields) || !s.fields.length || s.fields.length > 30) throw invalid('Selection needs filters (0..20), order (1..5) and fields (1..30)');
    for (const f of s.filters) {
      pointer({},f.field);
      if (!['eq','ne','lt','lte','gt','gte','nonblank'].includes(f.op) || f.allow_null !== undefined && typeof f.allow_null !== 'boolean') throw invalid('Unknown selection predicate');
      if (f.op !== 'nonblank') {
        if (own(f,'value') === own(f,'value_from')) throw invalid('Predicate needs exactly one value or value_from response pointer');
        if (own(f,'value_from')) pointer({},f.value_from);
        if (own(f,'value') && f.value !== null && !['string','boolean','number'].includes(typeof f.value)) throw invalid('Predicate values must be JSON scalars');
      }
    }
    for (const o of s.order) { pointer({},o.field); if (!['asc','desc'].includes(o.direction) || o.type !== undefined && !['text','number','integer','date'].includes(o.type)) throw invalid('Order needs asc/desc and optional type text, number, integer or date'); }
    for (const f of s.fields) { pointer({},f.source_path); pointer({},f.response_path); }
    if (s.fallback) {
      if (!probes.has(s.fallback.probe) || !Array.isArray(s.fallback.fields) || !s.fallback.fields.length || s.fallback.fields.length > 30) throw invalid('Fallback needs a probe and fields');
      pointer({},s.fallback.source_path);
      for (const f of s.fallback.fields) { pointer({},f.source_path); pointer({},f.response_path); }
    }
  }
}
function comparable(a,b) { return typeof a === typeof b && (typeof a === 'string' || typeof a === 'number' && Number.isFinite(a) && Number.isFinite(b)); }
function orderedValue(value,type) {
  if(type==='integer') { if(typeof value==='number'&&!Number.isSafeInteger(value)||!['string','number'].includes(typeof value)||!/^[-+]?\d+$/.test(String(value)))return undefined; return BigInt(value); }
  if(type==='number') { if(!['string','number'].includes(typeof value)||String(value).trim()==='')return undefined; const n=Number(value); return Number.isFinite(n)?n:undefined; }
  if(type==='date') { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)return undefined; return value; }
  return value;
}
function evaluate(s, receipts, pointer) {
  const raw = receipts[s.probe], api = receipts.api, gaps = [];
  const result = {id:s.id,label:s.label,probe:s.probe,status:'inconclusive',selected:null,rows:[],comparisons:[],gaps,
    proof:{contractEvaluated:false,runtimeLineageVerified:false,candidateCompletenessVerified:false},notice:'Declared selection over separate read receipts; not observed service execution or an atomic snapshot.'};
  if (raw?.state !== 'done' || api?.state !== 'done' || !Array.isArray(raw.data)) { gaps.push('Completed API and row-array probe receipts are required'); return result; }
  result.proof.contractEvaluated=true;
  if (raw.truncated) gaps.push('Candidate rows are truncated; an unseen row could win');
  if (api.truncated) gaps.push('API response is truncated');
  if (api.httpStatus !== undefined && (api.httpStatus < 200 || api.httpStatus >= 300)) gaps.push('API receipt is not a successful response');
  const candidates = [], ids = new Set();
  for (const row of raw.data) {
    const id = pointer(row,s.row_id), rejected = [], unknown = [];
    if (!id.found || !['string','number'].includes(typeof id.value) || ids.has(String(id.value))) gaps.push('Missing or duplicate row identity');
    ids.add(String(id.value));
    for (const f of s.filters) {
      const a = pointer(row,f.field), b = own(f,'value_from') ? pointer(api.data,f.value_from) : {found:true,value:f.value};
      let passed;
      if (!a.found || f.op !== 'nonblank' && !b.found) unknown.push(f.field + ': missing predicate input');
      else if (a.value === null && f.allow_null === true) passed=true;
      else if (f.op === 'nonblank') passed=typeof a.value==='string'&&a.value.trim().length>0;
      else if (f.op==='eq'||f.op==='ne') passed=isDeepStrictEqual(a.value,b.value)===(f.op==='eq');
      else if (!comparable(a.value,b.value)) unknown.push(f.field + ': incomparable values');
      else passed={lt:()=>a.value<b.value,lte:()=>a.value<=b.value,gt:()=>a.value>b.value,gte:()=>a.value>=b.value}[f.op]();
      if (passed===false) rejected.push({field:f.field,op:f.op,actual:evidence(a.value),expected:evidence(b.value)});
    }
    const state=rejected.length?'excluded':unknown.length?'unknown':'eligible';
    result.rows.push({id:id.value,state,rejected,unknown});
    if (unknown.length&&!rejected.length) gaps.push('A potentially eligible row has unknown predicates');
    if (state==='eligible') candidates.push(row);
  }
  const order = (a,b) => {
    for (const o of s.order) {
      const av=pointer(a,o.field),bv=pointer(b,o.field);
      av.value=orderedValue(av.value,o.type);bv.value=orderedValue(bv.value,o.type);
      const sameInteger=typeof av.value==='bigint'&&typeof bv.value==='bigint';
      if(!av.found||!bv.found||!sameInteger&&!comparable(av.value,bv.value)){gaps.push('Missing or incomparable ordering field '+o.field);continue;}
      if(av.value!==bv.value)return (av.value<bv.value?-1:1)*(o.direction==='desc'?-1:1);
    }
    return 0;
  };
  for(const row of candidates)for(const o of s.order){const v=pointer(row,o.field),n=orderedValue(v.value,o.type);if(!v.found||n===undefined||!['string','number','bigint'].includes(typeof n))gaps.push('Missing or incomparable ordering field '+o.field);}
  candidates.sort(order);
  if(candidates.length>1&&order(candidates[0],candidates[1])===0)gaps.push('Winning rows tie; declare a deterministic tie-break');
  let selected=candidates[0],fields=s.fields;
  if (selected) result.selected={probe:s.probe,id:pointer(selected,s.row_id).value};
  else if(s.fallback){
    const f=receipts[s.fallback.probe],v=pointer(f?.data,s.fallback.source_path);
    if(f?.state!=='done'||f.truncated||!v.found)gaps.push('Fallback source is missing, failed or truncated');
    else {selected=v.value;fields=s.fallback.fields;result.selected={probe:s.fallback.probe,fallback:true};}
  } else gaps.push('No eligible rows and no declared fallback');
  if (selected!==undefined) for(const f of fields){
    const a=pointer(api.data,f.response_path),b=pointer(selected,f.source_path);
    const status=!a.found||!b.found?'missing':isDeepStrictEqual(a.value,b.value)?'equal':'different';
    result.comparisons.push({label:s.label,probe:result.selected?.probe,response_path:f.response_path,source_path:f.source_path,status,response:evidence(a.value),source:evidence(b.value),notice:result.notice});
    if(status==='missing')gaps.push('A mapped field is missing');
  }
  result.gaps=[...new Set(gaps)];
  result.status=result.gaps.length?'inconclusive':result.comparisons.some(c=>c.status==='different')?'different':'equal';
  if(result.gaps.length)result.comparisons=result.comparisons.map(c=>({...c,observed_status:c.status,status:'inconclusive'}));
  return result;
}
module.exports={validate,evaluate};
