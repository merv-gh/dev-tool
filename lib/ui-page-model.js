// A small data language: exact parameter references, bounded rows and no code/HTML.
const crypto = require('node:crypto');
const invalid = message => Object.assign(Error(message), {code:'DT_ARGUMENT_INVALID',statusCode:400});
const id = value => typeof value==='string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
const READ_TOOLS = ['ui_page_data','pg_query','consul_service','health','es_health','kafka_lag','kafka_topic','kafka_last','catalog_search','find','pg_table','pg_function','pg_usage','api_routes','bitbucket_pr_status'];
const MAX_ROWS=2000, MAX_BYTES=2*1024*1024;
function keys(value, allowed, label) { if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw invalid('Invalid '+label+' fields'); }
function path(value) { if(typeof value!=='string'||value.length>300||value.split('.').some(k=>!k||['__proto__','prototype','constructor'].includes(k)))throw invalid('Invalid field path');return value; }
function at(value, field) { if(field==='')return value;for(const key of path(field).split('.')){if(value==null||!Object.hasOwn(Object(value),key))return undefined;value=value[key];}return value; }
function bind(value, params, depth=0) {
 if(depth>16)throw invalid('Page values are nested too deeply');
 if(Array.isArray(value))return value.map(v=>bind(v,params,depth+1));
 if(value&&typeof value==='object'){
  if(Object.hasOwn(value,'$param')){keys(value,['$param'],'parameter reference');if(!id(value.$param)||!Object.hasOwn(params,value.$param))throw invalid('Unknown page input '+value.$param);return structuredClone(params[value.$param]);}
  return Object.fromEntries(Object.entries(value).map(([k,v])=>{if(['__proto__','prototype','constructor'].includes(k))throw invalid('Unsafe object key');return [k,bind(v,params,depth+1)];}));
 }
 return value;
}
function normalize(definition) {
 let bytes;try{bytes=Buffer.byteLength(JSON.stringify(definition));}catch{throw invalid('Page definition must be JSON');}
 if(bytes>131072)throw invalid('Page definition exceeds 128 KiB');
 keys(definition,['version','title','description','inputs','sources','datasets','widgets'],'page');
 if(definition.version!==1||typeof definition.title!=='string'||!definition.title.trim()||definition.title.length>160)throw invalid('Page version=1 and a title up to 160 characters are required');
 if(definition.description!==undefined&&(typeof definition.description!=='string'||definition.description.length>4000))throw invalid('Page description exceeds 4000 characters');
 const d=structuredClone({description:'',inputs:{},datasets:[],...definition});
 keys(d.inputs,Object.keys(d.inputs),'inputs');if(Object.keys(d.inputs).length>12)throw invalid('At most 12 page inputs are supported');
 for(const [name,input]of Object.entries(d.inputs)){
  if(!id(name)||require('./redact').sensitive(name))throw invalid('Input names must be simple identifiers, never credentials');
  keys(input,['type','label','default','required','options','description','environment'],'input');
  if(!['string','number','boolean','environment','database','services','strings'].includes(input.type)||typeof input.label!=='string'||!input.label||input.label.length>160)throw invalid('Each input needs a type and label');
  if(input.options!==undefined&&(!Array.isArray(input.options)||input.options.length>100||input.options.some(x=>!['string','number','boolean'].includes(typeof x))))throw invalid('Invalid input options');
 }
 for(const input of Object.values(d.inputs))if(input.environment!==undefined&&(input.type!=='database'||d.inputs[input.environment]?.type!=='environment'))throw invalid('A database input environment must name an environment input');
 if(!Array.isArray(d.sources)||d.sources.length>16||!Array.isArray(d.datasets)||d.datasets.length>24||!Array.isArray(d.widgets)||!d.widgets.length||d.widgets.length>30)throw invalid('Pages support 16 sources, 24 datasets and 1..30 widgets');
 const known=new Set();
 for(const s of d.sources){
  keys(s,['id','label','tool','arguments','select','rows'],'source');if(!id(s.id)||known.has(s.id))throw invalid('Source IDs must be unique');known.add(s.id);
  if(s.rows!==undefined){if(s.tool||!Array.isArray(s.rows)||s.rows.length>200)throw invalid('Declared rows allow at most 200 records and no tool');}
  else{if(!READ_TOOLS.includes(s.tool))throw invalid('Unsupported page source tool: '+s.tool);keys(s.arguments||{},Object.keys(s.arguments||{}),'source arguments');}
  if(s.select!==undefined&&s.select!=='')path(s.select);
 }
 for(const data of d.datasets){
  keys(data,['id','op','from','fields','left','right','key','where','required'],'dataset');if(!id(data.id)||known.has(data.id)||!['select','concat','filter','compare'].includes(data.op))throw invalid('Invalid dataset id or operation');
  const refs=data.op==='compare'?[data.left,data.right]:data.op==='concat'?data.from:[data.from];if(!Array.isArray(refs)||!refs.length||refs.length>16||refs.some(r=>!known.has(r)))throw invalid('Datasets must reference earlier sources/datasets');
  if(data.op==='select'){keys(data.fields,Object.keys(data.fields||{}),'selected fields');if(Object.keys(data.fields).length>40)throw invalid('At most 40 selected fields');for(const [key,value]of Object.entries(data.fields)){if(!id(key))throw invalid('Invalid selected field');if(typeof value==='string')path(value);else keys(value,['value'],'literal field');}}
  if(data.op==='compare'){if(!Array.isArray(data.key)||!data.key.length||data.key.length>8||!Array.isArray(data.fields)||data.fields.length>30)throw invalid('Comparison requires key and fields arrays');[...data.key,...data.fields].forEach(path);if(data.required!==undefined&&(!Array.isArray(data.required)||data.required.some(f=>!data.fields.includes(f))))throw invalid('Required comparison fields must be declared fields');}
  if(data.op==='filter')validateWhere(data.where);
  known.add(data.id);
 }
 const widgets=new Set();for(const w of d.widgets){
  keys(w,['id','type','title','description','data','text','columns','field','op','where','unit','span','collapsed','leftLabel','rightLabel'],'widget');
  if(!id(w.id)||widgets.has(w.id)||!['text','table','metric','comparison'].includes(w.type)||typeof w.title!=='string'||!w.title||w.title.length>160)throw invalid('Each widget needs a unique id, type and title');widgets.add(w.id);
  if(w.type!=='text'&&!known.has(w.data))throw invalid('Unknown widget dataset '+w.data);
  if(w.type==='text'&&(typeof w.text!=='string'||w.text.length>6000))throw invalid('Text widgets need plain text up to 6000 characters');
  if(w.span!==undefined&&![1,2].includes(w.span))throw invalid('Widget span must be 1 or 2');
  if(w.field!==undefined)path(w.field);if(w.where)validateWhere(w.where);
  if(w.type==='metric'&&!['count','sum','value'].includes(w.op||'count'))throw invalid('Metric operation must be count, sum or value');
  if(w.columns!==undefined){if(!Array.isArray(w.columns)||w.columns.length>30)throw invalid('At most 30 table columns');for(const c of w.columns){keys(c,['field','label','format'],'column');path(c.field);if(typeof c.label!=='string'||c.label.length>160||c.format&&!['text','number','status','json','time'].includes(c.format))throw invalid('Invalid table column');}}
 }
 const refs={};for(const [name,input]of Object.entries(d.inputs))refs[name]=Object.hasOwn(input,'default')?input.default:null;bind(d,refs);
 if(JSON.stringify(require('./redact').clean(d))!==JSON.stringify(d))throw invalid('Keep credentials in configured integrations, not page definitions');
 return d;
}
function validateWhere(where){keys(where,['field','op','value'],'filter');path(where.field);if(!['eq','ne','contains','gt','lt','exists'].includes(where.op))throw invalid('Invalid filter operator');}
function matches(row,where){if(!where)return true;const v=at(row,where.field),x=where.value;switch(where.op){case 'eq':return stable(v)===stable(x);case 'ne':return stable(v)!==stable(x);case 'contains':return String(v??'').toLowerCase().includes(String(x??'').toLowerCase());case 'gt':return v!=null&&Number(v)>Number(x);case 'lt':return v!=null&&Number(v)<Number(x);case 'exists':return v!==undefined&&v!==null;}}
function params(definition, supplied={}){
 keys(supplied,Object.keys(definition.inputs),'input values');const out={};
 for(const [name,input]of Object.entries(definition.inputs)){
  const value=Object.hasOwn(supplied,name)?supplied[name]:input.default;
  if(value===undefined||value===''||Array.isArray(value)&&!value.length){if(input.required!==false)throw invalid('Choose '+input.label);out[name]=value;continue;}
  const valid=['services','strings'].includes(input.type)?Array.isArray(value)&&value.length<=20&&value.every(v=>typeof v==='string'&&v.length<=300):input.type==='number'?typeof value==='number'&&Number.isFinite(value):input.type==='boolean'?typeof value==='boolean':typeof value==='string'&&value.length<=2000;
  if(!valid||input.options&&!input.options.some(o=>stable(o)===stable(value)))throw invalid('Invalid value for '+input.label);
  if(input.type==='environment')require('./config').getEnv(value);
  out[name]=value;
 }
 for(const [name,input]of Object.entries(definition.inputs))if(input.type==='database'&&input.environment&&out[name]&&!require('./config').getEnv(out[input.environment]).pg[out[name]])throw invalid('Database '+out[name]+' is not configured for '+out[input.environment]);
 return out;
}
const stable=value=>value===undefined?'undefined':JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function bounded(rows, {complete=true,gaps=[],...meta}={}){
 if(!Array.isArray(rows))throw invalid('Source selection must be an array of rows');
 const kept=[];let bytes=0;for(const row of rows){const size=Buffer.byteLength(JSON.stringify(row)??'null');if(kept.length>=MAX_ROWS||bytes+size>MAX_BYTES){complete=false;gaps=[...gaps,'Dataset clipped at 2,000 rows or 2 MiB'];break;}kept.push(row);bytes+=size;}
 return {rows:kept,complete,gaps,...meta};
}
function derive(definition, sources, inputs){
 const out={...sources};for(const raw of definition.datasets){const d=bind(raw,inputs),refs=d.op==='compare'?[d.left,d.right]:d.op==='concat'?d.from:[d.from],from=refs.map(r=>out[r]);
  const problems=from.flatMap((s,i)=>s.error?[refs[i]+': '+s.error]:[]);if(problems.length){out[d.id]={rows:[],complete:false,error:'Upstream source unavailable',gaps:problems};continue;}
  const meta={complete:from.every(s=>s.complete),gaps:[...new Set(from.flatMap(s=>s.gaps||[]))]};
  try{
   let rows;
   if(d.op==='concat')rows=from.flatMap(s=>s.rows);
   if(d.op==='select')rows=from[0].rows.map(row=>Object.fromEntries(Object.entries(d.fields).map(([key,v])=>[key,typeof v==='string'?at(row,v):v.value])));
   if(d.op==='filter')rows=from[0].rows.filter(row=>matches(row,d.where));
   if(d.op==='compare'){
    const index=source=>{const m=new Map();for(const row of source.rows){const values=d.key.map(k=>at(row,k));if(values.some(v=>v===undefined||v===null))throw invalid('Comparison key is missing');const key=stable(values);if(m.has(key))throw invalid('Duplicate comparison key; include overload arguments or a stronger identity');m.set(key,row);}return m;};
    const left=index(from[0]),right=index(from[1]);rows=[...new Set([...left.keys(),...right.keys()])].sort().map(k=>{const before=left.get(k),after=right.get(k),changes=before&&after?d.fields.filter(f=>stable(at(before,f))!==stable(at(after,f))):[],unknown=before&&after&&(d.required||[]).some(f=>[at(before,f),at(after,f)].some(v=>v==null||v===''));return {key:Object.fromEntries(d.key.map(f=>[f,at(before||after,f)])),status:!before?(from[0].complete?'only-right':'unknown'):!after?(from[1].complete?'only-left':'unknown'):unknown?'unknown':changes.length?'changed':'same',before:before||null,after:after||null,changes};});
   }
   out[d.id]=bounded(rows,meta);
  }catch(e){out[d.id]={rows:[],complete:false,error:e.message,gaps:meta.gaps};}
 }
 return out;
}
module.exports={normalize,params,bind,derive,at,matches,bounded,stable,invalid,id,READ_TOOLS,MAX_ROWS,digest:value=>crypto.createHash('sha256').update(stable(value)).digest('hex')};
