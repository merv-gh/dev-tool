// Opt-in real-model evaluation. Run only against an explicitly supplied loopback SSH tunnel.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const QUESTIONS=[
 {id:'trace',prompt:'Which service publishes orders.created, which service consumes it, and which exact database/table does the publisher write? Use cached evidence, and give a read-only SQL suggestion without querying live systems. Return JSON {producer,consumer,database,table,sql}.',grade:answer=>answer?.producer?.replace(/^svc:/,'')==='orders'&&answer?.consumer?.replace(/^svc:/,'')==='shipping'&&answer?.database==='db0'&&answer?.table==='sales.records_0'&&(/^SELECT \* FROM (?:"sales"\."records_0"|sales\.records_0) LIMIT 20;?$/i).test(answer?.sql||'')},
 {id:'feature',prompt:'Keep a feature layer with id shipment-checkout and title Shipment checkout for this requested flow: shop-ui -> orders -> orders.created -> shipping. Discover exact entities first, label this as a user-described flow rather than executed proof, persist it, and verify it can be found again. Do not open the browser or call live infrastructure.',grade:(_,M)=>M.layers({env:'test'}).layers.some(l=>l.id==='shipment-checkout')},
 {id:'library',prompt:'Do the services orders and shipping depend on the internal common library? Libraries might be hidden in the default view. Inspect cached evidence and report the dependent services, without claiming any runtime proof. Return JSON {library,services}.',grade:answer=>typeof answer?.library==='string'&&answer.library.includes('common')&&['orders','shipping'].every(s=>answer?.services?.some(value=>value.replace(/^svc:/,'')===s))},
];
function parseAnswer(text){
 const candidates=[String(text||''),...[...String(text||'').matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m=>m[1])];
 for(const candidate of candidates)try{return JSON.parse(candidate);}catch{}
 return undefined;
}
function regrade(report){const M=require('../lib/service-map');for(const item of report.questions){const q=QUESTIONS.find(q=>q.id===item.id);item.parsed=parseAnswer(item.answer);item.passed=q?q.grade(item.parsed,M):item.id==='live-data'&&item.parsed?.database==='db0'&&item.parsed?.table==='sales.records_0'&&Number(item.parsed?.count)===7&&Number(item.parsed?.total)===280;}report.grader='map-answer-v2-fenced-json';return report;}
async function run({endpoint,model='qwen3.5:4b',output,live=false}){
 const url=new URL(endpoint);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:')throw Error('Use an explicit loopback SSH tunnel endpoint');if(!output)throw Error('Output path required');
 const T=require('../lib/tools'),M=require('../lib/service-map'),names=['map','map_search','map_neighbors','map_path','map_node','map_layers','map_save','pg_query','pg_table','tool_search','tool_describe','tool_profiles','tool_execute'];
 const definitions=(await T.schemas({profile:'map'})).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
 const report={model,endpoint,profile:'map',exposedTools:definitions.map(t=>t.function.name),sourceSha256:crypto.createHash('sha256').update(['service-map.js','tools-map.js','tool-profiles.js','pg.js'].map(f=>fs.readFileSync(path.join(__dirname,'../lib',f),'utf8')).join('\n')+fs.readFileSync(path.join(__dirname,'../web/map-format.js'),'utf8')).digest('hex'),grader:'map-answer-v2-fenced-json',synthetic:true,startedAt:new Date().toISOString(),estate:await M.overview({env:'test'}),questions:[]};
 const persist=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
 const cases=[...QUESTIONS,...(live?[{id:'live-data',prompt:'Find the table written by the producer of orders.created, then query the isolated test database to find its row count and sum(total). This test permits read-only queries against db0 only. Return JSON {database,table,count,total}.',grade:answer=>answer?.database==='db0'&&answer?.table==='sales.records_0'&&Number(answer?.count)===7&&Number(answer?.total)===280}]:[])];
 for(const question of cases){
  const item={id:question.id,prompt:question.prompt,messages:[],calls:[],passed:false},messages=[{role:'system',content:'Investigate cached architecture using the available tools. Use exact ids from results, state uncertainty and never invent evidence. The default environment is test. Keep responses short.'},{role:'user',content:question.prompt}];report.questions.push(item);const deadline=Date.now()+240000;
  for(let turn=0;turn<16&&Date.now()<deadline;turn++){
   const response=await fetch(endpoint.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:false,think:true,keep_alive:'1m',messages,tools:definitions,options:{temperature:0,num_ctx:32768,num_predict:4096}}),signal:AbortSignal.timeout(90000)});
   if(!response.ok){item.error=await response.text();break;}const body=await response.json(),message=body.message;messages.push(message);item.messages.push(message);persist();
   if(!message.tool_calls?.length){item.answer=message.content;item.parsed=parseAnswer(message.content);item.passed=question.grade(item.parsed,M);break;}
   for(const call of message.tool_calls){let args=call.function.arguments,result;try{if(typeof args==='string')args=JSON.parse(args);if(!names.includes(call.function.name))throw Error('Tool not permitted in this synthetic evaluation');if(call.function.name==='tool_execute'&&!names.includes(args.name))throw Error('Target tool not permitted in evaluation');if((call.function.name==='pg_query'||call.function.name==='tool_execute'&&args.name==='pg_query')&&(!live||(call.function.name==='tool_execute'?args.arguments:args)?.db!=='db0'||(call.function.name==='tool_execute'?args.arguments:args)?.env&& (call.function.name==='tool_execute'?args.arguments:args).env!=='test'))throw Error('This evaluation only permits live queries to its isolated db0 fixture');result=await T.call(call.function.name,args,{source:'map-model-eval'});}catch(e){result={error:e.message};}item.calls.push({tool:call.function.name,args,result});messages.push({role:'tool',tool_name:call.function.name,content:JSON.stringify(result)});persist();}
  }
  if(!item.answer)item.error||='Turn/time budget exhausted';persist();console.log(JSON.stringify({id:item.id,passed:item.passed,calls:item.calls.length,error:item.error}));
 }
 report.completedAt=new Date().toISOString();persist();return report;
}
module.exports={run,QUESTIONS,parseAnswer,regrade};
if(require.main===module){const args=Object.fromEntries(process.argv.slice(2).reduce((out,arg,i,all)=>{if(i%2===0)out.push([arg.replace(/^--/,''),all[i+1]]);return out;},[]));run(args).catch(e=>{console.error(e);process.exitCode=1;});}
