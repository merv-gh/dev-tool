/* Registry snapshots are data. Browsing and links never execute a tool. */
(function(root){
 const NS='http://www.w3.org/2000/svg';
 function element(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 function svgElement(tag,attrs={},text){const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
 function mount(host,options={}){
  let model,scene,object='',query='',selected=null,scale=1;const revision=new root.DTState.Revision();
  const lifecycle=root.DTState.create(root.DTState.define('UI.capabilityMap','idle',{idle:['loading','ready'],loading:['ready','failed','idle'],ready:['loading','idle'],failed:['loading','ready','idle']}));
  const ui=element('div',undefined,'cm-root');host.replaceChildren(ui);
  const toolbar=element('div',undefined,'cm-toolbar'),searchLabel=element('label','Find a question or tool'),search=element('input');search.type='search';search.placeholder='Who uses this? · code_search · Kafka…';searchLabel.append(search);
  const button=(label,fn,cls)=>{const b=element('button',label,cls);b.type='button';b.onclick=fn;return b;};
  const status=element('p','Loading available tools…','cm-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const overview=button('All tools',()=>{query='';search.value='';chooseObject('');}),fit=button('Fit',()=>resize(true)),zoomOut=button('Zoom out',()=>zoom(scale/1.35)),zoomIn=button('Zoom in',()=>zoom(scale*1.35));
  const more=element('details',undefined,'cm-more'),summary=element('summary','Share & export');more.append(summary);
  const copy=button('Copy map link',async()=>{try{const url=link();if(navigator.clipboard)await navigator.clipboard.writeText(url);else throw Error('Clipboard unavailable');notice('Map link copied. It contains no credentials.');}catch{const box=element('input');box.value=link();box.readOnly=true;more.append(box);box.select();notice('Copy the selected map link.');}});
  const json=button('Download graph JSON',()=>download(JSON.stringify(model,null,2),'application/json','tool-capabilities.json'));
  const svg=button('Download graph SVG',()=>{const exported=graph.cloneNode(true);exported.style.removeProperty('width');exported.style.removeProperty('height');exported.setAttribute('width',scene.width);exported.setAttribute('height',scene.height);download(new XMLSerializer().serializeToString(exported),'image/svg+xml','tool-capabilities.svg');});
  more.append(copy,svg,json);toolbar.append(searchLabel,overview,zoomOut,zoomIn,fit,more);
  const layout=element('div',undefined,'cm-layout'),rail=element('nav',undefined,'cm-objects');rail.setAttribute('aria-label','Starting objects');
  const stage=element('div',undefined,'cm-stage');stage.tabIndex=0;stage.setAttribute('role','region');stage.setAttribute('aria-label','Tool capability graph. Scroll to explore, or use zoom and Fit.');
  const graph=svgElement('svg',{xmlns:NS,role:'group','aria-label':'Questions connecting objects to tools'});stage.append(graph);
  const detail=element('aside',undefined,'cm-detail');detail.setAttribute('aria-label','Questions and tool details');detail.tabIndex=-1;layout.append(rail,stage,detail);
  const note=element('p','Objects lead to questions; questions lead to tools. Select an object to read its questions. Select a tool to prepare a draft.','cm-note');
  const legend=element('p','Object nodes → question edges → tool nodes. Dashed links connect task concepts; they are not observed service dependencies.','cm-legend');
  ui.append(toolbar,note,status,layout,legend);
  function notice(text,error=false){status.textContent=text;status.classList.toggle('cm-error',error);}
  function link(){const p=new URLSearchParams({...(object?{object}:{}),...(query?{q:query}:{}),...(selected?{tool:selected}:{}),...(model?.scope?.story?{story:model.scope.story}:{}),...(model?.scope?.env?{env:model.scope.env}:{})});return new URL('/admin#capabilities?'+p,options.publicUrl||location.href).href;}
  function remember(){options.navigate?.({object,query,tool:selected});}
  function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Downloaded '+name);}
  function zoom(value){const old=scale;scale=Math.max(.08,Math.min(3,value));const x=(stage.scrollLeft+stage.clientWidth/2)/old,y=(stage.scrollTop+stage.clientHeight/2)/old;graph.style.width=scene.width*scale+'px';graph.style.height=scene.height*scale+'px';stage.scrollLeft=x*scale-stage.clientWidth/2;stage.scrollTop=y*scale-stage.clientHeight/2;}
  function resize(all=false){if(!scene)return;const value=all||!object&&!query?Math.min((stage.clientWidth-8)/scene.width,(stage.clientHeight-8)/scene.height):Math.max(.75,Math.min(1,(stage.clientWidth-8)/scene.width));zoom(value);stage.scrollLeft=stage.scrollTop=0;}
  function chooseObject(value){const hadFocus=document.activeElement&&ui.contains(document.activeElement);object=value;selected=null;draw();remember();if(hadFocus){const target=[...rail.children].find(n=>n.dataset.object===value)||overview;target.focus({preventScroll:true});}}
  function chooseTool(id){selected=id;renderDetail();for(const n of graph.querySelectorAll('[data-tool]'))n.classList.toggle('cm-selected',n.dataset.tool===id);remember();detail.scrollIntoView({block:'nearest'});detail.focus({preventScroll:true});notice((model.nodes.find(n=>n.id===id)?.name||'Tool')+' selected. Review its inputs and prepare an editable draft.');}
  function questionList(){
   detail.replaceChildren(element('h3',object?(model.nodes.find(n=>n.key===object)?.label||'Questions'):'Start with an object'));
   detail.append(element('p',object==='task'?'A task connects the working checkout, private progress and shared project understanding. These are the starting tools; select a concept for all its questions.':object?'Choose the question you need to answer.':'Select an object on the left or a node in the graph. Search also matches tool purposes and questions.'));
   const tools=scene.nodes.filter(n=>n.kind==='tool'),seen=new Set();
   if(!object&&!query){const task=button('Start from a task',()=>chooseObject('task'),'cm-primary');detail.append(task);return;}
   for(const n of tools){const id=n.toolId||n.id;if(seen.has(id))continue;seen.add(id);const e=model.edges.find(e=>e.to===id&&e.from==='object:'+(object||n.object))||model.edges.find(e=>e.to===id);const b=button('',()=>chooseTool(id),'cm-question');b.append(element('span',e.question),element('code',n.name));detail.append(b);}
   if(!tools.length)detail.append(element('p','No tools match. Clear the search or choose All tools.'));
  }
  function renderDetail(){
   const tool=model.nodes.find(n=>n.id===selected&&n.kind==='tool');if(!tool){questionList();return;}
   detail.replaceChildren(button('Back to questions',()=>{selected=null;draw();remember();}),element('h3',tool.name),element('p',tool.group+' · '+tool.origin,'cm-meta'),element('p',tool.description));
   detail.append(element('h4','Questions this tool answers'));
   for(const e of model.edges.filter(e=>e.to===tool.id)){const objectNode=model.nodes.find(n=>n.id===e.from);const b=button(objectNode.label+' · '+e.question,()=>chooseObject(objectNode.key),'cm-question');detail.append(b);}
   const params=tool.parameters||[];detail.append(element('h4','Inputs'),element('p',params.length?params.map(p=>p.name+(p.required?' (required)':'')).join(', '):'No arguments required.','cm-inputs'));
   const args={};if(params.some(p=>p.name==='env')&&model.scope?.env)args.env=model.scope.env;
   const p=new URLSearchParams({tool:tool.name,args:JSON.stringify(args),...(model.scope?.env?{env:model.scope.env}:{}),...(model.scope?.story?{story:model.scope.story}:{})});
   const a=element('a','Prepare in Workbench','cm-prepare');a.href=new URL('/admin#workbench?'+p,options.publicUrl||location.href).href;a.target=options.snapshot?'_blank':'_top';a.rel='noopener noreferrer';detail.append(a,element('p','Review arguments and permissions there, then choose Run. Opening this draft performs no tool call.','cm-meta'));
   const help=element('a','Read the workflow guide');help.href=new URL('/admin#handbook?chapter='+encodeURIComponent(tool.chapter||'extend'),options.publicUrl||location.href).href;help.target=options.snapshot?'_blank':'_top';help.rel='noopener noreferrer';detail.append(help);
  }
  function draw(){
   if(!model)return;scene=root.dtCapabilityLayout.scene(model,{object,query});graph.replaceChildren();graph.setAttribute('viewBox',`0 0 ${scene.width} ${scene.height}`);
   const colors=getComputedStyle(ui),fg=colors.getPropertyValue('--fg').trim()||'#1d1d1b',bg=colors.getPropertyValue('--panel').trim()||'#fff',line=colors.getPropertyValue('--line').trim()||'#e4e3df',accent=colors.getPropertyValue('--accent').trim()||'#2457c5',soft=colors.getPropertyValue('--accent-soft').trim()||'#e8eefb';
   graph.append(svgElement('style',{},`.cm-node{cursor:pointer}.cm-node rect{fill:${bg};stroke:${line}}.cm-node text{fill:${fg};font:12px system-ui,sans-serif}.cm-object rect{fill:${soft};stroke:${accent}}.cm-object text{font-weight:650}.cm-node:hover rect,.cm-node:focus rect,.cm-selected rect{stroke:${accent};stroke-width:3}.cm-edge{fill:none;stroke:${line};stroke-width:1.2;marker-end:url(#cm-arrow)}.cm-orientation{stroke:${accent};stroke-dasharray:5 5;opacity:.4}.cm-question-label{fill:${fg};font:12px system-ui,sans-serif;paint-order:stroke;stroke:${bg};stroke-width:5px;stroke-linejoin:round}.cm-bound{fill:none;stroke:${line};stroke-dasharray:3 5}`));
   const defs=svgElement('defs'),marker=svgElement('marker',{id:'cm-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});marker.append(svgElement('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:accent}));defs.append(marker);graph.append(defs);
   for(const b of scene.bounds)graph.append(svgElement('rect',{x:b.x,y:b.y,width:b.w,height:b.h,rx:12,class:'cm-bound'}));
   const byId=new Map(scene.nodes.map(n=>[n.id,n]));
   for(const e of scene.edges){const a=byId.get(e.from),b=byId.get(e.to);if(!a||!b)continue;const x=e.vertical?a.x+a.w/2:a.x+a.w,y=e.vertical?a.y+a.h:a.y+a.h/2,bx=e.vertical?b.x+b.w/2:b.x,by=e.vertical?b.y:b.y+b.h/2;const g=svgElement('g',{'aria-label':e.question});g.append(svgElement('title',{},e.question),svgElement('path',{d:e.vertical?`M${x} ${y} C${x} ${y+60},${bx} ${by-60},${bx} ${by}`:`M${x} ${y} C${x+80} ${y},${bx-80} ${by},${bx} ${by}`,class:'cm-edge'+(e.kind==='orientation'?' cm-orientation':'')}));if(e.label){const label=svgElement('text',{x:e.labelX||220,y:e.labelY||by-7,class:'cm-question-label'});const lines=[''];for(const word of e.question.split(' ')){if((lines.at(-1)+' '+word).length>(e.labelWidth||54))lines.push(word);else lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}lines.slice(0,e.labelWidth?3:2).forEach((text,i)=>label.append(svgElement('tspan',{x:e.labelX||220,dy:i?15:0},text+(i===1&&lines.length>2&&!e.labelWidth?'…':''))));g.append(label);}graph.append(g);}
   for(const n of scene.nodes){const id=n.toolId||n.id,g=svgElement('g',{class:'cm-node '+(n.kind==='object'?'cm-object ':'')+(selected===id?'cm-selected':''),tabindex:0,role:'button','aria-label':n.kind==='object'?n.label+' · '+n.count+' tools':n.name,transform:`translate(${n.x},${n.y})`,...(n.kind==='tool'?{'data-tool':id}:{'data-object':n.key})});g.append(svgElement('title',{},n.description),svgElement('rect',{width:n.w,height:n.h,rx:8}),svgElement('text',{x:12,y:n.kind==='object'?27:n.h/2+4},n.label));if(n.kind==='object')g.append(svgElement('text',{x:12,y:49},n.count+' tools'));g.onclick=()=>n.kind==='object'?chooseObject(n.key):chooseTool(id);g.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();g.onclick();}};graph.append(g);}
   rail.replaceChildren(element('h3','What are you working with?'));
   for(const n of model.nodes.filter(n=>n.kind==='object')){const b=button('',()=>chooseObject(n.key));b.append(element('span',n.label),element('small',String(n.count)));b.dataset.object=n.key;b.setAttribute('aria-pressed',String(n.key===object));rail.append(b);}
   if(!scene.tools){const empty=svgElement('text',{x:24,y:70,fill:fg,'font-size':18},'No matching tools. Clear the search or choose All tools.');graph.append(empty);}
   renderDetail();notice(`${scene.tools} of ${model.coverage.tools} tools · ${object?'questions for '+(model.nodes.find(n=>n.key===object)?.label||object):'complete map'}${options.snapshot?' · saved registry snapshot':''}`);resize();
  }
  let searchTimer;search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=search.value.slice(0,300);selected=null;draw();remember();},180);};
  let drag;stage.onpointerdown=e=>{if(e.target.closest('[role=button]')||e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.setPointerCapture(e.pointerId);};stage.onpointermove=e=>{if(drag){stage.scrollLeft=drag.left-(e.clientX-drag.x);stage.scrollTop=drag.top-(e.clientY-drag.y);}};stage.onpointerup=stage.onpointercancel=()=>{drag=null;};
  const observer=new ResizeObserver(()=>{if(scene)resize();});observer.observe(stage);
  function set(value,state={}){if(!lifecycle.is('ready'))lifecycle.to('ready');model=value;object=state.object||value.initial?.object||'';if(!model.nodes.some(n=>n.key===object))object='';query=(state.query??value.initial?.query??'').slice(0,300);selected=state.tool||null;search.value=query;draw();}
  async function load(state={}){const current=++revision.value;if(!lifecycle.is('loading'))lifecycle.to('loading');notice('Loading authorized tools…');try{const value=await options.request();if(current===revision.value)set(value,state);}catch(error){if(current===revision.value){lifecycle.to('failed');model=null;graph.replaceChildren();rail.replaceChildren();detail.replaceChildren(button('Retry loading tools',()=>load(state)));notice(error.message+' Retry loading tools.',true);}}}
  return{load,set,clear(){revision.value++;if(!lifecycle.is('idle'))lifecycle.to('idle');model=null;graph.replaceChildren();rail.replaceChildren();detail.replaceChildren();notice('Select a scope to read its available tools.');},destroy(){revision.value++;observer.disconnect();clearTimeout(searchTimer);host.replaceChildren();},get model(){return model;},get loading(){return lifecycle.is('loading');}};
 }
 root.dtCapabilityMap={mount};
})(typeof globalThis==='object'?globalThis:this);
