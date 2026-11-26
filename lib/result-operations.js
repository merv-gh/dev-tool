// Pure operations over an already retained array: no query, pagination or row sampling.
const invalid=message=>Object.assign(Error(message),{code:'DT_CONTEXT_ARGUMENT',statusCode:400});
function calculate(rows,aggregate,field){
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
module.exports={calculate,numericSummary};
