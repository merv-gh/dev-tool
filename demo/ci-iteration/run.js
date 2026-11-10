// Local disposable REST demo: node demo/ci-iteration/run.js [port]
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-ci-demo-'));Object.assign(process.env,{DT_HOME:home,DT_RATE_PER_SEC:'0',DT_LOG:'quiet',DT_NO_DOCTOR:'1',DT_STATE_BACKEND:'legacy',DT_PUBLIC_URL:'http://127.0.0.1:'+Number(process.argv[2]||44420)});
 const fixture=await require('../../test/helpers/fake-ci').start();fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(fixture.config));
 const server=require('../../server').start({host:'127.0.0.1',port:Number(process.argv[2]||44420)});await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port,T=require('../../lib/tools'),links={};
 const pr={project:'SHOP',repo:'orders',id:42},job='team/orders/PR-42';
 fixture.state.activities=[{user:{name:'Alex · reviewer'},commentAnchor:{path:'src/main/OrderHandler.java',line:42},comment:{id:8,text:'Preserve the order id through the retry path. Add an entry-to-exit regression before changing the mapper.'}}];
 for(const [name,tool,args,change]of [
  ['failed','bitbucket_pr_status',pr,()=>{}],
  ['waiting','jenkins_wait',{job,wait_ms:0,sha:fixture.state.sha},()=>{fixture.state.building=true;}],
  ['tests','jenkins_tests',{job},()=>{fixture.state.building=false;}],
  ['review','bitbucket_pr_status',pr,()=>{fixture.state.result='SUCCESS';}],
  ['ready','bitbucket_pr_status',pr,()=>{fixture.state.approval='APPROVED';}],
  ['jobs','jenkins_jobs',{},()=>{}]
 ]){change();links[name]=(await T.call(tool,args)).view;}
 fs.mkdirSync(path.join(__dirname,'../../work/ci-iteration'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../../work/ci-iteration/demo.json'),JSON.stringify({base,links,home},null,2));const mobile=require('node:http').createServer((req,res)=>{const target=links[req.url.slice(1)]||links.failed;res.setHeader('content-type','text/html');res.end('<!doctype html><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>CI · 390px frame preview</title><body style=\"margin:0;width:390px\"><iframe title=\"390px CI viewport\" src=\"'+target+'\" width=390 height=1800 style=\"border:0;display:block\"></iframe>');});await new Promise(r=>mobile.listen(Number(process.argv[2]||44420)+1,'127.0.0.1',r));console.log(JSON.stringify({base,links,mobilePreview:'http://127.0.0.1:'+(Number(process.argv[2]||44420)+1)}));
 async function stop(){mobile.closeAllConnections();mobile.close();server.closeAllConnections();server.close();await fixture.close();await require('../../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});process.exit();}process.on('SIGTERM',stop);process.on('SIGINT',stop);
})().catch(e=>{console.error(e);process.exitCode=1;});
