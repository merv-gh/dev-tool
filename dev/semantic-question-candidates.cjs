// Evaluation-only adapters. These are not registered production tools.
const str=description=>({type:'string',minLength:1,description});
const all={type:'boolean',default:false,description:'Full retained evidence instead of selected facts; source coverage limits still apply.'};
const definitions=[
 {name:'analysis_list',question:'which_analyses_exist',description:'List current retained code analyses and exact ids. Read-only; never starts a parse.',inputSchema:{type:'object',properties:{all},additionalProperties:false}},
 {name:'entry_exit_map',question:'what_happens_from',description:'Map a whole entry method: decisions, value changes, exit calls, assumptions and coverage. Static evidence, not runtime proof.',inputSchema:{type:'object',properties:{analysis:str('Retained analysis id'),entry:str('Entry method name'),all},required:['analysis','entry'],additionalProperties:false}},
 {name:'value_trace',question:'where_value_flows',description:'Trace an entry parameter to a sink call argument. Return data and control assumption evaluations separately; neither proves runtime behavior.',inputSchema:{type:'object',properties:{analysis:str('Retained analysis id'),entry:str('Entry method name'),parameter:str('Entry parameter name'),sink:str('Target call name'),argument:{type:'integer',minimum:1,maximum:64,default:1},assumptions:{type:'array',maxItems:20,items:{type:'object',properties:{expression:str('Exact guard expression'),holds:{type:'boolean'}},required:['expression','holds'],additionalProperties:false}},all},required:['analysis','entry','parameter','sink'],additionalProperties:false}}
];
function schemas(question=false,brief=false){return definitions.map(({name,question:alias,...d})=>{
 const schema={...d,name:question?alias:name};
 if(brief&&name==='value_trace'){
  schema.description+=' Pass user-specified predicates in assumptions; omitted or [] means no declared assumptions. Read evaluation strings in assumptionChecks.data and assumptionChecks.control; declaredAssumptions contains inputs, not evaluation results.';
  schema.inputSchema={...schema.inputSchema,properties:{...schema.inputSchema.properties,assumptions:{...schema.inputSchema.properties.assumptions,description:'User-specified predicate assumptions to evaluate. Omitted or [] means none; never infer false automatically.'}}};
 }
 return schema;
});}
const proof=r=>({status:r.proof?.status,feasibility:r.proof?.feasibility,runtime:r.proof?.runtime,behaviorVerified:r.proof?.behaviorVerified});
async function call(T,name,args={},brief=false){
 const def=definitions.find(d=>d.name===name||d.question===name);if(!def)throw Error('Unknown candidate tool');require('../lib/schema').assert(args,def.inputSchema);
 let raw;
 if(def.name==='analysis_list')raw=await T.call('semantic_index',{all:true});
 else if(def.name==='entry_exit_map')raw=await T.call('semantic_query',{analysis:args.analysis,operation:'flowmap',from:{name:args.entry},all:true});
 else raw=await T.call('semantic_trace',{analysis:args.analysis,from:{kind:'method',name:args.entry,parameter:args.parameter},to:{kind:'call',name:args.sink,argument:args.argument??1},assumptions:args.assumptions||[],all:true});
 if(args.all||raw.state==='running'||raw.error)return raw;
 if(def.name==='analysis_list')return {analyses:raw.analyses.map(a=>({id:a.id,repo:a.repo,sha:a.sha,coverage:a.coverage})),view:raw.view};
 const common={output:{status:'part',scope:'selected-evidence',sourceTruncated:!!raw.truncated},proof:proof(raw),view:raw.view};
 if(def.name==='entry_exit_map')return {...common,complete:raw.flowMap?.complete,entries:raw.flowMap?.methods.map(m=>({name:m.name,file:m.file,line:m.line})),exits:raw.flowMap?.nodes.filter(n=>n.exit).map(n=>({code:n.code,kind:n.exit,file:n.file,line:n.line})),changes:raw.flowMap?.nodes.flatMap(n=>n.changes||[]),assumptions:raw.flowMap?.assumptions,gaps:raw.gaps};
 if(brief)return {...common,declaredAssumptions:raw.assumptions,sinks:raw.sides?.flatMap(s=>s.data.paths.map(p=>({side:s.side,code:p.nodes?.at(-1)?.code,file:p.nodes?.at(-1)?.file,line:p.nodes?.at(-1)?.line}))),assumptionChecks:{data:raw.sides?.flatMap(s=>s.data.paths.map(p=>({side:s.side,evaluation:p.assumptionEvaluation.status,unresolved:p.assumptionEvaluation.unresolved,conflicts:p.assumptionEvaluation.conflicts}))),control:raw.sides?.flatMap(s=>s.control.paths.map(p=>({side:s.side,evaluation:p.assumptionEvaluation.status,conditions:p.conditions?.map(c=>({expression:c.expression,polarity:c.polarity})),unresolved:p.assumptionEvaluation.unresolved,conflicts:p.assumptionEvaluation.conflicts})))},gaps:raw.gaps};
 return {...common,assumptions:raw.assumptions,sides:raw.sides?.map(s=>({side:s.side,data:{status:s.data.status,paths:s.data.paths.map(p=>({sink:((n)=>({code:n?.code,file:n?.file,line:n?.line}))(p.nodes?.at(-1)),assumptionEvaluation:p.assumptionEvaluation}))},control:{status:s.control.status,paths:s.control.paths.map(p=>({conditions:p.conditions?.map(c=>({expression:c.expression,polarity:c.polarity})),assumptionEvaluation:p.assumptionEvaluation}))}})),gaps:raw.gaps};
}
module.exports={schemas,call};
