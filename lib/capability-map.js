// A navigation graph over the authorized registry, never an observed dependency graph.
const objects = [
  ['task','Task','The question, bug or change you are working on.'],
  ['workspace','Workspace','An editable checkout and its verification.'],
  ['context','Task context','Private progress, notes, files and saved evidence.'],
  ['memory','Project memory','Shared, versioned understanding across tasks.'],
  ['service','Service','Boundaries, consumers, dependencies and corrections.'],
  ['component','Component & code','Symbols, entry points, control and data flows.'],
  ['repository','Repository','Source revisions, files and pull requests.'],
  ['database','Database','Read-only queries and catalog discovery.'],
  ['table','Table & function','Definitions, readers, writers and field lineage.'],
  ['topic','Kafka topic','Messages, schemas and consumer lag.'],
  ['search-index','Search index','Elasticsearch documents and health.'],
  ['environment','Environment','Deployment registrations, health and logs.'],
  ['api','API & browser','Routes, captured traffic and explicit requests.'],
  ['documentation','Documentation','Requirements, verified quotations and diagrams.'],
  ['files','File store','Configured local/SFTP files and archives.'],
  ['automation','Script & collection','Reusable checks and bounded computation.'],
  ['reproduction','Reproduction','Fixtures, scenarios and isolated runtime evidence.'],
  ['test-database','Test database','Owned scratch databases, templates and leases.'],
  ['execution','Execution','Progress, cancellation, diagnostics and coverage.'],
  ['evidence','Evidence & view','Retained results, comparisons and renderers.'],
  ['tools','Tool catalog','Discover exact capabilities and extension contracts.'],
].map(([key,label,description])=>({id:'object:'+key,key,label,description,kind:'object'}));
const groupObject={jenkins:'execution',catalog:'tools',pg:'table',es:'search-index',kafka:'topic',consul:'environment',logs:'environment',bitbucket:'repository',confluence:'documentation',passport:'service',showcase:'service',browser:'api',api:'api',scripts:'automation',views:'evidence',files:'files',history:'execution',context:'context',map:'service',architecture:'memory',runtime:'execution',semantic:'component',knowledge:'memory'};
const exact={workbench_open:'task',workbench_save:'context',find:'database',catalog_search:'database',catalog_usage:'table',pg_query:'database',ddl_snapshot:'database',feature:'documentation',result_read:'evidence',self_context:'task',workflow_plan:'task',handbook:'task',checks:'task',test_coverage:'workspace',differential_check:'workspace',impact:'component',job_cancel:'execution',call_patterns:'automation',evaluation_evidence:'evidence'};
const questions={ui_trace_edit:'How can I manually correct missing service or procedure links without replaying the UI?',ui_trace:'How can I trace a reproducible UI state through services to a database field?',ui_trace_save:'How can I save replay steps and correct missing field bindings?',ui_trace_list:'Which reproducible UI states have we already mapped?',workbench_open:'How can I browse related contexts, services and tickets interactively?',workbench_save:'How can I retain this action as an editable service recipe?',workspace_branches:'Which branches can I open for this repository?',workspace_branch:'How can I test another branch while preserving my current edits?',workspace_coverage_plan:'Which changed production lines need coverage?',workspace_coverage:'Which changed lines and branches were not exercised?',jenkins_jobs:'Which Jenkins job builds this branch?',jenkins_build:'Did this build check out the required commit?',jenkins_wait:'How can I wait without restarting the build?',jenkins_log:'Why did the build fail?',jenkins_tests:'Which published tests failed?',jenkins_start:'How can I explicitly start an authorized build?',bitbucket_pr_status:'Are checks and approvals current for this commit?',bitbucket_pr_wait:'Has build or review feedback changed?',bitbucket_pr_create:'How can I create an explicitly requested draft?',chat_context_status:'How much chat context can this server actually observe?',chat_compaction_request:'How can I save progress and explicitly request compaction?',
  handbook:'How can I learn this workflow?',self_context:'What is configured and available here?',workflow_plan:'Which steps and proof does this task need?',find:'Where can I find a table, function, topic or service?',catalog_search:'Which exact cached object matches?',catalog_sync:'How can I refresh the cached evidence?',catalog_manage:'How can I retain or collect index generations?',
  workspace_list:'Which working checkouts already exist?',workspace_read:'What is the current file content?',workspace_write:'How can I edit a file and check compilation?',workspace_drop:'How can I remove an unused checkout?',test_data:'Which valid inputs fit this service?',test_targets:'Where will the test actually run?',differential_check:'Did behavior change between these revisions?',
  context_edit:'How can I safely update a saved note?',context_delete_file:'How can I permanently remove a context file?',architecture_view:'How can I explore published C4 views?',architecture_refresh:'How can I refresh deployment observations?',architecture_save:'How can an admin publish reviewed architecture?',knowledge_graph:'How can I explore cross-source knowledge?',
  code:'How can I compute across several tool results?',doctor:'What is missing for fetching or testing?',dt_log:'Why did a dev-tool operation fail or stall?',call_history:'Which tool calls ran and what happened?',passports:'Which services have cached passports?',showcase:'How can I inspect this service in one place?',overview:'What is deployed in this environment?',
  bitbucket_file:'What does this repository file contain?',bitbucket_pr:'What changed in this pull request?',bitbucket_prs:'Which pull requests affect this repository?',bitbucket_my_prs:'Which pull requests need my attention?',repo_fetch:'How can I fetch an exact source revision?',
  passport:'What enters and leaves this service?',who_uses:'Who depends on this service?',architecture_service:'How do its requirements and data flows connect?',passport_adjust:'How can I correct a detected boundary?',semantic_ports:'Which entry and exit ports were detected?',
  code_search:'Where is this implemented?',code_read:'What does the exact source say?',code_symbols:'Which symbols implement this?',impact:'What would a change affect?',semantic_trace:'Did this change alter the required entry-to-exit path?',semantic_query:'Which decisions and data changes lead to an exit?',semantic_index:'How can I index this exact revision?',
  pg_table:'What columns and constraints does it have?',pg_function:'What does this function do?',pg_usage:'Who reads or writes this object?',field_trace:'Where does this field travel?',pg_query:'What do the actual rows show?',ddl_snapshot:'How can I retain its schema?',
  kafka_last:'Which messages were produced?',kafka_topic:'What is the topic schema and configuration?',kafka_lag:'Which consumers are falling behind?',es_search:'Which documents match?',es_health:'Is the search cluster healthy?',
  workspace_open:'Where can I change and test code?',workspace_patch:'How can I export the change for review?',workspace_push:'How can I commit and push an authorized change?',test_run:'Does the change pass the selected tests?',test_context:'How should I test from entry to exit?',
  context_open:'Where can I keep this task’s progress?',context_find:'Have we investigated this before?',context_write:'How can I save progress or findings?',context_run:'How can I run a tool and retain its evidence?',context_hint:'What tool could help with this question?',project_context_find:'What does the project already know?',project_context_save:'How can an admin publish reviewed understanding?',
  result_read:'How can I recover the full tool result?',show:'How can I visualize this evidence?',diff:'What changed between these results?',files_archive:'How can I archive files without deleting them?',
  api_request_prepare:'How can I inspect a request before sending?',api_request_replay:'How can I explicitly send this request?',api_exchange_get:'What request and response were captured?',
  logs_trace:'What happened across this trace?',logs_search:'What do the logs show?',health:'Which services are unhealthy?',consul_service:'Where is this service deployed?',
  tool_search:'Which tool answers this question?',tool_describe:'What arguments and rules does this tool have?',tool_execute:'How can I invoke a discovered tool?',capability_map:'What can I do with each kind of object?',
};
function objectFor(tool){
  if(exact[tool.name])return exact[tool.name];
  for(const [prefix,key] of [['workspace_','workspace'],['testdb_','test-database'],['test_','workspace'],['fixture_','reproduction'],['scenario_','reproduction'],['experiment_','reproduction'],['project_context_','memory'],['code_','component']])if(tool.name.startsWith(prefix))return key;
  return groupObject[tool.group]||'tools';
}
function question(tool){
  if(questions[tool.name])return questions[tool.name];
  // The description is the registry's authored purpose, not a model inference.
  const first=String(tool.description||'').split(/\.\s(?=[A-Z])|\n/)[0].trim().replace(/[.!]$/,'');
  if(first.length<=110&&/^(Read|Find|Search|Inspect|List|Get|Show|Compare|Create|Build|Run|Save|Export|Import|Update|Edit|Delete|Cancel|Stop|Validate|Verify|Discover|Explain|Refresh|Prepare|Capture|Release|Reset|Renew|Open|Collect|Generate|Describe|Browse|Clone|Check)\b/i.test(first))return 'How can I '+first[0].toLowerCase()+first.slice(1)+'?';
  const action=tool.name.split('_').at(-1),verbs={list:'find available items',get:'inspect the saved details',read:'read its contents',search:'find matching evidence',save:'save a reusable definition',run:'run and inspect the outcome',cancel:'cancel owned work',stop:'stop the owned runtime',cleanup:'clean up owned resources',verify:'verify its evidence',validate:'check its validity',export:'export it for reuse',import:'import a saved package',start:'start an owned run',observe:'inspect what actually happened',check:'check the expected outcome',plan:'prepare a reviewable plan',inspect:'inspect its state'};
  return verbs[action]?'How can I '+verbs[action]+'?':'What can '+tool.name+' do with this?';
}
const connections=[
  ['task','workspace','Where do I change and verify code?'],['task','context','Where do I keep progress and evidence?'],['task','memory','What understanding can I reuse?'],
  ['task','service','Which service should I investigate?'],['task','reproduction','How can I reproduce the symptom?'],['task','execution','What is running and how can I stop it?'],['task','evidence','What did we actually verify?'],
  ['workspace','repository','Which source revision am I changing?'],['service','component','Which code path implements this?'],['service','table','Which data can I investigate?'],['service','topic','Which messages can I investigate?'],['service','api','Which entry points can I inspect?'],['database','table','Which tables and functions can I inspect?'],['context','files','Which nearby files can I keep?'],['memory','documentation','Which requirements support this understanding?'],
];
async function graph({env:requested}={}){
  const tools=await require('./tools').schemas({metadata:true}),owner=require('./access').owner();
  const nodes=tools.map(t=>({id:'tool:'+t.name,kind:'tool',name:t.name,label:t.name,description:t.description.slice(0,1800),group:t.group||'other',origin:t.origin||'extension',object:objectFor(t),parameters:Object.entries(t.inputSchema.properties||{}).map(([name,s])=>({name,type:s.type,required:(t.inputSchema.required||[]).includes(name)})),chapter:require('./handbook').chapterFor(t)}));
  const edges=nodes.map(n=>({id:'question:'+n.name,from:'object:'+n.object,to:n.id,kind:'question',question:question(tools.find(t=>t.name===n.name))}));
  // A tool can answer questions from more than one starting object.
  for(const [object,names] of [['service',['workbench_open','impact','logs_search','consul_service','test_context','architecture_service']],['task',['context_open','workspace_open','project_context_find','workflow_plan']],['component',['test_context','differential_check']],['table',['pg_query']],['evidence',['context_run']]])for(const name of names){const tool=nodes.find(n=>n.name===name);if(tool&&!edges.some(e=>e.from==='object:'+object&&e.to===tool.id))edges.push({id:'question:'+object+':'+name,from:'object:'+object,to:tool.id,kind:'question',question:question(tools.find(t=>t.name===name))});}
  for(const [from,to,label] of connections)edges.push({id:'orientation:'+from+':'+to,from:'object:'+from,to:'object:'+to,kind:'orientation',question:label});
  const env=requested||require('./config').envNames().find(name=>require('./access').allowsEnv(name))||'';
  if(env){require('./access').checkEnv(env);require('./config').getEnv(env);}
  return {schema:'dt.capability-map/v1',title:'What can I do with this?',publicUrl:require('./results').publicUrl(),nodes:[...objects.map(o=>({...o,count:edges.filter(e=>e.from===o.id&&e.kind==='question').length})),...nodes],edges,scope:{story:owner.storyId,env},coverage:{tools:nodes.length,objects:objects.length,questionEdges:edges.filter(e=>e.kind==='question').length},guidance:'Every enabled, authorized tool is a node. Question edges describe capabilities, not observed service dependencies. Links prepare drafts; execution still requires Run.'};
}
async function show({object,query=''}={}){
  if(object&&!objects.some(o=>o.key===object))throw Object.assign(Error('Unknown capability object'),{statusCode:400,code:'DT_ARGUMENT_INVALID'});
  const model=await graph();model.initial={object:object||'',query};
  const view=require('./results').saveView('capabilities',model,{title:'Tool capability map'});
  return {...model.coverage,view,url:'/admin#capabilities',guidance:model.guidance};
}
module.exports={graph,show,objectFor,question,objects};
