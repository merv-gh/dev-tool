// Curated user goals. Tool names are explicit: a new unassigned built-in fails verification.
const groups = [
  ['task','Task and conversation'], ['files','Files and task memory'], ['workspace','Workspace and code changes'],
  ['understand','Understand services and paths'], ['data','Inspect databases, messages and logs'],
  ['api','APIs, UI and reproducible workflows'], ['verify','Tests, coverage and environments'],
  ['background','Background tasks and automation'], ['review','Builds and review'],
  ['knowledge','Shared knowledge and architecture'], ['share','Share and reproduce'], ['operate','Operate the harness']
].map(([id,title])=>({id,title}));
const usecases=[];
function add(group,id,title,actor,tools='',mode='read',detail='') {
  usecases.push({ id,group,title,actor,tools:tools.split(/\s+/).filter(Boolean),mode,
    detail:detail||'Complete this intent in the task conversation. Keep selected files and background execution details alongside it.',
    surface:'Conversation; Files and Background are optional drawers', output:mode==='read'?'Retained evidence with source, target, time and gaps':'Owned receipt with exact inputs, target, revision and outcome' });
}
add('task','new-task','Start a task from a question or ticket','session','continuation_create context_open','edit');
add('task','find-task','Find a task by ticket, repository or service','memory','continuation_find context_find context_list');
add('task','resume-task','Continue existing work in another chat','session','continuation_get continuation_attach continuation_briefing context_get','read','Restore the owned task, files, workspace and job IDs. Never recreate or reset them merely because the chat changed.');
add('task','task-checkpoint','Save progress, plan and a resumable checkpoint','memory','continuation_checkpoint continuation_read continuation_write continuation_flow','edit');
add('task','ask-followup','Ask a question and follow up in the same conversation','chat');
add('task','steer-turn','Steer a running turn without losing its work','chat','','steer');
add('task','stop-turn','Stop a turn and retain partial findings','chat','','cancel');
add('task','context-budget','Inspect context usage without compacting','chat','chat_context_status');
add('task','compact-explicitly','Explicitly compact a conversation','chat','chat_compaction_request','compact','Show context usage and offer an explicit action. Context pressure must never silently compact every second tool call.');
add('task','briefing','Read app briefing and persistent self-context','memory','self_context context_hint');
add('task','choose-tool','Discover a useful tool or intent from the question','action','tool_search tool_describe tool_contracts tool_profiles capability_map workflow_plan');
add('task','exact-tool','Prepare and run a tool with editable arguments','action','tool_execute');
add('task','scope','Change task, identity or environment safely','session','','scope');
add('task','reconnect','Reconnect and reconcile retained work','connection','','reconnect');

add('files','browse-files','Browse or search task files and configured stores','file','files_stores files_browse files_list files_search files_show');
add('files','read-file','Read a task, workspace or store file','file','files_read context_read');
add('files','new-file','Create a note, query, script or result file','file','context_write files_write','new');
add('files','edit-file','Edit and save a file with revision protection','file','context_edit','edit');
add('files','file-conflict','Resolve a file conflict without losing the draft','file','','conflict');
add('files','file-navigation','Navigate away from unsaved work safely','file','','navigation');
add('files','archive-file','Archive a context or configured-store file','file','files_archive','archive');
add('files','delete-file','Delete an explicitly selected file','file','files_delete context_delete_file','delete');
add('files','copy-file','Copy or move reusable files between owned locations','file','files_copy','edit');
add('files','context-metadata','Update task context metadata and its discovery index','memory','context_update','edit');
add('files','search-memory','Find retained scripts, queries, evidence and notes','memory','context_search workbench_search workbench_inspect');
add('files','save-result','Save a tool result or reusable action in the task','memory','context_run workbench_save','edit');
add('files','read-result','Read retained evidence without re-executing','action','result_read');

add('workspace','open-workspace','Open or reattach an existing workspace','workspace','workspace_list workspace_open');
add('workspace','context-folder','Work in a folder without a Git repository','workspace','','folder');
add('workspace','workspace-files','Read or edit source in the retained workspace','workspace','workspace_read workspace_write','edit');
add('workspace','editor-terminal','Open the editor or an owned terminal','workspace','workspace_editor workspace_terminal','terminal');
add('workspace','branches','Inspect or switch workspace branches','workspace','workspace_branches workspace_branch','branch');
add('workspace','patch','Preview and apply a patch against an exact base','workspace','workspace_patch','patch');
add('workspace','commit-push','Commit and push to an authorized task branch','workspace','workspace_push','push');
add('workspace','cleanup-workspace','Explicitly drop/delete an owned workspace','action','workspace_drop workspace_delete','delete');
add('workspace','find-repo','Find repositories, folders, files and exact source refs','action','bitbucket_repos bitbucket_files bitbucket_file repo_fetch');
add('workspace','search-code','Search code in a specific repository','flow','code_search code_symbols code_read');
add('workspace','code-index','Index a pinned source revision without destroying another','operations','code_index','edit');
add('workspace','dependency-inventory','Inspect Gradle dependencies across many repositories','action','gradle_inventory');
add('workspace','dependency-bump','Prepare dependency updates across repositories','workspace','gradle_bump','patch');
add('workspace','impact','Find cross-library and database impact of a change','flow','impact who_uses');
add('workspace','compare-behavior','Compare behavior before and after a refactor','flow','differential_check','compare');

add('understand','service-boundaries','Understand a service, entry points and connections','flow','passport passports');
add('understand','live-instances','Resolve current instances and health lazily','action','consul_service health overview');
add('understand','correct-passport','Correct a detected port or boundary with evidence','flow','passport_adjustments passport_adjust semantic_ports','correct');
add('understand','services-map','Explore a small evidence-backed service neighborhood','flow','map map_search map_neighbors map_node map_path map_layers');
add('understand','correct-map','Add or correct a connection and retain its provenance','flow','map_adjustments map_adjust map_save','correct');
add('understand','entry-exit','Trace an entry or line to its exits as a nested list','flow','semantic_trace semantic_query','read','Show nested services, conditionals, loops, stream filters, transformations and exits. Expand only selected parents. A missing/cut-off path stays an explicit gap.');
add('understand','semantic-search','Find a method or expression in retained semantic evidence','flow','semantic_search');
add('understand','semantic-index','Prepare Joern analysis for an exact repository commit','operations','semantic_index semantic_capabilities','edit');
add('understand','library-fallback','Resolve inherited/internal-library code and version gaps','flow','','library');
add('understand','path-assumptions','Inspect, reject or correct path assumptions','flow','','assumptions');
add('understand','compare-paths','Compare entry-to-exit paths across branches','flow','','compare');
add('understand','repo-model','Inspect hierarchical code-backed architecture and TLA model','flow','repo_model logic_model');
add('understand','ui-to-field','Trace UI state through services to database fields','flow','ui_trace ui_trace_list ui_trace_save ui_trace_edit map_ui_preview','edit');

add('data','catalog-search','Find an exact table, field, function, index or topic','action','find catalog_search');
add('data','catalog-usage','Inspect cached cross-system usage at a pinned generation','action','catalog_usage data_readers data_writers data_index');
add('data','pg-table','Inspect a PostgreSQL table, constraints and columns','action','pg_table');
add('data','pg-function','Inspect procedure/function bodies and dependencies','flow','pg_function pg_usage field_trace data_trace');
add('data','pg-query','Query an explicitly selected database and inspect raw rows','action','pg_query');
add('data','database-parity','Compare database procedures or schema across environments','action','api_database_inspect ddl_snapshot');
add('data','es-query','Inspect Elasticsearch health and search documents','action','es_health es_search');
add('data','kafka-read','Inspect topics, schemas and retained messages','action','kafka_topic kafka_last kafka_checkpoint kafka_lag');
add('data','kafka-produce','Produce an explicitly prepared Kafka message','action','kafka_produce','effect');
add('data','kafka-wait','Wait for a correlated Kafka event without busy polling','job','kafka_wait','wait');
add('data','logs','Search logs or correlate a request across services','action','logs_search logs_trace');
add('data','wrong-data','Explain a wrong API field from raw data through its mapper','flow','mapping_debug');
add('data','docs-search','Find and read relevant Confluence or other documentation','memory','confluence_search confluence_page docs_search docs_page docs_verify');

add('api','api-catalog','Find service routes or reusable API collections','action','api_client_catalog api_routes');
add('api','api-refresh','Refresh service targets from Consul','action','api_instances_refresh','read','Refresh the main catalog and selected health only; use current addresses without polling all service instances. A manually pinned URL remains explicit.');
add('api','api-prepare','Prepare an API request with overridable URL and auth','action','api_auth_profiles api_request_prepare');
add('api','api-send','Send a prepared API request and observe progress/result','action','api_request_replay','effect');
add('api','api-save','Save a named request or import a retained exchange','memory','api_request_save api_exchange_import','edit');
add('api','api-receipts','Inspect retained HTTP responses, failures and exchanges','action','api_exchange_list api_exchange_get');
add('api','browser-route','Choose a browser destination and learn routes','action','browser_sites site_url routes_discover routes_learn');
add('api','browser-session','Open, act in, capture and close an owned browser session','action','api_browser_open api_browser_action api_browser_capture api_browser_close','effect');
add('api','workflow-crud','Create, name, edit, validate or delete a mixed collection','file','collection_save collection_get collection_delete collection_validate collection_plan','edit');
add('api','workflow-run','Run HTTP/UI/PG/ES/Kafka steps with per-step targets','job','collection_run collection_check collection_cancel collection_history collection_report','background');
add('api','script-crud','Find, edit, save or delete a reusable script','file','script_list script_get script_save script_delete script_collection','edit');
add('api','script-run','Run a script and inspect its checks and saved receipt','action','script_run script_transfer checks','effect');
add('api','page-definition','Create or edit a declarative executable page','file','ui_page','edit');
add('api','page-execute','Refresh a shared page using private execution access','action','ui_page_data ui_event','effect');

add('verify','test-context','Prepare an outside-in regression from service boundaries','verification','test_context test_data test_targets');
add('verify','test-run','Compile and run focused integration tests','verification','test_run','test');
add('verify','changed-coverage','Plan and inspect changed-line and branch coverage','verification','workspace_coverage_plan workspace_coverage test_coverage','coverage');
add('verify','compile-fallback','Use correct Lombok/full-build fallback when incremental fails','verification','','fallback');
add('verify','db-lease','Acquire, inspect, renew or release isolated test resources','action','testdb_capabilities testdb_resources testdb_initialize testdb_clone testdb_lease_inspect testdb_lease_renew testdb_reset testdb_release','effect');
add('verify','db-template','Build, inspect, pin and verify reusable database templates','job','testdb_template_plan testdb_template_build testdb_template_inspect testdb_template_list testdb_template_verify testdb_template_pin testdb_template_invalidate testdb_gc','background');
add('verify','service-environment','Plan, save and run a branch with isolated dependencies','job','service_env_plan service_env_save service_env_start service_env_status service_env_bindings service_env_control','background');
add('verify','local-debug','Send local requests, inspect service logs and debug mappings','action','service_env_request service_env_logs service_debug','effect');
add('verify','scenario-inventory','Discover a reproducible scenario and required infrastructure','action','scenario_inventory scenario_preflight scenario_inspect scenario_explain scenario_actions');
add('verify','scenario-state','Capture, compare or import an explicitly scoped scenario state','action','scenario_state_plan scenario_state_capture scenario_state_get scenario_diff scenario_package scenario_import scenario_export','edit');
add('verify','scenario-execute','Start, act, observe and stop a scoped scenario','job','scenario_start scenario_run scenario_act scenario_observe scenario_stop scenario_cleanup','background');
add('verify','scenario-assert','Declare independent expectations and verify observed effects','verification','scenario_expectations scenario_assert scenario_check scenario_verify scenario_emulate','test');
add('verify','fixture-design','Plan, capture, validate and export a multi-system fixture','action','fixture_schema fixture_plan fixture_capture fixture_validate fixture_export');
add('verify','fixture-runtime','Preflight, start, bind, observe and clean a fixture runtime','job','fixture_runtime_preflight fixture_runtime_arm fixture_runtime_publish fixture_runtime_start fixture_runtime_bindings fixture_runtime_check fixture_runtime_observe fixture_runtime_stop fixture_runtime_cleanup fixture_replay','background');
add('verify','experiments','Compare mutation/regression experiments and retain evidence','verification','experiment_save experiment_run experiment_list experiment_compare','test');

add('background','autonomous-task','Leave a bounded task working unattended','job','task_run_catalog task_run_start task_run_status task_run_control task_run_action task_run_list','background');
add('background','gather-overnight','Gather code/docs/environment evidence into retained memory','memory','task_run_memory','gather');
add('background','automation-crud','Create, inspect and version a loop/parallel/wait flow','file','automation_flow_save automation_flow_get automation_flow_list automation_flow_model','edit');
add('background','automation-run','Start, inspect, pause/resume or cancel a flow','job','automation_flow_start automation_flow_status automation_flow_resume automation_flow_resolve automation_flow_cancel','background');
add('background','sandbox','Run a bounded tool program or sandboxed script','job','code js_run code_start code_wait code_cancel','background');
add('background','job-observe','Inspect owned jobs, background progress and retained results','job','execution_list execution_get','inspect');
add('background','job-cancel','Cancel owned work and verify resource cleanup','job','execution_cancel job_cancel','cancel');
add('background','job-unknown','Resolve unknown acknowledgement before retrying an effect','job','','unknown');
add('background','job-budget','Handle budget limits, dependency waits and user questions','job','','budget');

add('review','build-inspect','Find Jenkins jobs and inspect build, log and test failures','action','jenkins_jobs jenkins_build jenkins_log jenkins_tests');
add('review','build-start','Start an authorized Jenkins build','job','jenkins_start','background');
add('review','build-wait','Wait for a build result and resume at a checkpoint','job','jenkins_wait','wait');
add('review','pr-inspect','Inspect pull requests, changed files and review status','action','bitbucket_prs bitbucket_pr bitbucket_my_prs bitbucket_pr_status');
add('review','draft-pr','Create/update an authorized draft pull request','workspace','bitbucket_pr_create','push');
add('review','review-loop','Wait for review, fix comments and repeat checks','job','bitbucket_pr_wait','wait');

add('knowledge','knowledge-search','Search global understanding, entities and source evidence','memory','knowledge_search knowledge_entity knowledge_sources knowledge_graph');
add('knowledge','knowledge-refresh','Refresh or verify indexed knowledge without destructive replacement','operations','knowledge_sync knowledge_verify','edit');
add('knowledge','project-read','Find and read versioned project understanding','memory','project_context_find project_context_get');
add('knowledge','project-publish','Publish reviewed project understanding as an admin','memory','project_context_save','publish');
add('knowledge','architecture-read','Find architecture views, service passports and data flows','flow','architecture_list architecture_get architecture_service architecture_flow');
add('knowledge','architecture-edit','Edit architecture or feature explanation with source evidence','memory','architecture_save architecture_refresh feature','publish');
add('knowledge','architecture-export','Export C4, UML or a selected architecture view','share','architecture_view architecture_export diagram');

add('share','named-result','Name and share a retained result without execution','share','named_view show view_list view_get');
add('share','workflow-share','Share a reproducible workflow definition and prerequisites','share','workflow_share');
add('share','diff-result','Compare evidence or files in a nested folder list','share','diff');
add('share','renderer-edit','Inspect or edit a result renderer without altering saved evidence','file','view_save','edit');
add('share','workbench-link','Open a named workbench with pinned evidence and private results','share','workbench_open');
add('share','review-only','Open shared findings without executing any action','share','','review');
add('share','recipient-replay','Replay a shared recipe under recipient-owned access','share','','replay');

add('operate','catalog-refresh','Refresh selected catalog sources and retain old generations','operations','catalog_sync','refresh');
add('operate','catalog-history','Inspect, pin or explicitly collect catalog generations','operations','catalog_manage','edit');
add('operate','telemetry','Inspect tool/model call counts, latency, errors and traces','operations','observability dt_log call_history call_patterns','telemetry');
add('operate','effectiveness','Inspect coverage and evidence for harness effectiveness','operations','evaluation_evidence');
add('operate','metadata-edit','Read or edit execution metadata with revision checks','file','metadata_list metadata_get metadata_edit','edit');
add('operate','doctor','Diagnose integration, runner or authentication setup','operations','doctor adapter_capabilities');
add('operate','config','Edit configuration with safe drafts and last-good activation','operations','','config');
add('operate','help','Find contextual help, recipes and capability explanations','action','handbook');
add('operate','showcase','Open an honest service showcase with explicit evidence gaps','action','showcase');

const workbenchBindings={
 'service-boundaries':'service-boundaries','follow-code':'search-code','map-entry-exit':'entry-exit','correct-boundary':'correct-passport',
 'find-object':'catalog-search','table-usage':'pg-function','query-data':'pg-query','incident':'logs','reproduce':'scenario-inventory',
 'run-service-locally':'service-environment','regression':'test-context','changed-coverage':'changed-coverage','compare':'compare-behavior',
 'api-check':'api-send','automation':'workflow-run','architecture':'architecture-read','task-files':'find-task',
 'inspect-ci':'build-inspect','wait-review':'review-loop','draft-change':'draft-pr'
};
const areaBindings={workbench:['choose-tool','exact-tool','find-task'],capabilities:['choose-tool'],index:['catalog-refresh','catalog-history'],explore:['catalog-search','pg-table','pg-function'],passports:['service-boundaries','correct-passport'],map:['services-map','correct-map'],context:['browse-files','edit-file','search-memory','project-publish','new-task'],scripts:['script-crud','script-run'],pages:['page-definition','page-execute'],studio:['autonomous-task','dependency-bump'],sites:['browser-route','browser-session'],api:['api-send','api-receipts','workflow-run'],views:['renderer-edit','named-result'],handbook:['help','briefing'],history:['telemetry'],environments:['service-environment','local-debug'],runtime:['telemetry','job-observe','metadata-edit'],reflection:['repo-model'],architecture:['architecture-read','architecture-edit'],semantic:['entry-exit','semantic-search','correct-passport'],jobs:['job-observe','job-cancel'],config:['config','file-navigation']};
module.exports={groups,usecases,workbenchBindings,areaBindings};
