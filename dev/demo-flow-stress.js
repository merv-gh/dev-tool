// A local demo over the same owned native result views used by chat and Admin.
const fs=require('fs'),path=require('path'),http=require('http');
async function serve(home,{port=0}={}){
 home=path.resolve(home);const report=JSON.parse(fs.readFileSync(path.join(home,'report.json')));if(report.protocol!=='dt.flow-stress/v1'||!report.cases.length)throw Error('Expected a completed flow-stress report');
 for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_WORK_DIR','DT_PASSPORTS_DIR','DT_TOOLS','DT_TOOL_PROFILE'])delete process.env[k];Object.assign(process.env,{DT_HOME:home,DT_STATE_BACKEND:'legacy',DT_NO_DOCTOR:'1',DT_LOG:'quiet'});
 const app=require('../server').start({host:'127.0.0.1',port:0});await new Promise(r=>app.once('listening',r));const appBase='http://127.0.0.1:'+app.address().port;
 const cases=report.cases.map(c=>{const id=new URL(c.view).pathname.split('/').pop();if(!/^[a-z0-9]+$/.test(id))throw Error('Invalid native view id');return{...c,view:appBase+'/show/'+id};});
 const data=JSON.stringify({cases,oracles:report.oracles,limits:report.limits}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'),html=fs.readFileSync(path.join(__dirname,'../demo/flow-stress/index.html'),'utf8').replace('/*DEMO_DATA*/',data);
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://demo');if(url.pathname!=='/'){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);});server.listen(port,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;fs.writeFileSync(path.join(home,'demo.json'),JSON.stringify({base,appBase,pid:process.pid}));return{base,appBase,server,app};
}
module.exports={serve};if(require.main===module)(async()=>{const saved=process.argv[2]==='--report',home=saved?process.argv[3]:(await require('./eval-flow-stress').run({home:process.argv[2],url:process.env.DT_SEMANTIC_LIVE_URL,token:process.env.DT_SEMANTIC_LIVE_TOKEN})).home;const demo=await serve(home);console.log(demo.base);})().catch(e=>{console.error(e);process.exitCode=1;});
