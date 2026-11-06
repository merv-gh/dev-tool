// Operator/read-only runtime projections; mutation is limited to cancellation and annotations.
const A=require('./access'),E=require('./execution'),S=require('./state-store');
async function status(){try{await S.flush();}catch{}return {identity:A.owner(),executions:E.list({limit:100}),jobs:require('./jobs').list(50),storage:S.status(),config:{...require('./tools').registryStatus(),...require('./config').generation(),registryRevision:require('./tools').registryStatus().revision},scheduler:require('./limit').status(),...(A.current().role==='admin'?{operations:require('./operational-metrics').snapshot(),catalogs:require('./config').envNames().map(env=>({env,...require('./catalog-store').status(env)}))}:{}),runtimes:require('./js').runtimes(),cells:require('./js').cells(),trace:require('./trace').export({lines:300})};}
async function handle(req,res,url,send,readBody){const p=url.pathname;
 if(req.method==='GET'&&p==='/api/admin/runtime/observability'){send(res,200,await require('./telemetry').snapshot({traceId:url.searchParams.get('trace')||undefined}));return true;}
 if(req.method==='POST'&&p==='/api/admin/runtime/observability'){send(res,200,require('./telemetry').setEnabled((await readBody(req)).enabled));return true;}
 if(req.method==='GET'&&p==='/api/admin/runtime/observability/export'){send(res,200,require('./telemetry').chrome(await require('./telemetry').snapshot({traceId:url.searchParams.get('trace')||undefined})));return true;}
 if(req.method==='GET'&&p==='/api/admin/runtime/coverage'){send(res,200,require('./coverage').current());return true;}
 if(req.method==='GET'&&p==='/api/admin/runtime/coverage/source'){send(res,200,require('./coverage').source(url.searchParams.get('path')));return true;}
 if(req.method==='GET'&&p==='/api/admin/runtime'){send(res,200,await status());return true;}
 if(req.method==='GET'&&p==='/api/admin/runtime/trace'){const id=url.searchParams.get('execution');if(id&&!E.get(id)){send(res,404,{error:'No execution in this story'});return true;}send(res,200,require('./trace').export({executionId:id,lines:1500}));return true;}
 const execution=p.match(/^\/api\/admin\/execution\/([^/]+)(\/cancel)?$/);if(execution){const id=decodeURIComponent(execution[1]);if(req.method==='GET'&&!execution[2]){const item=E.get(id);send(res,item?200:404,item||{error:'Execution not found'});return true;}if(req.method==='POST'&&execution[2]){const b=await readBody(req);send(res,200,E.cancel(id,b.reason||'Cancelled from Admin'));return true;}}
 if(req.method==='GET'&&p==='/api/admin/metadata'){send(res,200,await S.list({kind:url.searchParams.get('kind')||'calls',limit:Math.max(1,Math.min(500,Number(url.searchParams.get('limit'))||50)),before:url.searchParams.get('after')||url.searchParams.get('before')||undefined}));return true;}
 const metadata=p.match(/^\/api\/admin\/metadata\/(calls|jobs|executions)\/([^/]+)$/);if(metadata){const [,kind,raw]=metadata,id=decodeURIComponent(raw);if(req.method==='GET'){const item=await S.get(kind,id);send(res,item?200:404,item||{error:'Metadata not found'});return true;}if(req.method==='POST'){send(res,200,await S.edit(kind,id,await readBody(req)));return true;}}
 return false;
}
module.exports={status,handle};
