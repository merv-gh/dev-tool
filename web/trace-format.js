(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DTTraceFormat=factory();})(globalThis,function(){
 function chrome(snapshot){
  const traces=new Map(),events=[];for(const row of snapshot.spans||[]){if(!traces.has(row.traceId))traces.set(row.traceId,traces.size+1);const tid=traces.get(row.traceId),base={name:row.name,cat:row.attributes?.['dt.kind']||'operation',pid:1,tid,id:row.spanId,scope:row.traceId};
   events.push({...base,ph:'b',ts:row.startMs*1000,args:{trace_id:row.traceId,span_id:row.spanId,parent_span_id:row.parentSpanId,...row.attributes}});
   for(const event of row.events||[])events.push({...base,name:event.name,ph:'n',ts:event.time[0]*1e6+event.time[1]/1000,args:event.attributes});
   if(!row.running)events.push({...base,ph:'e',ts:(row.startMs+row.durationMs)*1000,args:{status:row.status}});
  }
  for(const [trace,tid]of traces)events.unshift({ph:'M',name:'thread_name',pid:1,tid,args:{name:trace}});
  return{traceEvents:events,displayTimeUnit:'ms',metadata:{snapshot:true,dropped:snapshot.dropped||0,meaning:snapshot.meaning}};
 }
 return{chrome};
});
