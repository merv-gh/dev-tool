// A reproducible locator DSL. Values are data passed to a fixed Playwright adapter,
// never executable source supplied by a recipe. Runtime params are never retained.
const ACTIONS = ['navigate','fill','click','select','check','press','wait'];
const text = (v, name, max=2000) => { if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${name} must be non-empty text (max ${max})`);return v; };
function url(value) { const u=new URL(value);if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw Error('UI URL must use http(s) without inline credentials');return value; }
function validate(recipe) {
  if(!recipe||typeof recipe!=='object'||Array.isArray(recipe))throw Error('recipe must be an object');
  if(Buffer.byteLength(JSON.stringify(recipe))>65536)throw Error('recipe exceeds 64 KiB');
  const out={url:url(text(recipe.url,'recipe.url')),steps:[]};
  if(!Array.isArray(recipe.steps)||recipe.steps.length>40)throw Error('recipe.steps must contain at most 40 actions');
  for(const s of recipe.steps){
    if(!ACTIONS.includes(s.action))throw Error('Unsupported UI action');
    if(Object.keys(s).some(k=>!['action','selector','role','name','value','url','checked'].includes(k)))throw Error('Unknown UI action property');
    const step={action:s.action};
    if(s.action==='navigate')step.url=url(text(s.url,'step.url'));
    else { if(s.selector)step.selector=text(s.selector,'selector',500);else{step.role=text(s.role,'role',50);step.name=text(s.name,'accessible name',300);} }
    if(['fill','select','press'].includes(s.action))step.value=text(s.value,'step.value');
    if(s.action==='check')step.checked=s.checked!==false;
    out.steps.push(step);
  }
  // Secrets belong to runtime parameters. Reject credential-bearing URLs and form literals.
  for(const u of [out.url,...out.steps.filter(s=>s.url).map(s=>s.url)])for(const [k,v]of new URL(u).searchParams)if(/token|pass|secret|key|session|auth|code/i.test(k)&&!/^\{\{\w+\}\}$/.test(v))throw Error('Use runtime {{parameters}} for credentials in URLs');
  for(const s of out.steps)if(s.action==='fill'&&!/\{\{\w+\}\}/.test(s.value)&&/pass|secret|token|auth|credential/i.test(s.selector||s.name))throw Error('Credential fields require runtime {{parameters}}');
  return out;
}
function resolve(recipe,params={}) {
  recipe=validate(recipe);if(!params||typeof params!=='object'||Array.isArray(params)||Buffer.byteLength(JSON.stringify(params))>65536)throw Error('Runtime params must be an object up to 64 KiB');
  const names=new Set();
  const fill=v=>v.replace(/\{\{(\w+)\}\}/g,(_,name)=>{names.add(name);if(!Object.hasOwn(params,name)||!['string','number','boolean'].includes(typeof params[name]))throw Error(`Missing runtime parameter ${name}`);return String(params[name]);});
  // Locator identity cannot be parameterized: a value must not change the intended control.
  const out={url:url(fill(recipe.url)),steps:recipe.steps.map(s=>({...s,...(s.value!==undefined?{value:fill(s.value)}:{}),...(s.url?{url:url(fill(s.url))}:{} )}))};
  return out;
}
function code(recipe) {
  return `async (page) => { const recipe=${JSON.stringify(recipe)}; page.setDefaultTimeout(10000); await page.goto(recipe.url,{waitUntil:'domcontentloaded',timeout:20000}); let completed=0; for(const s of recipe.steps){ if(s.action==='navigate')await page.goto(s.url,{waitUntil:'domcontentloaded',timeout:20000}); else {const l=s.selector?page.locator(s.selector):page.getByRole(s.role,{name:s.name,exact:true}); if(s.action==='fill')await l.fill(s.value); else if(s.action==='click')await l.click(); else if(s.action==='select')await l.selectOption(s.value); else if(s.action==='check')await l.setChecked(s.checked); else if(s.action==='press')await l.press(s.value); else await l.waitFor({state:'visible'});} completed++; } return {url:page.url(),completed}; }`;
}
async function capture(recipe,params={}) {
  const resolved=resolve(recipe,params),C=require('./api-client'),E=require('./execution');let session,release=()=>{};
  try{
    E.check();session=(await C.browserOpen({})).session;release=E.resource(()=>C.browserClose({session}));
    const state=await C.browserRecipe({session,recipe:resolved});E.check();
    const shot=await C.browserAction({session,action:'take_screenshot',args:{type:'png',fullPage:false}});E.check();
    const captured=await C.browserCapture({session,source:'Saved UI trace recipe'});E.check();
    // Reuse exchange redaction for the final URL, including sensitive query values.
    const finalUrl=C.normalize({url:state.url||resolved.url},{kind:'ui-state'}).request.url;
    return {state:{url:finalUrl,completed:state.completed,capturedAt:new Date().toISOString(),image:shot.imageData?.[0]||null},exchanges:captured.exchanges,gaps:[...captured.gaps,...(!shot.imageData?.length?[{kind:'screenshot-unavailable',detail:'Browser returned no bounded image'}]:[])]};
  } catch(error) { E.check();throw Object.assign(Error('UI replay failed. Check the page, locators and runtime parameters; no form values were retained.'),{code:'DT_UI_REPLAY_FAILED'}); }
  finally{try{if(session)await C.browserClose({session});}finally{release();}}
}
module.exports={ACTIONS,validate,resolve,code,capture};
