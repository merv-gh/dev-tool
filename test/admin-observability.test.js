const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(api){const elements=new Map(),buttons=['activity','traces','coverage'].map(mode=>({dataset:{diagnosticsMode:mode},setAttribute(){}}));const $=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,replaceChildren(){this.textContent='';}});return elements.get(id);};let render;
 const c=vm.createContext({$,api,DTState:require('../lib/state-machine'),runtimeScopeVersion:new(require('../lib/state-machine').Revision)(),DTDiagnostics:{traces:(el,value)=>{render=value;},coverage:(el,value)=>{render=value;}},document:{addEventListener(){},querySelectorAll:()=>buttons}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/admin-observability.js'),'utf8'),c);return{$,buttons,run:code=>vm.runInContext(code,c),render:()=>render};}
test('switching views and scopes cannot deliver old trace evidence into the new selection',async()=>{
 let release;const late=new Promise(r=>release=r),h=harness(url=>url.endsWith('observability')?late:Promise.resolve({report:'coverage'}));
 const loading=h.run("diagnosticsSelect('traces')");h.run("diagnosticsSelect('coverage')");await new Promise(r=>setImmediate(r));release({enabled:true,old:true});await loading;await new Promise(r=>setImmediate(r));assert.deepEqual(h.render(),{report:'coverage'});
 let resolve;const pending=new Promise(r=>resolve=r),other=harness(()=>pending);other.run("diagnosticsSelect('traces')");other.run('runtimeScopeVersion.advance();diagnosticsRequests.advance()');resolve({old:true});await new Promise(r=>setImmediate(r));assert.equal(other.render(),undefined);
});
test('tracing remains off until an explicit user click sends the preference',async()=>{
 const calls=[],h=harness(async(url,body)=>{calls.push(body);return{enabled:false};});h.run('diagnosticsInit()');assert.equal(calls.length,0);await h.run("diagnosticsSelect('traces')");await new Promise(r=>setImmediate(r));assert.ok(calls.every(body=>body===undefined));await h.$('dgTraceToggle').onclick();assert.ok(calls.some(body=>body?.enabled===true));
});
