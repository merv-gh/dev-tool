const {machines,eventLabels}=require('./machines.cjs');
const {groups,usecases}=require('./catalog.cjs');
const {journey,createSimulation,scenarios}=require('./journeys.cjs');
const specimen=require('./large-fixture.cjs');
const summary=require('./summary.json');
const $=id=>document.getElementById(id);
function el(tag,attrs={},...children){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v!==undefined&&v!==null)n.setAttribute(k,String(v));}for(const c of children.flat())if(c!==null&&c!==undefined)n.append(typeof c==='string'?document.createTextNode(c):c);return n;}
const byId=new Map(usecases.map(c=>[c.id,c]));
const nodes=new Map();for(const m of Object.values(machines)){const todo=[m.root];while(todo.length){const n=todo.shift();nodes.set(n.id,n);todo.push(...Object.values(n.states));}}
const url=new URL(location.href);
let selected=byId.get(url.searchParams.get('usecase'))||byId.get('entry-exit'),variant=url.searchParams.get('scenario')||'happy';
let recipe,sim,position=0,planned=new Set(),selectedNode='',focus=true,opened=new Set(),unfolded=new Set(),groupOpen=new Set([selected.group]),groupLimits=new Map(),coverage=null;
const valueText=v=>typeof v==='string'?v:Object.entries(v).map(([k,v])=>k+'.'+valueText(v)).join(' / ');
const labelAt=(actor,value)=>nodes.get(actor+'.'+valueText(value))?.meta?.label||valueText(value);
function relevantActors(){return new Set([selected.actor,...recipe.steps.map(s=>s.actor)]);}
function variants(){return ['session','chat'].includes(selected.actor)?scenarios.filter(s=>s.id==='happy'):scenarios;}
function persistLink(){const u=new URL(location.href);u.search=new URLSearchParams({usecase:selected.id,scenario:variant,step:String(position)});history.replaceState(null,'',u);}
function selectCase(id,resetPosition=true){
 selected=byId.get(id)||selected;if(!variants().some(s=>s.id===variant))variant='happy';
 recipe=journey(selected,variant);sim?.stop();sim=createSimulation();position=0;planned=new Set();opened=new Set();unfolded=new Set();selectedNode='';
 const preview=createSimulation();try{for(const s of recipe.steps){for(const n of preview.actors[s.actor].getSnapshot()._nodes)planned.add(n.id);preview.send(s);for(const n of preview.actors[s.actor].getSnapshot()._nodes)planned.add(n.id);}}finally{preview.stop();}
 for(const id of planned){let n=nodes.get(id);while(n){if(n.states&&Object.keys(n.states).length)opened.add(n.id);n=n.parent;}}
 for(const id of Object.keys(machines))if(id!==selected.actor)opened.delete(id);
 if(!resetPosition){const requested=Math.min(recipe.steps.length,Math.max(0,Number(url.searchParams.get('step'))||0));for(let i=0;i<requested;i++){sim.send(recipe.steps[i]);position++;}}
 groupOpen.add(selected.group);$('caseTitle').textContent=selected.title;$('caseDetail').textContent=selected.detail;
 $('scenario').replaceChildren(...variants().map(s=>el('option',{value:s.id},s.label)));$('scenario').value=variant;
 $('entryExit').hidden=selected.actor!=='flow';if(selected.actor!=='flow')$('entryExit').open=false;
 $('stateInspector').hidden=true;$('copyFallback').hidden=true;renderRail();render();persistLink();
 if(window.matchMedia('(max-width:700px)').matches)$('usecasePicker').open=false;
}
function renderRail(){
 const q=$('caseSearch').value.toLowerCase().trim(),matches=usecases.filter(c=>(c.title+' '+c.detail+' '+c.tools.join(' ')).toLowerCase().includes(q));
 $('caseTotal').textContent='('+usecases.length+')';$('caseCount').textContent=matches.length+' matching intents';$('caseList').replaceChildren();
 for(const g of groups){const cases=matches.filter(c=>c.group===g.id);if(!cases.length)continue;const d=el('details',{'data-group':g.id}),s=el('summary',{},g.title+' ',el('span',{class:'count'},String(cases.length))),list=el('ul');d.append(s,list);d.open=!!q||groupOpen.has(g.id);
  const populate=()=>{const cap=groupLimits.get(g.id)||40;list.replaceChildren(...cases.slice(0,cap).map(c=>el('li',{},el('button',{'data-case':c.id,'aria-current':String(c.id===selected.id),onclick:()=>{selectCase(c.id);$('caseTitle').focus({preventScroll:true});}},c.title))));if(cases.length>cap)list.append(el('li',{},el('button',{onclick:()=>{groupLimits.set(g.id,cap+40);populate();}},'Load more intents')));};
  if(d.open)populate();d.addEventListener('toggle',()=>{if(!d.isConnected)return;if(d.open){groupOpen.add(g.id);if(!list.children.length)populate();}else groupOpen.delete(g.id);});$('caseList').append(d);
 }
 if(!matches.length)$('caseList').append(el('p',{},'No matching intent. Try a service, file, action or tool name.'));
}
function render(){
 const done=position===recipe.steps.length,last=sim.records.at(-1),next=recipe.steps[position];
 $('progress').textContent=done?'Model path complete · '+position+' steps · no backend work executed':last?'Step '+position+' / '+recipe.steps.length+' · '+machines[last.actor].config.meta.label+': '+labelAt(last.actor,last.after):'Prepared path · '+recipe.steps.length+' modeled steps · no backend work executed';
 $('next').disabled=done;$('finish').disabled=done;$('next').textContent=next?'Next: '+next.label:'Path complete';
 $('walkTitle').textContent='Modeled walkthrough · '+position+' / '+recipe.steps.length+' steps';
 $('eventJson').textContent=JSON.stringify({intent:selected.id,scenario:variant,events:recipe.steps.map(s=>({actor:s.actor,event:s.event})),expected:recipe.expected},null,2);
 const list=$('steps');list.replaceChildren(...recipe.steps.map((s,i)=>el('li',{'aria-current':i===position?'step':null,class:i<position?'done':''},el('button',{'data-step':i,onclick:()=>jump(i+1)},s.label),el('small',{},machines[s.actor].config.meta.label))));
 renderChart();$('tools').replaceChildren(...selected.tools.map(name=>el('li',{},el('code',{},name))));if(!selected.tools.length)$('tools').append(el('li',{},'Native conversation/navigation behavior; no tool required.'));
 if(coverage)renderObligations();
}
function jump(target){sim.stop();sim=createSimulation();position=0;while(position<target){sim.send(recipe.steps[position]);position++;}render();persistLink();}
function renderChart(){
 const roots=relevantActors(),active=new Set();for(const id of roots)for(const n of sim.actors[id].getSnapshot()._nodes)active.add(n.id);
 const root=$('chart');root.replaceChildren();
 function row(n,isRoot){
  const children=Object.values(n.states),li=el('li',{'data-state':n.id}),onRoute=planned.has(n.id),current=active.has(n.id),className='state-row'+(onRoute?' planned':'')+(current?' current':'')+(selectedNode===n.id?' selected':'');
  const tags=[children.length?(isRoot?'actor':'nested'):'',current?'current':onRoute?'on path':''].filter(Boolean).join(' · ');
  if(children.length){
   const d=el('details',{'data-state-group':n.id}),s=el('summary',{class:className},n.meta?.label||n.key,el('span',{class:'state-tag'},tags));d.open=opened.has(n.id);d.append(s);
   const body=el('ul');let populated=false;
   const populate=()=>{if(populated)return;populated=true;const relevant=children.filter(c=>!focus||unfolded.has(n.id)||planned.has(c.id)||active.has(c.id));for(const child of relevant)body.append(row(child,false));if(relevant.length<children.length)body.append(el('li',{},el('button',{class:'reveal',onclick:()=>{unfolded.add(n.id);renderChart();}},'Show '+(children.length-relevant.length)+' other states')));};
   if(isRoot)d.append(el('p',{class:'actor-note'},n.meta.lifetime));d.append(body);if(d.open)populate();d.addEventListener('toggle',()=>{if(!d.isConnected)return;if(d.open){opened.add(n.id);populate();}else opened.delete(n.id);});s.addEventListener('click',()=>inspect(n.id,false));li.append(d);
  }else li.append(el('div',{class:className},el('button',{'data-inspect':n.id,onclick:()=>inspect(n.id,true)},n.meta?.label||n.key),el('span',{class:'state-tag'},tags)));
  return li;
 }
 for(const [id,m]of Object.entries(machines).sort(([a],[b])=>a===selected.actor?-1:b===selected.actor?1:0))if(!focus||roots.has(id))root.append(row(m.root,true));
}
function inspect(id,open){
 selectedNode=id;for(const e of document.querySelectorAll('.state-row.selected'))e.classList.remove('selected');const li=[...document.querySelectorAll('[data-state]')].find(e=>e.dataset.state===id);li?.querySelector('.state-row')?.classList.add('selected');
 const n=nodes.get(id);$('stateInspector').hidden=false;$('stateInspector').open=open;$('stateTitle').textContent=(n.meta?.label||n.key)+' · '+id;$('stateDescription').textContent=n.meta?.description||'Events below are modeled transitions. Inspecting a state does not send an event or run a tool.';
 const target=$('stateTransitions');target.replaceChildren();
 for(const[event,transitions]of n.transitions)for(const t of transitions){const r=el('div',{class:'transition'},el('code',{},event),el('span',{},typeof t.guard==='object'?'if '+t.guard.type:transitions.length>1?'fallback':''));if(!t.target?.length)r.append(el('span',{},'stay here; preserve state'));for(const dest of t.target||[])r.append(el('a',{href:'#'+dest.id,onclick:e=>{e.preventDefault();let p=dest.parent;while(p){opened.add(p.id);unfolded.add(p.id);p=p.parent;}focus=false;$('focusFlow').checked=false;renderChart();inspect(dest.id,true);}},'→ '+(dest.meta?.label||dest.key)));target.append(r);}
 if(!target.children.length)target.append(el('p',{},'Initial child: '+(n.initial?.target?.[0]?.meta?.label||n.config.initial||'none')+'. Expand to inspect child transitions.'));
 if(open)$('stateInspector').scrollIntoView({block:'nearest'});
}
async function loadCoverage(){
 if(coverage)return;try{const r=await fetch('coverage.json');if(!r.ok)throw Error('Verification report could not load');coverage=await r.json();$('coverageSummary').textContent=coverage.counts.usecases+' use cases; '+coverage.counts.tools+' built-ins mapped; '+coverage.counts.legacyStateObligations+' prior-state design obligations. '+coverage.counts.journeyExecutions+' modeled journeys executed. This is design-model coverage, not production test coverage.';
 $('coverageRows').replaceChildren(...coverage.models.map(m=>el('tr',{},...([m.label,m.reachedAtomic+' / '+m.atomicStates,m.coveredTransitions+' / '+m.transitions,String(m.exploredConfigurations)].map(v=>el('td',{},v))))));$('limits').replaceChildren(...coverage.boundaries.map(v=>el('li',{},v)));renderObligations();
 }catch(e){$('loadError').hidden=false;$('loadError').replaceChildren(document.createTextNode(e.message+' '),el('button',{onclick:loadCoverage},'Retry report'));}}
function renderObligations(){const items=coverage.obligations.filter(o=>o.usecases.includes(selected.id));$('obligations').replaceChildren(...items.slice(0,40).map(o=>el('li',{},o.areaLabel+' · '+o.label+' · '+o.status)));if(!items.length)$('obligations').append(el('li',{},'No exact prior-area assignment; the use-case recipe and actor model are checked separately.'));}
let serviceCursor=0,servicePage=0,serviceHistory=[];
function serviceResults(mode='search'){
 if(mode==='search'){servicePage=0;serviceHistory=[];}
 else if(mode==='next'&&serviceCursor!==null){serviceHistory.push(servicePage);servicePage=serviceCursor;}
 else if(mode==='previous')servicePage=serviceHistory.pop()||0;
 const page=specimen.searchServices($('serviceSearch').value,servicePage);$('services').replaceChildren();
 for(const s of page.items)$('services').append(el('button',{'data-service':s.n,onclick:()=>openService(s.n)},s.label));
 serviceCursor=page.nextCursor;$('moreServices').hidden=serviceCursor===null;$('previousServices').hidden=serviceHistory.length===0;
 if(!$('services').children.length)$('services').append(el('p',{},'No synthetic services match.'));
}
function openService(n){$('flowTree').replaceChildren(flowNode(specimen.describe('svc:'+n),new Set()));$('reference').textContent='';updateTreeCount();}
function flowNode(item,ancestors){
 const li=el('li',{'data-flow-node':item.id}),kind=()=>el('span',{class:'flow-kind'},item.kind),basis=()=>['gap','assumption'].includes(item.basis)?el('span',{class:'flow-basis'},item.basis):null;
 if(item.hasChildren&&!ancestors.has(item.id)){
  const d=el('details',{'data-flow-group':item.id}),s=el('summary',{},kind(),item.label,basis()),list=el('ul');let loaded=false;const nextAncestors=new Set([...ancestors,item.id]);d.append(s,list);
  const page=(cursor=0)=>{
   const p=specimen.children(item.id,cursor);list.replaceChildren();
   if(cursor>0)list.append(el('li',{},el('button',{'data-prev-parent':item.id,onclick:()=>page(Math.max(0,cursor-specimen.PAGE_SIZE))},'Previous '+specimen.PAGE_SIZE)));
   for(const child of p.items)list.append(flowNode(child,nextAncestors));
   if(p.nextCursor!==null)list.append(el('li',{class:'more-node'},el('button',{'data-more-parent':item.id,onclick:()=>page(p.nextCursor)},'Next '+specimen.PAGE_SIZE+' · showing '+(cursor+1)+'–'+(cursor+p.items.length)+' of '+p.total)));
   updateTreeCount();
  };
  d.addEventListener('toggle',()=>{if(d.open&&!loaded){loaded=true;page();}});li.append(d);
 }else{const line=el('div',{class:'flow-leaf'},kind(),item.label,basis(),el('small',{},item.source));if(item.target)line.append(el('button',{'data-reference':item.target,onclick:()=>{$('reference').textContent='Reference: '+item.target+' · existing loop, not another expanded copy.';}},'Inspect reference'));li.append(line);}
 return li;
}
function updateTreeCount(){$('treeCount').textContent=$('flowTree').querySelectorAll('[data-flow-node]').length+' rendered source nodes · children generated on demand · page size '+specimen.PAGE_SIZE;}
$('caseSearch').addEventListener('input',renderRail);$('scenario').onchange=e=>{variant=e.target.value;selectCase(selected.id);};$('next').onclick=()=>{if(position<recipe.steps.length){sim.send(recipe.steps[position]);position++;render();persistLink();}};$('finish').onclick=()=>jump(recipe.steps.length);$('reset').onclick=()=>jump(0);$('focusFlow').onchange=e=>{focus=e.target.checked;renderChart();};$('coveragePanel').addEventListener('toggle',()=>{if($('coveragePanel').open)loadCoverage();});
$('share').onclick=async()=>{persistLink();const link=location.href;try{await navigator.clipboard.writeText(link);$('progress').textContent='Review link copied · only the finite model is restored; no backend work executes.';}catch{$('copyFallback').hidden=false;$('reviewUrl').value=link;$('reviewUrl').select();$('progress').textContent='Clipboard unavailable. Copy the selected review URL.';}};
$('serviceSearch').oninput=()=>serviceResults('search');$('moreServices').onclick=()=>serviceResults('next');$('previousServices').onclick=()=>serviceResults('previous');$('entryExit').addEventListener('toggle',()=>{if($('entryExit').open&&!$('flowTree').children.length){serviceResults();openService(42);}});
$('coverageTitle').textContent='Model checks · '+summary.states+' / '+summary.states+' states and '+summary.transitions+' / '+summary.transitions+' transition branches · scope and limits';
selectCase(selected.id,false);window.addEventListener('pagehide',()=>sim?.stop());
// Deliberately no debug globals, tool calls, provider calls or production state hooks.
