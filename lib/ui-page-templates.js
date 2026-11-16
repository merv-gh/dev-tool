const ref=name=>({$param:name});
const environments={left_env:{type:'environment',label:'Baseline environment',default:'dev'},right_env:{type:'environment',label:'Compare environment',default:'uat'}};
const templates={
 'service-versions':{
  version:1,title:'Service versions across environments',description:'Compare reported deployments without mistaking missing version information for a match.',
  inputs:{...environments,services:{type:'services',label:'Services',default:['orders-api','billing-api']}},
  sources:[{id:'baseline',label:'Baseline deployments',tool:'ui_page_data',arguments:{kind:'service_versions',env:ref('left_env'),services:ref('services')}},{id:'candidate',label:'Comparison deployments',tool:'ui_page_data',arguments:{kind:'service_versions',env:ref('right_env'),services:ref('services')}}],
  datasets:[{id:'all_deployments',op:'concat',from:['baseline','candidate']},{id:'version_changes',op:'compare',left:'baseline',right:'candidate',key:['service'],fields:['version','commit','version_state'],required:['version']}],
  widgets:[{id:'how_to',type:'text',collapsed:true,title:'Reported deployments',text:'Choose environments and services, then Refresh. Mixed replicas and unreported versions stay visible. This is an observation from Consul and /version, not proof that instances run identical code.',span:2},
   {id:'replicas',type:'metric',title:'Registered replicas',data:'all_deployments',op:'sum',field:'replicas'},
   {id:'changes',type:'metric',title:'Services with differing version reports',data:'version_changes',op:'count',where:{field:'status',op:'eq',value:'changed'}},
   {id:'versions_table',type:'table',title:'Service versions by environment',data:'all_deployments',span:2,columns:[{field:'service',label:'Service'},{field:'environment',label:'Environment'},{field:'version',label:'Version'},{field:'replicas',label:'Replicas',format:'number'},{field:'passing',label:'Passing',format:'number'},{field:'version_state',label:'Version evidence',format:'status'}]},
   {id:'drift',type:'comparison',title:'Deployment report differences',data:'version_changes',leftLabel:'Baseline',rightLabel:'Comparison',span:2}]
 },
 'procedure-parity':{
  version:1,title:'Database routine parity',description:'Find missing procedures and changed function definitions across two exact environment/database targets.',
  inputs:{...environments,left_db:{type:'database',label:'Baseline database',default:'orders',environment:'left_env'},right_db:{type:'database',label:'Compare database',default:'orders',environment:'right_env'},schemas:{type:'strings',label:'Schemas',default:['public']}},
  sources:[{id:'baseline',label:'Baseline routines',tool:'ui_page_data',arguments:{kind:'pg_routines',env:ref('left_env'),db:ref('left_db'),schemas:ref('schemas')}},{id:'candidate',label:'Comparison routines',tool:'ui_page_data',arguments:{kind:'pg_routines',env:ref('right_env'),db:ref('right_db'),schemas:ref('schemas')}}],
  datasets:[{id:'routine_changes',op:'compare',left:'baseline',right:'candidate',key:['schema','name','arguments'],fields:['kind','returns','language','definition_hash']}],
  widgets:[{id:'identity',type:'text',collapsed:true,title:'Compare exact routine signatures',text:'Function and procedure overloads are separate objects: schema + name + identity arguments. Only a successful, complete query establishes absence. Definition hashes detect changes without returning large procedure bodies.',span:2},
   {id:'absent',type:'metric',title:'Only in baseline',data:'routine_changes',op:'count',where:{field:'status',op:'eq',value:'only-left'}},
   {id:'changed',type:'metric',title:'Changed definitions or result types',data:'routine_changes',op:'count',where:{field:'status',op:'eq',value:'changed'}},
   {id:'parity',type:'comparison',title:'Routine differences',data:'routine_changes',leftLabel:'Baseline database',rightLabel:'Comparison database',span:2}]
 },
 'environment-monitor':{
  version:1,title:'Environment watch',description:'A compact, explicitly refreshed health board with retained observations.',
  inputs:{env:{type:'environment',label:'Environment',default:'dev'}},
  sources:[{id:'services',tool:'health',arguments:{env:ref('env'),only_unhealthy:true}}, {id:'service_summary',tool:'health',arguments:{env:ref('env')},select:'summary'}, {id:'elastic',tool:'es_health',arguments:{env:ref('env')},select:'summary'},{id:'consumers',tool:'kafka_lag',arguments:{env:ref('env'),top:20}}],
  datasets:[],widgets:[{id:'usage',type:'text',collapsed:true,title:'An observation you can reproduce',text:'Refresh runs only the listed read tools. Monitoring is paused by default; choose an interval to opt in. A failed source is unavailable, never a green zero.',span:2},
   {id:'down',type:'metric',title:'Services down',data:'service_summary',op:'value',field:'down'},
   {id:'es',type:'metric',title:'Elasticsearch status',data:'elastic',op:'value',field:'status'},
   {id:'service_table',type:'table',title:'Services needing attention',data:'services',columns:[{field:'service',label:'Service'},{field:'status',label:'Status',format:'status'},{field:'passing',label:'Passing',format:'number'},{field:'instances',label:'Replicas',format:'number'}]},
   {id:'lag',type:'table',title:'Consumer lag',data:'consumers',columns:[{field:'group',label:'Group'},{field:'lag',label:'Lag',format:'number'},{field:'state',label:'State',format:'status'}]}]
 }
};
module.exports={list:()=>Object.entries(templates).map(([id,d])=>({id,title:d.title,description:d.description})),get:id=>{if(!Object.hasOwn(templates,id))throw require('./ui-page-model').invalid('Unknown page template');return structuredClone(templates[id]);}};
