// Check structured static-proof claims against the exact retained evidence.
// This validates claims; it never changes source data or supplies a runtime proof.
const proofFields=new Set(['kind','status','feasibility','runtime','behaviorVerified']);
function limits(raw){
 return {...(raw?.flowMap?{mapComplete:raw.flowMap.complete??null}:{}),proof:Object.fromEntries([...proofFields].filter(k=>raw?.proof?.[k]!==undefined).map(k=>[k,raw.proof[k]])),sourceCoverage:{complete:raw?.flowMap?.complete??null,truncated:!!raw?.truncated,gapCount:(raw?.gaps||[]).length}};
}
function verify(value,sources={}){
 const available=Object.fromEntries(Object.entries(sources).filter(([,v])=>v).map(([k,v])=>[k,limits(v)])),issues=[];let checkedFields=0;
 function walk(v,path='',scope=null,inProof=false,inCoverage=false,depth=0){
  if(!v||typeof v!=='object'||depth>12||issues.length>=32)return;
  for(const[k,x]of Object.entries(v).slice(0,100)){
   const nextScope=['map','entryMap'].includes(k)?'map':['trace','valueTrace'].includes(k)?'trace':scope;
   const p=path+'/'+k.replace(/~/g,'~0').replace(/\//g,'~1');
   const candidates=nextScope?(available[nextScope]?[available[nextScope]]:[]):Object.values(available);
   let observed;
   if(['feasibility','runtime','behaviorVerified'].includes(k)||(inProof||/\/(?:proofLimits|entryMap|valueTrace|map|trace)$/.test(path))&&proofFields.has(k))observed=candidates.map(s=>s.proof[k]).filter(x=>x!==undefined);
   else if(k==='mapComplete')observed=candidates.map(s=>s.mapComplete).filter(x=>x!==undefined);
   else if(inCoverage&&['complete','truncated','gapCount'].includes(k))observed=candidates.map(s=>s.sourceCoverage[k]);
   if(observed?.length){checkedFields++;if(!observed.some(actual=>JSON.stringify(actual)===JSON.stringify(x)))issues.push({path:p,reported:x,observed:[...new Set(observed)]});}
   walk(x,p,nextScope,k==='proof',k==='sourceCoverage',depth+1);
  }
 }
 walk(value);
 return {valid:issues.length===0,checkedFields,issues,observed:Object.fromEntries(Object.entries(available).map(([k,v])=>[k==='map'?'entryMap':'valueTrace',v]))};
}
module.exports={verify,limits};
