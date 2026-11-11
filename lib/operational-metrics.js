// Aggregate health is independent of per-story trace consent. No arguments,
// identifiers, SQL, names, URLs or credentials become metric dimensions.
const {isMainThread}=require('node:worker_threads'),{monitorEventLoopDelay}=require('node:perf_hooks');
const kinds=new Set(['call','job','refresh','network','adapter','admission','model']),rows=new Map();
let provider,reader,histogram,counter,cleanupCounter,loop,activeConfig,cleanupFailures=0,started=false,failures=0,lastError=null;
function config(){try{const C=require('./config'),raw=C.load().raw.telemetry||{},s=require('./telemetry').settings();return {enabled:process.env.DT_OPERATIONAL_METRICS?process.env.DT_OPERATIONAL_METRICS==='1':raw.operationalMetrics===true,endpoint:s.metricsEndpoint||(s.endpoint?s.endpoint.replace(/\/$/,'')+'/v1/metrics':'')};}catch{return {enabled:false,endpoint:''};}}
function start(){
 if(started||!isMainThread||!config().enabled)return;started=true;activeConfig=config();loop=monitorEventLoopDelay({resolution:20});loop.enable();
 try{
  const {endpoint}=config();if(!endpoint)return;
  const {MeterProvider,PeriodicExportingMetricReader}=require('@opentelemetry/sdk-metrics'),{OTLPMetricExporter}=require('@opentelemetry/exporter-metrics-otlp-http');
  const exporter=new OTLPMetricExporter({url:endpoint,timeoutMillis:2000}),send=exporter.export.bind(exporter);
  exporter.export=(data,done)=>send(data,r=>{if(r.code){failures++;lastError='OTLP metrics export failed';}done(r);});
  reader=new PeriodicExportingMetricReader({exporter,exportIntervalMillis:10000,exportTimeoutMillis:2500});
  provider=new MeterProvider({readers:[reader]});const meter=provider.getMeter('dev-tool.operations');
  histogram=meter.createHistogram('dt.operations.duration',{unit:'ms'});counter=meter.createCounter('dt.operations.completed');cleanupCounter=meter.createCounter('dt.cleanup.incomplete');
  const gauges=[['dt.process.rss','By',()=>process.memoryUsage().rss],['dt.process.heap','By',()=>process.memoryUsage().heapUsed],['dt.event_loop.p99','ms',()=>Number.isFinite(loop.percentile(99))?loop.percentile(99)/1e6:0]];
  for(const [name,unit,value]of gauges)meter.createObservableGauge(name,{unit}).addCallback(r=>r.observe(value()));
  meter.createObservableGauge('dt.scheduler.active').addCallback(r=>{for(const [resource,s]of Object.entries(require('./limit').stats()))r.observe(s.running,{resource});});
  meter.createObservableGauge('dt.scheduler.queued').addCallback(r=>{for(const [resource,s]of Object.entries(require('./limit').stats()))r.observe(s.queued,{resource});});
  meter.createObservableGauge('dt.telemetry.export_failures').addCallback(r=>r.observe(failures));
  meter.createObservableGauge('dt.catalog.age',{unit:'s'}).addCallback(r=>{for(const env of require('./config').envNames().slice(0,50)){try{const s=require('./catalog-store').status(env);if(s.at)r.observe(Math.max(0,(Date.now()-Date.parse(s.at))/1000),{env});}catch{}}});
  meter.createObservableGauge('dt.telemetry.dropped').addCallback(r=>r.observe(require('./telemetry').health().dropped));
 }catch{failures++;lastError='Operational metrics initialization failed';}
}
function record(kind,ms,outcome='succeeded'){
 if(!isMainThread||!config().enabled)return;start();kind=kinds.has(kind)?kind:'call';outcome=['succeeded','failed','cancelled','rejected'].includes(outcome)?outcome:'failed';
 const key=kind+':'+outcome,row=rows.get(key)||{kind,outcome,count:0,durationMs:0};row.count++;row.durationMs+=Math.max(0,Number(ms)||0);rows.set(key,row);
 try{counter?.add(1,{kind,outcome});histogram?.record(Math.max(0,Number(ms)||0),{kind,outcome});}catch{failures++;}
}
async function measure(kind,fn){const t=performance.now();try{const result=await fn();record(kind,performance.now()-t);return result;}catch(e){record(kind,performance.now()-t,e.code==='DT_CANCELLED'||e.name==='AbortError'?'cancelled':'failed');throw e;}}
function cleanup(count){if(!isMainThread||!config().enabled)return;start();cleanupFailures+=count;try{cleanupCounter?.add(count);}catch{failures++;}}
function snapshot(){require('./access').requireAdmin();start();return {enabled:config().enabled,exportConfigured:!!config().endpoint,restartRequired:started&&JSON.stringify(activeConfig)!==JSON.stringify(config()),memory:process.memoryUsage(),eventLoopP99Ms:loop&&Number.isFinite(loop.percentile(99))?loop.percentile(99)/1e6:null,operations:[...rows.values()],cleanupFailures,exportFailures:failures,lastError,workers:require('./isolate').status(),scheduler:require('./limit').stats()};}
async function flush(){await provider?.forceFlush();}
async function stop(){loop?.disable();await provider?.shutdown();provider=null;started=false;}
module.exports={start,record,measure,snapshot,flush,stop,cleanup};
