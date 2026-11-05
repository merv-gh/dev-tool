// Named server-side bearer references. Browser/model payloads never contain their values.
const C = require('./config');
const invalid = message => Object.assign(new Error(message), { code: 'DT_ARGUMENT_INVALID', statusCode: 400 });
function entries() {
  const snapshot=C.snapshot(), configured=snapshot.raw.api?.authProfiles || {}, lookup=snapshot.lookup();
  return Object.entries(configured).map(([id,p])=>{
    if(!/^[a-zA-Z0-9][\w.-]{0,79}$/.test(id)||!p||typeof p!=='object')throw invalid('Invalid API authentication profile');
    let url;try{url=new URL(C.interpolate(p.url,lookup));}catch{throw invalid('API authentication profiles require a scoped HTTP(S) URL');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw invalid('Invalid API authentication URL scope');
    // Only explicit ${NAME} references are accepted; a config GET cannot reveal a token.
    const ref=typeof p.bearerToken==='string'&&p.bearerToken.match(/^\$\{([A-Za-z_]\w*)\}$/);
    if(!ref)throw invalid('API bearerToken must reference an environment variable, for example ${DEV_API_TOKEN}');
    return{id,label:String(p.label||id).slice(0,120),url:url.href,autoPrefill:p.autoPrefill===true,variable:ref[1],value:lookup(ref[1])};
  });
}
function matches(profile,target) {
  try{const base=new URL(profile.url),url=new URL(target),prefix=base.pathname.replace(/\/$/,'');return !url.username&&!url.password&&url.origin===base.origin&&(!prefix||url.pathname===prefix||url.pathname.startsWith(prefix+'/'));}catch{return false;}
}
function list({url}={}) {
  return{profiles:entries().map(({value,variable,...p})=>({...p,configured:typeof value==='string'&&!!value&&!/[\r\n]/.test(value),...(url?{matches:matches(p,url)}:{})})),note:'Bearer values are resolved only when sending to the configured URL scope. They are never returned to this explorer.'};
}
function apply(id,request) {
  if(!id)return request;
  const p=entries().find(p=>p.id===id);
  if(!p)throw invalid('Unknown API authentication profile');
  if(!matches(p,request.url))throw invalid('The selected bearer profile does not match this request URL');
  if(typeof p.value!=='string'||!p.value||/[\r\n]/.test(p.value))throw invalid('The bearer environment reference is missing or invalid');
  if(Object.keys(request.headers||{}).some(h=>h.toLowerCase()==='authorization'))throw invalid('Remove the request Authorization header before selecting a configured bearer profile');
  return{...request,headers:{...request.headers,authorization:'Bearer '+p.value}};
}
module.exports={list,apply,matches};
