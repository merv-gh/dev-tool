// Local presentation of retained real regression results (or labeled built-in samples).
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const port=Number(process.argv[2]||44424),home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-coverage-demo-'));
 Object.assign(process.env,{DT_HOME:home,DT_PUBLIC_URL:'http://127.0.0.1:'+port,DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy'});
 fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({envs:{demo:{}},scripts:{starters:false}}));
 const R=require('../../lib/results'),V=require('../../lib/views'),links={};
 for(const name of ['partial','covered','stale']){const file=path.join(__dirname,'../../work/change-coverage',name+'.json'),real=fs.existsSync(file);let data=real?JSON.parse(fs.readFileSync(file,'utf8')):V.get('workspace-coverage').sample;
  if(!real&&name==='stale')data={...data,state:'stale',stale:true};
  links[name]=R.saveView('workspace-coverage',data,{title:'Changed code coverage · '+name,description:real?'Retained real Lombok regression run; original temporary workspace was cleaned up.':'Illustrative built-in sample; no execution claim.'});}
 links.inline=links.partial+'?embed=1';
 links.branch=R.saveView('tests',{outcome:'passed',counts:{passed:1,tests:1,failed:0},ms:123,command:'Illustrative presentation fixture · branch-only coverage gap',cases:[{class:'demo.QuoteTest',name:'priority',status:'passed',time:0.1}],coverage:{state:'measured',available:true,summary:{covered:3,executable:3,missed:0,unknown:0,missedBranches:1,complete:true},view:links.partial}},{title:'Presentation fixture · branch-only coverage gap'})+'?embed=1';
 const server=require('../../server').start({host:'127.0.0.1',port});await new Promise(r=>server.once('listening',r));
 const mobile=require('node:http').createServer((req,res)=>{const target=links[req.url.slice(1)]||links.partial;res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coverage · 390px frame preview</title><body style="margin:0;width:390px"><iframe title="390px coverage viewport" src="'+target+'" width="390" height="1800" style="border:0;display:block"></iframe>');});await new Promise(r=>mobile.listen(port+1,'127.0.0.1',r));
 fs.mkdirSync(path.join(__dirname,'../../work/change-coverage'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../../work/change-coverage/demo.json'),JSON.stringify({base:'http://127.0.0.1:'+port,mobile:'http://127.0.0.1:'+(port+1),links},null,2));console.log(JSON.stringify({links,port,mobile:port+1}));
 async function stop(){mobile.closeAllConnections();mobile.close();server.closeAllConnections();server.close();await require('../../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});process.exit();}process.on('SIGTERM',stop);process.on('SIGINT',stop);
})().catch(e=>{console.error(e);process.exitCode=1;});
