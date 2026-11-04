const { parentPort, workerData } = require('worker_threads');
const { getQuickJS } = require('quickjs-emscripten');
const { diffLists, diffLines } = require('./diff');
(async () => {
  const { code, data = {}, timeoutMs } = workerData;
  const deadline = Date.now() + timeoutMs;
  const module = await getQuickJS(), runtime = module.newRuntime();
  runtime.setMemoryLimit(64 * 1048576); runtime.setMaxStackSize(512 * 1024); runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  let promise;
  try {
    const emit = vm.newFunction('__dtEmit', (kind, text) => { parentPort.postMessage({ event: 'output', value: { kind: vm.getString(kind), text: vm.getString(text) } }); return vm.undefined; });
    vm.setProp(vm.global, '__dtEmit', emit); emit.dispose();
    const uuid = vm.newFunction('__dtUUID', () => vm.newString(require('crypto').randomUUID())); vm.setProp(vm.global, '__dtUUID', uuid); uuid.dispose();
    const source = `
${diffLists.toString()}
${diffLines.toString()}
(async () => {
  const input = ${JSON.stringify(data)}, vars = input.vars || {}, args = input.args, result = input.result;
  const logs = [], output = [], tests = [], pending = []; let bytes = 0;
  const fmt = v => typeof v === 'string' ? v : JSON.stringify(v);
  function emit(kind, a) { const text = a.map(v => typeof v === 'string' ? v : JSON.stringify(v, null, kind === 'text' ? 2 : 0)).join(' '); bytes += unescape(encodeURIComponent(text)).length; if (bytes > 1048576) throw Error('code output exceeds 1 MB; summarize results or save them to context files'); (kind === 'text' ? output : logs).push(text); __dtEmit(kind,text); }
  const log = (...a) => emit('log',a), text = (...a) => emit('text',a), console = { log,info:log,warn:log,error:log,debug:log,dir:log,table:log,trace:log };
  const unavailable = () => { throw Error('QuickJS prototype supports pure transforms; use engine=node for tools, nearby files, or network fetch'); };
  const tools = new Proxy({}, {get:(_, k) => k === 'then' ? undefined : unavailable}), files = tools, fetch = unavailable;
  const uuid = __dtUUID, now = () => new Date().toISOString(), pad = (n,w=2) => String(n).padStart(w,'0');
  const date = (f='YYYY-MM-DD',d=new Date()) => f.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g,t=>({YYYY:d.getFullYear(),MM:pad(d.getMonth()+1),DD:pad(d.getDate()),HH:pad(d.getHours()),mm:pad(d.getMinutes()),ss:pad(d.getSeconds()),SSS:pad(d.getMilliseconds(),3)}[t]));
  const rand = (n=6) => Array.from({length:n},()=>Math.floor(Math.random()*10)).join('').replace(/^0/,'1');
  const hex = (n=8) => Array.from({length:n},()=>Math.floor(Math.random()*16).toString(16)).join('');
  const assert = (ok,msg) => {if(!ok)throw Error(msg||'assertion failed');};
  const expect = v => { const m = neg => ({toBe:x=>assert((v===x)!==neg,'expected '+fmt(v)+' to be '+fmt(x)),toEqual:x=>assert((JSON.stringify(v)===JSON.stringify(x))!==neg,'expected values to equal'),toMatch:r=>assert(new RegExp(r).test(String(v))!==neg,'expected value to match'),toContain:x=>assert((v!=null&&v.includes(x))!==neg,'expected value to contain'),toBeTruthy:()=>assert(!!v!==neg,'expected truthy value'),toBeGreaterThan:x=>assert((v>x)!==neg,'expected greater value'),toHaveProperty:k=>assert((v!=null&&k.split('.').reduce((o,p)=>o==null?undefined:o[p],v)!==undefined)!==neg,'expected property')}); return Object.assign(m(false),{not:m(true)}); };
  const test = (name, fn) => { const done = error => tests.push(error?{name,ok:false,error:error.message||String(error)}:{name,ok:true}); try { const r=fn(); if(r&&typeof r.then==='function')pending.push(r.then(()=>done(),done));else done();}catch(e){done(e);} };
  const out = {vars,args,result,logs,tests,output};
  try { const fn = async () => { ${code}\n }; const r = await fn(); await Promise.all(pending); if(r!==undefined){out.returned=r;out.hasReturn=true;} }
  catch(e){out.error=e.message||String(e);}
  try{return JSON.stringify(out);}catch(e){return JSON.stringify({logs,tests,output,error:'result is not JSON: '+e.message});}
})()`;
    promise = vm.unwrapResult(vm.evalCode(source, 'cell.js'));
    while (true) {
      const state = vm.getPromiseState(promise);
      if (state.type === 'fulfilled') { const result = JSON.parse(vm.getString(state.value)); state.value.dispose(); parentPort.postMessage({ ok: true, result }); break; }
      if (state.type === 'rejected') { const e = vm.dump(state.error); state.error.dispose(); throw new Error(e?.message || String(e)); }
      if (Date.now() > deadline) throw new Error(`stopped after ${timeoutMs}ms`);
      const jobs = runtime.executePendingJobs(1000); if (jobs.error) { const error = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(error?.message || String(error)); }
      if (!jobs.value) await new Promise(resolve => setTimeout(resolve, 1));
    }
  } finally { promise?.dispose(); vm.dispose(); runtime.dispose(); }
})().catch(e => parentPort.postMessage({ ok: false, error: e.message }));
