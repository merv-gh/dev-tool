// Small source bundle for a mapping investigation. Heuristic source call chains,
// exact files/revisions, and explicit Joern follow-ups; never runtime lineage.
const crypto=require('node:crypto');
module.exports=function source({workspace,entry,max_output_bytes=16384}) {
  if(!Number.isInteger(max_output_bytes)||max_output_bytes<4096||max_output_bytes>32768)throw Error('max_output_bytes must be 4096..32768');
  const W=require('./workspace'),CI=require('./codeindex'),index=W.index(workspace),key='work/'+workspace;
  const all=require('./flows').flows([key]);
  const matched=entry?all.filter(f=>f.entry===entry||f.method===entry):all;
  const flows=matched.slice(0,5),chain=flows.flatMap(f=>f.chain),graph=index.graph_();
  const files=[...new Set(chain.map(m=>m.at?.replace(/:\d+$/,'')).filter(Boolean))];
  // Include the chain's DTO/type declarations when statically indexed, not every
  // source file from a potentially large repository.
  const ids=new Set(chain.map(m=>m.method.split('#')[0])),classes=new Map((graph.classes||[]).map(c=>[c.id,c]));
  for(const edge of graph.edges||[])if(ids.has(edge[0]?.split('#')[0])&&['uses','member'].includes(edge[2])){
    const c=classes.get(edge[1]);if(c?.file&&!c.test&&!files.includes(c.file))files.push(c.file);
  }
  const r={workspace,source:{sha:index.sha,revisionKey:index.revisionKey},entries:flows.map(f=>({entry:f.entry,method:f.method,chain:f.chain,boundaries:f.out})),files:[],omitted:[],
    proof:{kind:'heuristic-source-context',runtimeLineageVerified:false},gaps:['Heuristic calls can miss overloads, dynamic dispatch, generated accessors, SQL semantics and library code. Use Joern for retained control/data evidence; use HTTP/PG tests for behavior.'],
    next:{semantic_index:{repo:key,language:'java'},read:{workspace,path:files[0]||'src'}}};
  if(matched.length>flows.length)r.gaps.push('Entry list truncated; select an exact entry');
  if(!matched.length)r.gaps.push(entry?'No exact entry; omit entry to list indexed handlers':'No indexed entry points; use code_search then workspace_read');
  for(const file of files.slice(0,20)){
    const read=W.read(workspace,file,{from:1,to:400,lineNumbers:false}),item={path:file,from:read.from,to:read.to,lines:read.lines,revision:read.revision,text:read.text};
    if(read.lines>400)r.gaps.push(file+': source preview ends at line 400');
    r.files.push(item);
    if(Buffer.byteLength(JSON.stringify(r))>max_output_bytes-1200){r.files.pop();r.omitted.push(file);}
  }
  r.omitted.push(...files.slice(20));
  if(r.omitted.length)r.gaps.push('Source budget reached; read omitted files explicitly');
  r.digest=crypto.createHash('sha256').update(JSON.stringify(r.files.map(f=>[f.path,f.revision]))).digest('hex');
  // Large graph/boundary previews must obey the same bound as source snippets.
  while(Buffer.byteLength(JSON.stringify(r))>max_output_bytes&&r.entries.some(e=>e.chain.length>1)){
    const e=r.entries.find(e=>e.chain.length>1);e.chain.pop();r.gaps[0]='Call chain preview bounded. '+r.gaps[0].replace(/^Call chain preview bounded\. /,'');
  }
  if(Buffer.byteLength(JSON.stringify(r))>max_output_bytes){r.entries=r.entries.map(e=>({entry:e.entry,method:e.method}));r.gaps.push('Boundary preview omitted to meet output budget');}
  if(Buffer.byteLength(JSON.stringify(r))>max_output_bytes)return{workspace,source:r.source,entries:[],files:[],omittedCount:files.length,entryCount:matched.length,proof:r.proof,gaps:['Entry/source metadata itself exceeds the preview budget. Read workspace folders/files or use code_search to narrow the handler.'],next:{read:{workspace,path:'src'},semantic_index:{repo:key,language:'java'}}};
  return r;
};
