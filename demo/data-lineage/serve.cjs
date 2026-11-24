// Disposable source/catalog fixture. No live service or database requests.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
async function start({port=4103}={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-data-lineage-demo-'));
 process.env.DT_HOME=home;process.env.DT_CONFIG_DIR=home;process.env.DT_CACHE_DIR=path.join(home,'cache');process.env.DT_PASSPORTS_DIR=path.join(home,'passports');process.env.DT_TRUST_NETWORK='1';process.env.DT_NO_DOCTOR='1';process.env.DT_RATE_PER_SEC='0';
 const {put}=require('./fixture.cjs').seed(home),server=require('../../server').start({host:'127.0.0.1',port});
 await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 process.env.DT_PUBLIC_URL=base;require('../../lib/config').reload();
 const call=async(name,args)=>{const response=await fetch(base+'/api/tool/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const body=await response.json();if(!response.ok||body.error)throw Error(JSON.stringify(body));return body.result;};
 const pending=await call('data_readers',{env:'dev',name:'alpha:public.person.legal_name'});
 if(pending.job)await call('data_index',{job:pending.job.id,waitMs:30000});
 const cases={pending,
  readers:await call('data_readers',{env:'dev',name:'alpha:public.person.legal_name'}),
  writers:await call('data_writers',{env:'dev',name:'alpha:public.person.legal_name'}),
  library:await call('data_trace',{env:'dev',from:'GET /person/42',service:'person-api',to:'alpha:public.person.legal_name'}),
  kafka:await call('data_trace',{env:'dev',from:'POST /person/update',to:'es:people-search'}),
  candidates:await call('data_readers',{env:'dev',name:'alpha:public.person.legal_name',mode:'mentions'}),
  ambiguous:await call('data_readers',{env:'dev',name:'public.person.legal_name'}),
  missing:await call('data_readers',{env:'dev',name:'alpha:public.person.missing'})};
 const close=async()=>{await new Promise(resolve=>server.close(resolve));await require('../../lib/isolate').stop();await require('../../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});};
 return {base,cases,call,home,put,close};
}
if(require.main===module){const i=process.argv.indexOf('--port'),port=i>=0?Number(process.argv[i+1]):4103;start({port}).then(demo=>{console.log(JSON.stringify({fixture:'Synthetic sources/catalog; real tools, SQLite and HTTP',base:demo.base,views:Object.fromEntries(Object.entries(demo.cases).map(([k,r])=>[k,r.view]))},null,2));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>demo.close().then(()=>process.exit()));}).catch(error=>{console.error(error);process.exitCode=1;});}
module.exports={start};
