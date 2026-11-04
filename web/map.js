import {createCanvas} from './vendor/ecs-canvas/canvas.js';
const $=id=>document.getElementById(id), id=location.pathname.split('/').filter(Boolean)[1], base='/api/map/'+encodeURIComponent(id), embed=new URLSearchParams(location.search).has('embed');
if(embed)document.body.classList.add('embed');
let librariesInitialized=false;
let graph,canvas,focus=null,selected='',generation=0,detailSequence=0,searchSequence=0;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const api=async(path,options)=>{const r=await fetch(base+path,options);if(!r.ok)throw new Error((await r.json()).error||'Map request failed');return r;};
function message(e){$('map-message').textContent=e?.message||String(e||'');}
function list(rows){$('map-list').replaceChildren();for(const n of rows){const b=document.createElement('button');b.type='button';b.dataset.node=n.id;b.setAttribute('aria-current',String(selected===n.id));b.innerHTML=`${esc(n.label)}<small>${esc(n.kind)} · ${esc(n.scope||'')}</small>`;b.onclick=()=>inspect(n.id);$('map-list').append(b);}if(!rows.length)$('map-list').innerHTML='<p class="empty">No matching entities. Refresh passports/catalog or broaden the search.</p>';}
async function inspect(node){
 const sequence=++detailSequence;selected=node;for(const b of $('map-list').querySelectorAll('button'))b.setAttribute('aria-current',String(b.dataset.node===node));
 const r=await (await api('/node?id='+encodeURIComponent(node))).json();if(sequence!==detailSequence)return;
 const n=r.node, panel=$('map-detail');panel.innerHTML=`<h2>${esc(n.label)}</h2><span class="chip">${esc(n.kind)}</span><p class="muted">${esc(n.id)}</p><p>${esc(n.detail)}</p>${n.repo?`<p>Repository: ${esc(n.repo)}<br><span class="mono">${esc(n.revision?.slice(0,12))}</span></p>`:''}<p>Source: ${esc(n.source||'derived')} · ${r.degree} connections</p><button id="map-neighbors">Explore connections</button><h3>Inspect with tools</h3><div id="map-actions"></div><pre id="map-proposal" hidden></pre><p class="muted">Tool actions are prepared for review. No live calls run when selecting a node.</p><details><summary>Connection evidence</summary><pre id="map-evidence-detail">Loading sources…</pre></details>`;
 const edges=await (await api('/neighbors?id='+encodeURIComponent(node)+'&libraries='+($('map-libraries').checked?'1':'0'))).json();if(sequence!==detailSequence)return;$('map-evidence-detail').textContent=edges.columns+'\n'+edges.text+(edges.truncated?'\nMore connections are available through map_neighbors.':'');
 for(const link of r.links||[]){const a=document.createElement('a');a.href=link.url;a.textContent=link.label;a.target='_blank';a.rel='noopener';panel.append(a);}
 $('map-neighbors').onclick=()=>{focus=node;load().catch(message);};
 for(const a of r.actions){const b=document.createElement('button');b.type='button';b.className='map-action';b.disabled=!a.valid;b.innerHTML=`${esc(a.tool)}<small>${esc(a.why)}</small>`;b.onclick=()=>{const out=$('map-proposal');out.hidden=false;out.textContent=JSON.stringify({tool:a.tool,arguments:a.arguments},null,2);parent.postMessage({type:'dt:map-action',map:id,node,tool:a.tool},'*');};$('map-actions').append(b);}
 parent.postMessage({type:'dt:map-selected',map:id,node},'*');
}
function documentFor(g){
 const order=['domain','kafka-cluster','postgres-cluster','ui','service','kafka','postgres','table','elasticsearch','elk','feature','library','external'],groups=new Map();for(let i=0;i<g.count;i++){const n=g.node(i);if(!groups.has(n.kind))groups.set(n.kind,[]);groups.get(n.kind).push(n);}
 const nodes=[];let x=0;for(const kind of order){const group=groups.get(kind)||[];if(!group.length)continue;let y=0;for(const n of group){nodes.push({id:n.id,Label:{text:n.label},Position:{x,y},Size:{w:210,h:74},NodeType:({kafka:'kafka',postgres:'database',table:'database',elasticsearch:'index',ui:'gateway',service:'service'})[kind]||'rounded',Color:({service:'blue',ui:'blue',kafka:'orange',postgres:'green',table:'green',feature:'purple',library:'gray'})[kind]||'gray',Description:kind,DescriptionPlacement:'inside'});y+=108;}x+=320;}
 const columns=$('map-canvas').clientWidth<500?1:3;nodes.sort((a,b)=>Number(b.id===focus)-Number(a.id===focus));nodes.forEach((n,i)=>n.Position={x:(i%columns)*270,y:Math.floor(i/columns)*130});
 const edges=[];for(let i=0;i<g.edgeCount;i++){const e=g.edge(i);edges.push({id:'relation-'+i,From:g.node(e.from).id,To:g.node(e.to).id,Label:{text:focus?e.kind:''},Kind:e.certainty==='candidate'?'dashed':e.kind.includes('consum')||e.kind==='produces'?'async':'plain'});}return {name:g.meta[3],nodes,edges};
}
async function load(){
 const seq=++generation;message('Loading map…');const qs=new URLSearchParams();if(librariesInitialized)qs.set('libraries',$('map-libraries').checked?'1':'0');if(focus!==null)qs.set('focus',focus||'');
 const response=await api('/graph?'+qs), bytes=await response.arrayBuffer();if(seq!==generation)return;graph=dtMapFormat.decode(bytes);if(!librariesInitialized){$('map-libraries').checked=response.headers.get('x-dt-map-libraries')==='1';librariesInitialized=true;}if(focus===null)focus=decodeURIComponent(response.headers.get('x-dt-map-focus')||'');
 $('map-title').textContent=graph.meta[3];$('map-counts').textContent=`${graph.count} shown / ${graph.meta[4]} entities · ${graph.edgeCount} shown / ${graph.meta[5]} relations · ${graph.meta[6]} entities outside this view`;
 if(!canvas){canvas=createCanvas({target:$('map-canvas'),mode:'read-only',ui:{fit:'readable',panels:false,hotkeys:{'view.fit.all':'f'},inheritHotkeys:false}});window.dtMapCanvas=canvas;canvas.ctx.bus.on('selection.changed',()=>{const ref=canvas.ctx.selection.selected();if(ref?.kind==='node')inspect(ref.id).catch(message);});}
 canvas.load(documentFor(graph));canvas.fit();setTimeout(()=>{const view=canvas.ctx.contexts.view,current=view.get();if(current.scale<0.85){view.set({scale:0.85,x:-125,y:-70});canvas.ctx.bus.emit('view.changed',view.get());}},250);list(Array.from({length:graph.count},(_,i)=>graph.node(i)));message('');
 $('map-download').href=base+'/full';$('map-download').download='microservices.dtm';
 if(embed)dtInline.mount(document.querySelector('.map-shell'),{title:'Microservice map',summary:`${graph.meta[4]} entities · ${graph.meta[5]} relations`,open:true});postHeight();
}
async function search(){const seq=++searchSequence,q=$('map-search').value.trim();if(!q){list(Array.from({length:graph?.count||0},(_,i)=>graph.node(i)));return;}const r=await (await api('/search?'+new URLSearchParams({q,libraries:$('map-libraries').checked?'1':'0'}))).json();if(seq!==searchSequence)return;list(r.text?r.text.split('\n').map(line=>{const [id,kind,label]=line.split('\t');return {id,kind,label,scope:''};}):[]);message(r.truncated?`${r.total} matches; showing the first 30. Narrow the search.`:'');}
$('map-search').oninput=()=>{clearTimeout(search.timer);search.timer=setTimeout(()=>search().catch(message),200);};
$('map-overview').onclick=()=>{focus='';$('map-search').value='';load().catch(message);};$('map-libraries').onchange=()=>load().catch(message);$('map-fit').onclick=()=>canvas?.fit();
let last=0;function postHeight(){if(!embed||parent===window)return;const height=Math.ceil(document.body.getBoundingClientRect().height);if(height!==last){last=height;parent.postMessage({type:'iframe:height',height},'*');}}
new ResizeObserver(postHeight).observe(document.body);for(const delay of [500,1500,3000])setTimeout(postHeight,delay);window.addEventListener('pagehide',()=>canvas?.destroy());load().catch(message);
