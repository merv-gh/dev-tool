// Read-only projection of the bounded durable journal. No model/tool execution.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DTTaskConversation=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const names={confluence_search:'Search Confluence',confluence_page:'Read Confluence page',bitbucket_file:'Read repository file',bitbucket_files:'Browse repository',bitbucket_repos:'Find repositories',task_memory_save:'Save findings',task_memory_read:'Read task memory',task_tool_discover:'Discover tools',task_watch:'Watch CI and review',task_publish:'Publish checked change',find:'Search cached index',code_search:'Search code',code_read:'Read code',pg_query:'Query Postgres',test_run:'Run tests',workspace_write:'Edit workspace file',workspace_open:'Open workspace'};
 const toolName=name=>names[name]||String(name||'tool').replaceAll('_',' ');
 function status(r){
  if(r.controlPending)return {title:toolName(r.controlPending)+' requested',detail:'Saved on the server; waiting for worker acknowledgement.',action:null};
  if(r.state==='needs_attention')return {title:'Needs your attention',detail:(r.reason||'Review the retained evidence before resuming.')+(/Task (budget|deadline) reached/i.test(r.reason||'')?' Prepare a new run using the retained memory.':''),action:r.pending?.kind==='tool'?'resolve':/context|compact/i.test(r.reason||'')?'context':/Task (budget|deadline) reached/i.test(r.reason||'')?'continue':'brief'};
  if(r.state==='paused')return {title:'Paused',detail:r.reason||'No work is running. Edit files, send a direction, or resume when ready.',action:null};
  if(r.state==='completed')return {title:'Completed · results saved',detail:r.reason||'The answer and evidence are retained in task memory.',action:null};
  if(r.state==='cancelled')return {title:'Stopped',detail:r.reason||'Retained findings are still available.',action:null};
  if(r.state==='waiting')return {title:r.watch?'Waiting for CI / review':'Waiting to retry',detail:r.reason||(r.watch?'Observing '+toolName(r.watch.tool)+'. Unchanged observations do not call the model.':'The server will retry within the retained budget.'),action:r.watch?'checks':null};
  if(r.pending?.kind==='tool')return {title:toolName(r.pending.tool),detail:'Tool call in progress. Inspect completed receipts in the conversation.',action:null};
  if(r.pending?.kind==='compaction')return {title:'Compacting context',detail:'Saving a continuation summary; the full transcript stays retained.',action:null};
  if(r.pending?.kind==='model')return {title:'Waiting for model response',detail:'The next message appears when the provider responds. You can pause or stop.',action:null};
  return {title:r.state==='queued'?'Queued for worker':'Preparing the next step',detail:'Execution belongs to the server; you can close this browser.',action:null};
 }
 function rows(events){
  const out=[];let group=null;
  const flush=()=>{if(group){out.push(group);group=null;}};
  for(const e of [...events].sort((a,b)=>a.cursor-b.cursor)){
   if(e.type==='model.completed'&&e.content){flush();out.push({key:'message-'+e.cursor,kind:'assistant',at:e.at,text:e.content,truncated:e.contentTruncated});}
   else if(e.type==='tool.completed'){
    if(e.failed){flush();out.push({key:'failure-'+e.cursor,kind:'failure',at:e.at,event:e});}
    else{group||={key:'work-'+e.cursor,kind:'work',at:e.at,events:[]};group.events.push(e);}
   }else if(e.type==='control'){
    flush();out.push({key:'control-'+e.cursor,kind:e.action==='steer'?'user':'notice',at:e.at,text:e.action==='steer'?e.message:toolName(e.action)+(e.message?' · '+e.message:''),acknowledged:true});
   }else if(['blocked','published','code.pushed','watch.changed','watch.started','model.backoff','context.compaction.started','context.compacted','context.overflow','recovered'].includes(e.type)){
    flush();out.push({key:'notice-'+e.cursor,kind:e.type==='blocked'?'blocker':'notice',at:e.at,text:e.message||(e.type==='published'?'Global knowledge published · '+e.revision?.slice(0,12):e.type==='code.pushed'?'Pushed '+e.branch+' · '+e.commit?.slice(0,12):e.type==='watch.changed'?'CI / review changed · '+e.state:e.type==='context.overflow'?'Provider context limit; reducing active context':e.type==='context.compaction.started'?'Saving an automatic context checkpoint':e.type==='context.compacted'?'Context compacted; transcript retained · '+e.beforeBytes+' → '+e.afterBytes+' bytes':e.type==='model.backoff'?'Provider unavailable; retry '+(e.attempt||1)+' scheduled at '+e.retryAt:e.type==='recovered'?'Recovered retained work after an interruption':'CI / review watch saved')});
   }
  }
  flush();return out;
 }
 return {toolName,status,rows};
});
