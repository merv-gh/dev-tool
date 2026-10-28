// Profiles reduce the definitions sent to a model. They are discovery sets, not permissions.
const CORE = ['find', 'tool_search', 'tool_describe', 'tool_execute', 'tool_profiles', 'tool_contracts', 'knowledge_graph', 'knowledge_search', 'job_cancel', 'call_history', 'doctor'];
const PROFILES = {
  compact: { description: 'Small starting set; discover an exact tool then execute it with validated arguments.', names: CORE },
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
  const names = new Set([...CORE, ...(profile.names || [])]);
  return tools.filter(t => names.has(t.name) || (profile.groups || []).includes(t.group) || (profile.prefixes || []).some(p => t.name.startsWith(p)));
}
function list(tools) { return Object.entries(definitions()).map(([name, x]) => ({ name, description: x.description || '', tools: select(tools, name).map(t => t.name), count: select(tools, name).length })); }
module.exports = { select, list };
