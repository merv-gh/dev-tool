let states=[],observations=new Map();
const key=(area,state)=>area+'::'+state;
function render(){
  const q=document.getElementById('stateFilter').value.toLowerCase(),status=document.getElementById('stateStatus').value,root=document.getElementById('stateRows');
  root.replaceChildren();let count=0,verified=0;
  for(const area of states)for(const s of area.states){
    const evidence=observations.get(key(area.id,s.id))||[];
    if((status==='browser'?!evidence.length:status&&s.status!==status)||!(area.label+' '+s.label+' '+s.verification+' '+evidence.map(e=>e.label).join(' ')).toLowerCase().includes(q))continue;
    count++;if(evidence.length)verified++;
    const tr=document.createElement('tr');
    for(const value of [area.label,s.label,s.status.replaceAll('_',' '),s.verification]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    for(const item of s.evidence||[]){if(!item.includes('/screenshots/'))continue;const a=document.createElement('a');a.href=item.replace('demo/admin-intent-review/','');a.textContent=' View baseline capture';tr.lastChild.append(a);}
    const td=document.createElement('td');
    td.textContent=evidence.length?evidence.map(e=>e.label).filter((v,i,a)=>a.indexOf(v)===i).join(' · '):'Not verified in browser follow-up';
    for(const e of evidence){if(!e.file)continue;const a=document.createElement('a');a.href=e.file;a.textContent=' View follow-up capture';td.append(a);}
    tr.append(td);root.append(tr);
  }
  document.getElementById('stateCount').textContent=count+' significant scenarios shown · '+verified+' with mapped browser follow-up · baseline evidence stays unchanged';
}
function addObservation(item,label){
  for(const ref of item.ledgerRefs||[]){
    const area=ref.area||ref.areaId||item.area,state=ref.state||ref.stateId;
    if(!area||!state)continue;
    const k=key(area,state);if(!observations.has(k))observations.set(k,[]);
    observations.get(k).push({label,file:item.file});
  }
}
document.getElementById('stateFilter').oninput=render;document.getElementById('stateStatus').onchange=render;
Promise.all(['state-inventory.json','admin-browser-verification.json'].map(file=>fetch(file).then(r=>{if(!r.ok)throw Error('State evidence could not load');return r.json();}))).then(([data,browser])=>{
  states=data.areas;
  for(const item of browser.steps||[])if(!['capture-failed','capture_problem','failed'].includes(item.status))addObservation(item,item.name+' · '+item.status);
  for(const item of browser.captures||[])addObservation(item,item.note||'Browser observation');
  render();
}).catch(e=>document.getElementById('stateCount').textContent=e.message);
