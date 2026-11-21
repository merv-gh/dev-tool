// Real server/tools/storage with explicitly synthetic model, Confluence and
// repository REST fixtures. It never contacts an external model or service.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
async function start({port=0,modelDelayMs=0}={}) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-task-desk-demo-'));
  for(const key of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_TOOLS','DT_TOOL_PROFILE','DT_API_KEY','DT_PUBLIC_URL'])delete process.env[key];
  Object.assign(process.env,{DT_HOME:home,DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0',DT_STATE_BACKEND:'legacy',DT_LOG:'quiet'});
  const calls=[];
  const tool=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
  const fixture=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');calls.push(url.pathname);res.setHeader('content-type','application/json');
    if(url.pathname==='/v1/chat/completions'){
      let data='';for await(const chunk of req)data+=chunk;const payload=JSON.parse(data),step=payload.messages.filter(m=>m.role==='assistant').length;
      if(modelDelayMs)await new Promise(resolve=>setTimeout(resolve,modelDelayMs));
      let content=null,tool_calls;
      if(step===0)tool_calls=[tool('requirements','confluence_search',{text:'checkout validation',space:'SHOP'})];
      else if(step===1)tool_calls=[tool('page','confluence_page',{id:'42'}),tool('code','bitbucket_file',{project:'SHOP',repo:'checkout-service',path:'src/main/java/Checkout.java',at:'demo-main'})];
      else if(step===2)tool_calls=[tool('save','task_memory_save',{path:'checkout-requirements.md',summary:'Requirements, source mapping and a proposed integration regression',content:'# Checkout findings\n\nConfluence page 42, version 7: reject negative totals; zero is valid.\n\nSHOP/checkout-service @ demo-main, Checkout.java:4 uses total <= 0, which rejects zero. This is static evidence, not runtime proof.\n\nSuggested entry-to-exit regression: POST an order with total=0, assert acceptance and its persisted value; negative totals must return validation failure.\n\nGap: no service test has run in research mode.'})];
      else content='Checkout rejects zero although the requirement allows it.\n\nEvidence: Confluence page 42 version 7; SHOP/checkout-service @ demo-main, src/main/java/Checkout.java:4.\n\nThe condition total <= 0 appears responsible. Verify a change to total < 0 with an outside-in regression covering zero and negative values. This investigation read code and requirements; it did not execute the service or establish runtime proof.\n\nThe cited findings and suggested regression are retained in task memory.';
      if(tool_calls)content=step===0?'I’ll compare the checkout requirement with the service code, then save the cited findings.':step===1?'I found the checkout requirement. Next I’ll read its current version and the service implementation.':'The requirement permits zero totals, while Checkout.java rejects them. I’ll retain the evidence and a proposed integration regression. No test has run.';
      return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content,...(tool_calls?{tool_calls}:{})}}],usage:{prompt_tokens:1800+step*300,completion_tokens:150,total_tokens:1950+step*300}}));
    }
    if(url.pathname==='/rest/api/content/search')return res.end(JSON.stringify({results:[{id:'42',title:'Checkout total validation',_expandable:{space:'/rest/api/space/SHOP'},_links:{webui:'/pages/42'}}]}));
    if(url.pathname==='/rest/api/content/42')return res.end(JSON.stringify({id:'42',title:'Checkout total validation',space:{key:'SHOP'},version:{number:7},body:{storage:{value:'<h1>Order total</h1><p>Reject a negative total. Zero is valid for promotional orders.</p>'}}}));
    if(url.pathname==='/rest/api/1.0/repos')return res.end(JSON.stringify({isLastPage:true,values:[{slug:'checkout-service',name:'Checkout service',project:{key:'SHOP'}},{slug:'order-library',name:'Order library',project:{key:'SHOP'}}]}));
    if(url.pathname.includes('/raw/')){res.setHeader('content-type','text/plain');return res.end('package shop;\nclass Checkout {\n  boolean accepts(int total) {\n    return !(total <= 0);\n  }\n}\n');}
    res.writeHead(404);res.end(JSON.stringify({error:'Unknown synthetic endpoint'}));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:' + fixture.address().port;
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{dev:{}},llm:{baseUrl:endpoint+'/v1',model:'synthetic-small-model',contextWindow:262144},bitbucket:{url:endpoint,token:'demo-bitbucket'},confluence:{url:endpoint,token:'demo-confluence'},scripts:{starters:false}}));
  const server=require('../server').start({port,host:'127.0.0.1'});await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:' + server.address().port;
  const configFile=path.join(home,'config.json'),config=JSON.parse(fs.readFileSync(configFile,'utf8'));config.server={publicUrl:base};fs.writeFileSync(configFile,JSON.stringify(config));require('../lib/config').reload();
  return {base,home,calls,url:base+'/tasks',async close(){await require('../lib/task-harness').close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));await require('../lib/isolate').stop();await require('../lib/state-store').close();await require('../lib/observations').close();fs.rmSync(home,{recursive:true,force:true});}};
}
module.exports={start};
if(require.main===module)start({port:Number(process.argv[2]||0)}).then(d=>{console.log(JSON.stringify({url:d.url,fixture:'Synthetic model/Confluence/repository; real UI, tools and persistent storage'}));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>d.close().then(()=>process.exit()));}).catch(error=>{console.error(error);process.exitCode=1;});
