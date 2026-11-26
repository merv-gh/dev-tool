// Pure operations over an already retained array: no query, pagination or row sampling.
const invalid=message=>Object.assign(Error(message),{code:'DT_CONTEXT_ARGUMENT',statusCode:400});
function calculate(rows,aggregate,field){
 if(aggregate==='summary')return Object.fromEntries(['count','sum','avg','min','max'].map(op=>[op,calculate(rows,op,field)]));
 let answer=aggregate==='count'?rows.length:aggregate==='sum'?0:null;
 for(let i=0;aggregate!=='count'&&i<rows.length;i++){
  const row=rows[i],n=row&&typeof row==='object'&&Object.hasOwn(row,field)?row[field]:undefined;
  if(typeof n!=='number'||!Number.isFinite(n)||Number.isInteger(n)&&!Number.isSafeInteger(n))throw invalid(`Field ${field} must be a finite, safe number in every retained row; invalid row ${i}. Missing/null/string values are not silently skipped`);
  if(aggregate==='min')answer=answer===null?n:Math.min(answer,n);
  else if(aggregate==='max')answer=answer===null?n:Math.max(answer,n);
  else answer=(answer??0)+n;
  if(!Number.isFinite(answer)||Number.isInteger(answer)&&!Number.isSafeInteger(answer))throw invalid('Aggregate exceeds safe numeric precision; use code with explicit precision');
 }
 if(aggregate==='avg'&&rows.length)answer/=rows.length;
 return answer;
}
function numericSummary(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>100000||!rows[0]||typeof rows[0]!=='object'||Array.isArray(rows[0]))return;
 const fields=[];
 for(const field of Object.keys(rows[0])){
  if(fields.length===4)break;
  if(field.length>40||/^(?:id|.*(?:_id|Id|ID))$/.test(field)||typeof rows[0][field]!=='number')continue;
  try{fields.push([field,{sum:calculate(rows,'sum',field)}]);}catch{/* No partial/coerced totals in a preview. */}
 }
 if(fields.length)return {scope:'all-retained-rows',rows:rows.length,sourceCompleteProven:false,fields:Object.fromEntries(fields)};
}

function normalize(args){
 const out={...args};
 const reference=require('./results').referenceId(out.id);if(reference)out.id=reference;
 if(typeof out.where==='string'){
  if(out.where.length>32768)throw invalid('where JSON exceeds 32768 characters');
  try{out.where=JSON.parse(out.where);}catch{throw invalid('where must be an object of exact field/value pairs; a JSON-encoded object is accepted');}
 }
 return out;
}
function filter(rows,where){
 if(where===undefined)return rows;
 if(!where||typeof where!=='object'||Array.isArray(where)||Object.keys(where).length>32)throw invalid('where must be an object with at most 32 equality filters');
 const entries=Object.entries(where);
 if(!entries.length)return rows;
 for(const [key,v]of entries){
  if(!key||key.length>200||v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v)))throw invalid('where accepts nonempty top-level field names and finite safe primitive values only; values are not coerced');
  if(rows.length&&!rows.some(row=>row&&typeof row==='object'&&Object.hasOwn(row,key)))throw invalid('Filter field '+key+' is absent from the retained rows; inspect the exact field names');
 }
 return rows.filter(row=>row&&typeof row==='object'&&entries.every(([k,v])=>Object.hasOwn(row,k)&&row[k]===v));
}

// A string beginning with an equality operator may still be a legitimate value.
// Never coerce it. Suggest a retry only when the literal matches nothing and
// its JSON scalar RHS demonstrably matches retained rows with the other filters.
function filterDiagnostic(rows,where,selected){
 if(!where||selected.length)return;
 const suggested={...where};let changed=false;
 for(const [key,value]of Object.entries(where)){
  if(typeof value!=='string')continue;
  const match=/^\s*(?:===|==|=)\s*(.+?)\s*$/.exec(value);if(!match)continue;
  try{const scalar=JSON.parse(match[1]);if(scalar===null||['string','number','boolean'].includes(typeof scalar)){suggested[key]=scalar;changed=true;}}catch{/* Preserve unparseable literal values. */}
 }
 if(!changed)return;
 try{const matches=filter(rows,suggested);if(matches.length)return {requestedWhere:where,suggestedWhere:suggested,suggestedMatchedRows:matches.length,meaning:'The original literal filter matched zero rows. The suggested literal values match retained rows; verify their intent before retrying. No filter was changed automatically.'};}catch{/* No suggestion for unsupported/unsafe scalars. */}
}
module.exports={calculate,numericSummary,filter,filterDiagnostic,normalize};
