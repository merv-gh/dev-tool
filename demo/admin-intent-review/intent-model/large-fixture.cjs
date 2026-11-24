// Synthetic scale specimen. Objects are generated per requested page, never as one huge tree.
const SERVICE_COUNT=10000, FIELD_COUNT=1500, PAGE_SIZE=25;
const serviceName=n=>'registry-'+String(n).padStart(5,'0');
function searchServices(query='',cursor=0,limit=PAGE_SIZE){
 limit=Math.max(1,Math.min(Number(limit)||PAGE_SIZE,50));cursor=Math.max(0,Math.trunc(Number(cursor)||0));
 const q=query.toLowerCase().trim(),items=[];let matched=0,more=false;
 for(let n=0;n<SERVICE_COUNT;n++)if(!q||serviceName(n).includes(q)){
  if(matched++<cursor)continue;
  if(items.length===limit){more=true;break;}
  items.push({id:'svc:'+n,label:serviceName(n),n});
 }
 return{items,nextCursor:more?cursor+items.length:null,limit,totalServices:SERVICE_COUNT};
}
function describe(id){
 const [type,value,field]=id.split(':'),n=Number(value)||0;
 const source='illustrative-source-v1';
 const types={svc:['Service',serviceName(n),source],entry:['HTTP entry','GET /person/:id','PersonController.java:21'],controller:['Handler','Read person and collect related documents','PersonService.java:35'],read:['Database read','registry.person_document + document_state','PersonRepository.java:48'],procedure:['Procedure','registry.person_candidates(person_id)','person_candidates.sql:12'],fields:['Fields','Result columns · '+FIELD_COUNT+' synthetic fields','catalog specimen'],pgCondition:['SQL condition','Join status by document_id; keep person identity','person_candidates.sql:20'],selection:['Selection','Choose one coherent document name','DocumentPolicy.java:42'],active:['Condition','Document is active','DocumentPolicy.java:44'],valid:['Condition','Effective date ≤ observation date; not expired','DocumentPolicy.java:45'],annulled:['Condition','Exclude annulled documents','DocumentPolicy.java:46'],loop:['Loop','Visit candidate documents; retain newest eligible one','DocumentPolicy.java:49'],library:['Inherited library path','extends AbstractPersonHandler','internal-library default branch · assumed'],transform:['Data change','Map the selected row’s complete ФИО; registry fallback','PersonMapper.java:17'],downstream:['API exit','Optional identity audit service','unresolved dynamic target · gap'],exit:['HTTP exit','PersonResponse.fio','PersonResponse.java:9']};
 if(type==='field')return{id,kind:'Column',label:'result_field_'+field,source:'synthetic catalog',basis:'illustration'};
 if(type==='ref')return{id,kind:'Reference',label:'Revisit candidate loop without duplicating it',source:'DocumentPolicy.java:49',target:'loop:'+n,basis:'cycle reference'};
 const d=types[type]||['Unknown',id,source];
 return{id,kind:d[0],label:d[1],source:d[2],basis:type==='library'?'assumption':type==='downstream'?'gap':'illustration',hasChildren:['svc','entry','controller','read','procedure','fields','selection','loop'].includes(type)};
}
function children(id,cursor=0,limit=PAGE_SIZE){
 const [type,value]=id.split(':'),n=Number(value)||0;limit=Math.max(1,Math.min(Number(limit)||PAGE_SIZE,50));cursor=Math.max(0,Math.trunc(Number(cursor)||0));
 const keys={svc:['entry'],entry:['controller'],controller:['read','selection','downstream','exit'],read:['procedure'],procedure:['pgCondition','fields'],selection:['active','valid','annulled','loop','library','transform'],loop:['ref']}[type]||[];
 const total=type==='fields'?FIELD_COUNT:keys.length,end=Math.min(total,cursor+limit),items=[];
 for(let i=cursor;i<end;i++)items.push(describe(type==='fields'?'field:'+n+':'+i:keys[i]+':'+n));
 return{items,total,nextCursor:end<total?end:null};
}
module.exports={SERVICE_COUNT,FIELD_COUNT,PAGE_SIZE,searchServices,describe,children};
