const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-capability-ui-test-'));for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_TOOL_PROFILE'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{},uat:{}},scripts:{starters:false}}));
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.style={removeProperty:k=>delete this.style[k]};this.dataset={};this.className='';this._text='';this.scrollLeft=this.scrollTop=0;this.clientWidth=800;this.clientHeight=600;this.classList={toggle:(k,on)=>{const s=new Set(this.className.split(' '));if(on)s.add(k);else s.delete(k);this.className=[...s].join(' ');}};}
 set innerHTML(_){assert.fail('Untrusted registry strings must be rendered with textContent');}
 set textContent(t){this._text=String(t);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=nodes;}
 setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=v;if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;}getAttribute(k){return this.attributes[k]??null;}
 querySelectorAll(selector){return this.children.flatMap(n=>[...(selector==='[data-tool]'&&n.attributes['data-tool']?[n]:[]),...n.querySelectorAll(selector)]);}
 cloneNode(deep){const n=new Node(this.tag);n._text=this._text;n.attributes={...this.attributes};n.style.width=this.style.width;n.style.height=this.style.height;if(deep)n.children=this.children.map(c=>c.cloneNode(true));return n;}
 contains(n){return all(this).includes(n);}focus(){this.focused=true;}scrollIntoView(){this.revealed=true;}
 closest(){return null;}click(){this.onclick?.();}select(){this.selected=true;}setPointerCapture(){}addEventListener(){}
}
const all=n=>[n,...n.children.flatMap(all)],byText=(host,tag,text)=>all(host).find(n=>n.tag===tag&&n.textContent===text);
function harness(request){
 const host=new Node('div'),events=[],history=[],downloads=[],serialized=[];const context=vm.createContext({console,document:{createElement:t=>{const n=new Node(t);if(t==='a')n.click=()=>downloads.push({href:n.href,name:n.download});return n;},createElementNS:(_,t)=>new Node(t),addEventListener:(name,fn)=>events.push([name,fn])},DTState:require('../web/state-machine'),dtCapabilityLayout:require('../web/capability-layout'),getComputedStyle:()=>({getPropertyValue:()=>''}),ResizeObserver:class{observe(){}disconnect(){}},location:{href:'http://localhost/admin#capabilities',hash:'#capabilities?object=table'},navigator:{},URL,URLSearchParams,Blob,setTimeout:fn=>{fn();return 1;},clearTimeout(){},XMLSerializer:class{serializeToString(n){serialized.push(n);return '<svg/>';}},$:()=>host,env:()=> 'dev',adminRequestScope:()=> 'one',runtimeStory:'one',api:request,history:{replaceState:(_,__,url)=>history.push(url)}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/capability-map.js'),'utf8'),context,{filename:path.join(__dirname,'../web/capability-map.js')});
 return{host,context,history,downloads,serialized,mount:options=>context.dtCapabilityMap.mount(host,options),nodes:()=>all(host)};
}
let model;test.before(async()=>{model=await require('../lib/capability-map').graph();});
test.after(async()=>{await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('stale scope responses cannot repopulate a cleared capability workspace; failures have a working retry',async()=>{
 let release,call=0;const newer={...model,scope:{story:'new',env:'uat'}};const h=harness(),ui=h.mount({request:()=>++call===1?new Promise(r=>release=r):Promise.resolve(newer)});
 const old=ui.load();assert.equal(ui.loading,true);ui.clear();await ui.load();release({...model,scope:{story:'old',env:'dev'}});await old;assert.equal(ui.model.scope.story,'new');assert.equal(ui.loading,false);
 ui.destroy();let attempts=0;const failed=h.mount({request:async()=>{if(!attempts++)throw Error('Registry unavailable');return model;}});await failed.load();assert.equal(failed.model,null);assert.match(h.host.textContent,/Registry unavailable/);byText(h.host,'button','Retry loading tools').click();await new Promise(r=>setImmediate(r));assert.equal(failed.model,model);failed.destroy();
});
test('question navigation preserves exact story/environment drafts, uses safe text and recovers from no matches',()=>{
 const h=harness(),navigation=[],ui=h.mount({navigate:s=>navigation.push(s)});const unsafe=structuredClone(model);unsafe.nodes.find(n=>n.name==='pg_usage').description='<img src=x onerror=alert(1)> untrusted purpose';ui.set(unsafe,{object:'table',tool:'tool:pg_usage'});
 const prepare=byText(h.host,'a','Prepare in Workbench'),url=new URL(prepare.href),p=new URLSearchParams(url.hash.split('?')[1]);assert.equal(p.get('tool'),'pg_usage');assert.equal(p.get('story'),model.scope.story);assert.equal(JSON.parse(p.get('args')).env,'dev');assert.ok(h.host.textContent.includes('<img src=x onerror=alert(1)>'));
 byText(h.host,'button','Back to questions').click();const q=h.nodes().find(n=>n.tag==='button'&&n.textContent.includes('Who reads or writes this object?'));q.click();assert.ok(navigation.at(-1).tool==='tool:pg_usage');
 const search=h.nodes().find(n=>n.tag==='input'&&n.type==='search');search.value='no-such-capability-93021';search.oninput();assert.match(h.host.textContent,/No tools match/);byText(h.host,'button','All tools').click();assert.match(h.host.textContent,new RegExp(model.coverage.tools+' of '+model.coverage.tools+' tools'));assert.equal(search.value,'');
 byText(h.host,'button','Start from a task').click();for(const key of ['object:workspace','object:context','object:memory'])assert.ok(h.nodes().some(n=>n.attributes['data-object']===key.slice(7)));
 byText(h.host,'button','Zoom in').click();byText(h.host,'button','Zoom out').click();byText(h.host,'button','Fit').click();ui.destroy();
});
test('Admin integration refreshes authorization scope and round-trips graph links without executing tools',async()=>{
 let story='one',calls=0;const h=harness(async url=>{assert.ok(url.startsWith('/api/capabilities?'));calls++;return{...model,scope:{env:'dev',story}};});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/admin-capabilities.js'),'utf8'),h.context,{filename:path.join(__dirname,'../web/admin-capabilities.js')});
 await vm.runInContext('loadCapabilities()',h.context);assert.equal(calls,1);await vm.runInContext('loadCapabilities()',h.context);assert.equal(calls,1);
 story='two';h.context.adminRequestScope=()=>story;h.context.runtimeStory=story;await vm.runInContext('loadCapabilities()',h.context);assert.equal(calls,2);assert.equal(vm.runInContext('capabilityWorkspace.model.scope.story',h.context),'two');
 const graphNode=h.nodes().find(n=>n.attributes['data-tool']==='tool:pg_usage');graphNode.click();assert.match(h.history.at(-1),/tool=tool%3Apg_usage/);assert.match(h.history.at(-1),/story=two/);assert.equal(calls,2,'selecting tools only navigates');
 const detail=h.nodes().find(n=>n.attributes['aria-label']==='Questions and tool details');assert.ok(detail.focused&&detail.revealed);
});
test('exports retain full vector dimensions independently of zoom; copy fallback and keyboard exploration remain usable',async()=>{
 const h=harness(),ui=h.mount({snapshot:true});ui.set(model);byText(h.host,'button','Zoom in').click();byText(h.host,'button','Download graph SVG').click();byText(h.host,'button','Download graph JSON').click();
 assert.deepEqual(h.downloads.map(d=>d.name),['tool-capabilities.svg','tool-capabilities.json']);assert.ok(Number(h.serialized[0].attributes.width)>1000);assert.equal(h.serialized[0].style.width,undefined);assert.ok(h.serialized[0].children.length>model.coverage.tools);
 await byText(h.host,'button','Copy map link').onclick();const fallback=h.nodes().find(n=>n.tag==='input'&&n.readOnly);assert.ok(fallback.selected);assert.match(fallback.value,/#capabilities\?/);assert.ok(!fallback.value.includes('token='));assert.equal(new URLSearchParams(new URL(fallback.value).hash.split('?')[1]).get('env'),'dev');
 const task=h.nodes().find(n=>n.attributes['data-object']==='task');task.onkeydown({key:'Enter',preventDefault(){}});assert.match(h.host.textContent,/questions for Task/);
 const objectButton=h.nodes().find(n=>n.tag==='button'&&n.dataset.object==='context');h.context.document.activeElement=objectButton;objectButton.click();assert.ok(h.nodes().some(n=>n.tag==='button'&&n.dataset.object==='context'&&n.focused));
 const contextNode=h.nodes().find(n=>n.attributes['data-tool']==='tool:context_open');contextNode.click();const draft=byText(h.host,'a','Prepare in Workbench');assert.equal(draft.target,'_blank');assert.equal(draft.rel,'noopener noreferrer');
 const stage=h.nodes().find(n=>n.attributes['aria-label']?.startsWith('Tool capability graph.'));const left=stage.scrollLeft;stage.onpointerdown({target:new Node('svg'),button:0,clientX:100,clientY:100,pointerId:1});stage.onpointermove({clientX:70,clientY:50});assert.equal(stage.scrollLeft,left+30);stage.onpointerup();ui.destroy();
});
