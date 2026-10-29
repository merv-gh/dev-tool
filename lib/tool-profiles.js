// Profiles reduce the definitions sent to a model. They are discovery sets, not permissions.
const CORE = ['find', 'tool_search', 'tool_describe', 'tool_execute', 'tool_profiles', 'tool_contracts', 'knowledge_graph', 'knowledge_search', 'job_cancel', 'call_history', 'doctor'];
const DISCOVERY = ['tool_search', 'tool_describe', 'tool_execute', 'tool_profiles'];
// Everyday investigation, by name: a question about a table, an index, a topic, logs, a repo file or a PR
// goes straight to its tool. Anything else is reachable through the three discovery tools.
const DIRECT = ['find', 'catalog_sync', 'pg_table', 'pg_function', 'pg_usage', 'pg_query', 'es_search', 'es_health', 'kafka_topic', 'kafka_last', 'kafka_lag',
  'health', 'overview', 'consul_service', 'logs_search', 'logs_trace', 'bitbucket_repos', 'bitbucket_files', 'bitbucket_file', 'bitbucket_prs', 'bitbucket_pr', 'bitbucket_my_prs',
  'repo_fetch', 'passport', 'passports', 'who_uses', 'code_search', 'code_symbols', 'code_read', 'impact', 'feature', 'docs_search', 'docs_page', 'confluence_search', 'confluence_page',
  'workspace_open', 'workspace_read', 'workspace_write', 'workspace_patch', 'workspace_push', 'test_data', 'test_context', 'test_run',
  'show', 'diff', 'code', 'script_list', 'script_run', 'showcase', 'call_history', 'tool_search', 'tool_describe', 'tool_execute'];
// Testing work by name, in harmony: checks (ready-made scripts) first, then test data and scratch databases,
// scenarios, API and UI capture, scripts and suites, and the workspace to write and run tests.
const TESTER = ['checks', 'find', 'catalog_sync', 'health', 'consul_service', 'logs_search', 'logs_trace', 'pg_query', 'pg_table', 'pg_usage', 'es_search', 'kafka_last', 'kafka_topic',
  'passport', 'who_uses', 'bitbucket_file',
  'test_data', 'fixture_plan', 'fixture_capture', 'fixture_validate', 'fixture_export', 'fixture_replay',
  'testdb_template_plan', 'testdb_template_build', 'testdb_clone', 'testdb_reset', 'testdb_release', 'testdb_resources',
  'scenario_inventory', 'scenario_package', 'scenario_verify', 'scenario_run', 'scenario_inspect', 'scenario_stop',
  'browser_sites', 'api_browser_open', 'api_browser_action', 'api_browser_capture', 'api_browser_close', 'api_exchange_list', 'api_exchange_get', 'api_request_prepare', 'api_request_replay', 'api_request_save',
  'script_list', 'script_get', 'script_run', 'script_save', 'collection_validate', 'collection_plan', 'collection_run', 'collection_report', 'collection_history',
  'workspace_open', 'workspace_write', 'workspace_patch', 'test_context', 'test_run',
  'show', 'diff', 'code', 'call_history', 'doctor', 'tool_search', 'tool_describe', 'tool_execute'];
const PROFILES = {
  tester: { description: 'Testing by name: ready-made checks (service, environment, versions, table, trace, test data capture and reuse), test data and scratch databases, scenarios, API and UI capture, scripts and suites, tests in a workspace; tool_search reaches the rest.', includeCore: false, names: TESTER },
  direct: { description: 'Everyday tools by name (databases, indices, topics, logs, repo files and PRs, code, docs); tool_search, tool_describe and tool_execute reach the rest.', includeCore: false, names: DIRECT },
  compact: { description: 'Small starting set; discover an exact tool then execute it with validated arguments.', names: CORE },
  lean: { description: 'Four discovery tools. Search the catalog capability, describe it, then execute; expand profiles on request.', includeCore: false, names: DISCOVERY },
  'lean-find': { description: 'Five tools: cached catalog search plus discovery; expand capabilities on request.', includeCore: false, names: [...DISCOVERY, 'find'] },
  investigate: { description: 'Find services and data, inspect evidence, follow logs and visualize dependencies.', names: [...CORE, 'passport', 'passports', 'pg_query', 'pg_usage', 'es_search', 'kafka_last', 'logs_search', 'logs_trace', 'health', 'overview', 'impact', 'code_search', 'feature', 'experiment_list', 'experiment_run'] },
  testing: { description: 'Build reproducible fixtures, scenario contracts, collections and isolated test runs.', prefixes: ['fixture_', 'scenario_', 'collection_', 'testdb_', 'test_'], names: [...CORE, 'workspace_open', 'workspace_read', 'workspace_write', 'workspace_patch', 'script_list', 'script_get', 'script_run'] },
  develop: { description: 'Inspect code, make a workspace change, compile and verify its behavior.', prefixes: ['workspace_', 'code_', 'test_'], names: [...CORE, 'passport', 'repo_fetch', 'impact', 'experiment_save', 'experiment_run', 'experiment_compare'] },
  knowledge: { description: 'Inspect source-neutral documentation, contracts, architecture and provenance.', prefixes: ['knowledge_', 'docs_'], names: [...CORE, 'feature', 'passport', 'who_uses'] },
  api: { description: 'Inspect UI traffic, discover routes, edit requests and save reusable scripts or collections.', groups: ['api', 'browser'], prefixes: ['api_', 'collection_'], names: [...CORE, 'script_list', 'script_get', 'script_run', 'script_save', 'script_collection', 'routes_discover', 'routes_learn'] },
  all: { description: 'Every enabled tool; compatible with existing installations.' },
};
function definitions() {
  return { ...PROFILES, ...(require('./config').getTools().profiles || {}) };
}
function select(tools, name = 'all') {
  const profile = definitions()[name]; if (!profile) throw Object.assign(new Error(`Unknown tool profile ${name}`), { code: 'DT_PROFILE_UNKNOWN' });
  if (name === 'all') return tools;
  const names = new Set([...(profile.includeCore === false ? [] : CORE), ...(profile.names || [])]);
  return tools.filter(t => names.has(t.name) || (profile.groups || []).includes(t.group) || (profile.prefixes || []).some(p => t.name.startsWith(p)));
}
function list(tools) { return Object.entries(definitions()).map(([name, x]) => ({ name, description: x.description || '', tools: select(tools, name).map(t => t.name), count: select(tools, name).length })); }
module.exports = { select, list, DIRECT, TESTER };
