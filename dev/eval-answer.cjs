// Parse only explicit final facts; no expected values or retrieved tool data.
function atom(raw,type,name){
 if(type==='boolean'){if(typeof raw==='boolean')return raw;if(typeof raw==='string'&&/^(true|false)$/i.test(raw.trim()))return raw.trim().toLowerCase()==='true';return undefined;}
 if(type==='number'){if(typeof raw==='number'&&Number.isFinite(raw))return raw;if(typeof raw==='string'&&/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw.trim())){const n=Number(raw);if(Number.isFinite(n))return n;}return undefined;}
 if(typeof raw!=='string')return undefined;
 const text=raw.trim();
 if(name==='view'||/View$/.test(name)){const link=/^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/.exec(text);return link?link[1]:text;}
 return text;
}
function lineValue(raw,type,name){
 const text=raw.trim();let quoted=/^"(?:\\.|[^"\\])*"/.exec(text);
 if(quoted)try{return atom(JSON.parse(quoted[0]),type,name);}catch{}
 quoted=/^['\x60]([^'\x60]*)['\x60]/.exec(text);
 if(quoted)return atom(quoted[1],type,name);
 if(type==='boolean'){const m=/^(true|false)\b/i.exec(text);return m?atom(m[1],type,name):undefined;}
 if(type==='number'){const m=/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?=\s|$|[)\]])/.exec(text);return m?atom(m[0],type,name):undefined;}
 if(name==='view'||/View$/.test(name)){const m=/https?:\/\/[^\s)\]>"'\x60]+/.exec(text);return m?m[0]:undefined;}
 return atom(text.replace(/\s+\(.*$/,''),type,name);
}
function parse(text,types){
 text=String(text||'');let json,jsonOnly=false;const candidates=[],dict=v=>v&&typeof v==='object'&&!Array.isArray(v);
 try{json=JSON.parse(text.replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/g,''));jsonOnly=true;if(dict(json))candidates.push(json);}catch{}
 for(const m of text.matchAll(/\x60{3}(?:json)?\s*([\s\S]*?)\x60{3}/g))try{const v=JSON.parse(m[1]);if(dict(v)&&Object.keys(types).some(k=>Object.hasOwn(v,k)))candidates.push(v);}catch{}
 if(!dict(json))json=candidates[0];
 const answer=dict(json)?{...json}:{},normalized=[],supplemented=[],conflicts=[];
 const add=(key,raw,source)=>{
  const value=atom(raw,types[key],key);if(value===undefined)return;
  if(Object.hasOwn(answer,key)){
   const previous=atom(answer[key],types[key],key);
   if(previous!==undefined&&!Object.is(previous,answer[key])){answer[key]=previous;normalized.push(key);}
   if(!Object.is(answer[key],value))conflicts.push(key);
  }else{answer[key]=value;if(source==='named')supplemented.push(key);}
 };
 for(const [key,type]of Object.entries(types))if(Object.hasOwn(answer,key)){const v=atom(answer[key],type,key);if(v!==undefined&&!Object.is(v,answer[key])){answer[key]=v;normalized.push(key);}}
 for(const candidate of candidates)for(const key of Object.keys(types))if(Object.hasOwn(candidate,key))add(key,candidate[key],'json');
 for(const line of text.split('\n')){
  const cleaned=line.trim().replace(/^[-*]\s+/,'');
  let m=/^(?:\*\*|__|\x60)?([A-Za-z][A-Za-z0-9_]*)(?:\*\*|__|\x60)?\s*:(?:\*\*|__)?\s*(.+)$/.exec(cleaned);
  if(!m)m=/^\|\s*([A-Za-z][A-Za-z0-9_]*)\s*\|\s*([^|]+)\|/.exec(cleaned);
  if(!m)continue;const key=Object.keys(types).find(k=>k.toLowerCase()===m[1].toLowerCase());if(!key)continue;
  const value=lineValue(m[2],types[key],key);if(value!==undefined)add(key,value,'named');
 }
 return {answer,json,jsonOnly,formatCompliant:jsonOnly&&!!dict(json)&&!normalized.length&&!supplemented.length&&!conflicts.length,normalized:[...new Set(normalized)],supplemented:[...new Set(supplemented)],conflicts:[...new Set(conflicts)]};
}
module.exports={parse};
