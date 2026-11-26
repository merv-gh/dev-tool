// A combined question keeps its two independent evidence layers and citations.
// The parent job owns observation and cancellation of its child queries.
module.exports = ({S,present,summarize}) => async a => {
  const J=require('./jobs'),E=require('./execution');
  let job;
  if(a.job){
    job=J.find(a.job);
    if(!job||!job.key.startsWith('semantic:navigation:'))throw Error('Combined semantic job is not available');
  }else{
    const {waitMs,all,...selection}=a;
    job=J.start('semantic:navigation:'+require('./semantic-protocol').digest(selection),'semantic entry map and value trace',async()=>{
      const settle=async args=>{
        E.check();let value=await S().query({...args,env:a.env,waitMs:0});
        if(value.state==='running'){
          const child=J.find(value.job);
          if(!child?.promise)throw Error('Semantic child job is owned by another process; observe it on the owning server.');
          const release=E.resource(()=>J.cancel(child.id,'parent semantic navigation cancelled'));
          try{await child.promise;E.check();value=await S().query({job:child.id,waitMs:0});}finally{release();}
        }
        if(value.ready===false)throw Error('Semantic selection is unavailable; list the retained analyses and choose the exact source.');
        if(value.flowMap?.entries.length===0||(value.gaps||[]).some(g=>g.kind==='endpoint-not-found')){const methods=await S().query({analysis:a.analysis,env:a.env,operation:'symbols',kind:'method',limit:20});throw Error('An exact entry or parameter did not resolve. Retained method candidates: '+JSON.stringify((methods.results||[]).map(m=>({name:m.name,parameters:m.parameters?.map(p=>p.name)})))+'. Retry the original requested method/parameter; do not infer no flow.');}
        if(value.error)throw Error(typeof value.error==='string'?value.error:JSON.stringify(value.error));
        return value;
      };
      const map=present(await settle({analysis:a.analysis,operation:'flowmap',from:{name:a.entry}}),{view:'semantic-flow-map',title:'Entry to exits'});
      const trace=present(await settle({analysis:a.analysis,operation:'trace',from:{kind:'method',name:a.entry,parameter:a.parameter},to:{kind:'call',name:a.sink,argument:Number(a.argument)},assumptions:Array.isArray(a.assumptions)?a.assumptions:Object.entries(a.assumptions||{}).map(([expression,holds])=>({expression,holds}))}),{view:'semantic-path-trace',title:'Parameter to sink argument'});
      const m=summarize(map),t=summarize(trace),sinks=[...new Map((t.selectedSinks||[]).map(x=>[JSON.stringify(x),x])).values()];
      const summary={...(m.entries?.length===1?{entry:m.entries[0].name}:{entryCandidates:m.entries||[]}),...(sinks.length===1?{traceSinkCall:sinks[0].traceSinkCall,argumentExpression:sinks[0].argumentExpression}:{sinkCandidates:sinks}),controlAssumptionStatus:t.controlAssumptionStatus,dataAssumptionStatus:t.dataAssumptionStatus,...(t.unmatchedAssumptions?.length?{unmatchedAssumptions:t.unmatchedAssumptions,observedPredicates:t.observedPredicates,assumptionGuidance:t.assumptionGuidance}:{}),behaviorVerified:m.proof?.behaviorVerified===true&&t.proof?.behaviorVerified===true,mapComplete:m.mapComplete??null,mapView:map.view,traceView:trace.view};
      return present({protocol:'dt.semantic-navigation/v1',evidenceType:'entry-map-and-value-trace',summary,answerHint:'Use summary as the answer projection; keep both mapView and traceView URLs exactly as returned.',mapView:map.view,traceView:trace.view,entryMap:{...m,...map},valueTrace:{...t,...trace}},{view:'json',title:'Entry map and independent value trace'});
    });
  }
  const result=await S().waitJob(job,a.waitMs??30000);
  if(result.state==='running')return {...result,next:{tool:'what_happens_from',arguments:{job:job.id,waitMs:30000}},guidance:'Observe this existing combined job; do not repeat the query.'};
  if(result.error||!result.entryMap||!result.valueTrace)return result;
  if(a.all)return {...result,output:{status:'all',scope:'retained-evidence'}};
  return {...result,output:{status:'part',scope:'selected-evidence'},entryMap:require('./semantic-response').compact(summarize(result.entryMap),4096),valueTrace:require('./semantic-response').compact(summarize(result.valueTrace),4096)};
};
