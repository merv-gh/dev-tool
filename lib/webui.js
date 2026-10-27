// Configure Open WebUI through its API: the agent prompt (lib/agent-prompt.md) as each model's system
// prompt, and the tool servers enabled on those models. Two ways in:
//   - the bundled compose (WEBUI_AUTH=false): signin returns the built-in local admin
//   - an Open WebUI you already run: pass an admin API key (Settings > Account > API keys)
// With `register`, it also adds (or updates) dt as a tool server connection, for an Open WebUI that
// does not get TOOL_SERVER_CONNECTIONS from the bundled docker-compose.yml.
const fs = require('fs');
const path = require('path');
const { http } = require('./util');

const PROMPT_FILE = path.join(__dirname, 'agent-prompt.md');
const prompt = () => fs.readFileSync(PROMPT_FILE, 'utf8').trim();

async function waitFor(base, ms = 180000) {
  const until = Date.now() + ms;
  for (;;) {
    try { const h = await http(`${base}/health`, { timeout: 5000 }); if (h.status) return; } catch {}
    if (Date.now() > until) throw new Error(`Open WebUI not reachable at ${base}`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

// dt as an Open WebUI tool server: OpenAPI, so table results can embed the viewer in the chat.
function dtConnection(dtUrl, dtKey) {
  return {
    type: 'openapi', url: dtUrl.replace(/\/$/, ''), path: 'openapi.json',
    auth_type: dtKey ? 'bearer' : 'none', key: dtKey || '',
    config: { enable: true },
    info: { id: 'dt', name: 'dt', description: 'Postgres, Elasticsearch, Kafka, Consul, logs, Bitbucket, service passports (read-only)' },
  };
}

async function register(base, auth, conn, log) {
  const cur = await http(`${base}/api/v1/configs/tool_servers`, { headers: auth });
  const list = (cur.TOOL_SERVER_CONNECTIONS || []).filter(c => c.info?.id !== conn.info.id && c.url !== conn.url);
  await http(`${base}/api/v1/configs/tool_servers`, { method: 'POST', headers: auth, body: { TOOL_SERVER_CONNECTIONS: [...list, conn] } });
  log(`webui: tool server ${conn.info.id} -> ${conn.url}/${conn.path}`);
}

async function setup({
  base = process.env.WEBUI_URL || 'http://127.0.0.1:3000', model = process.env.LLM_MODEL, key = process.env.WEBUI_API_KEY,
  dtUrl = process.env.DT_URL_FOR_WEBUI, dtKey = process.env.DT_API_KEY, log = console.error,
} = {}) {
  base = base.replace(/\/$/, '');
  await waitFor(base);
  const token = key || (await http(`${base}/api/v1/auths/signin`, { method: 'POST', body: { email: '', password: '' } })).token;
  const auth = { authorization: `Bearer ${token}` };
  if (dtUrl) await register(base, auth, dtConnection(dtUrl, dtKey), log);
  // tool servers register a little after startup
  let tools = [];
  for (let i = 0; i < 20 && !tools.length; i++) {
    tools = await http(`${base}/api/v1/tools/`, { headers: auth }).catch(() => []);
    if (!tools.length) await new Promise(r => setTimeout(r, 3000));
  }
  const toolIds = tools.map(t => t.id);
  const available = (await http(`${base}/api/models`, { headers: auth })).data.map(m => m.id);
  const targets = model ? model.split(',').map(s => s.trim()).filter(Boolean) : available;
  const done = [];
  for (const id of targets) {
    const existing = await http(`${base}/api/v1/models/model?id=${encodeURIComponent(id)}`, { headers: auth }).catch(() => null);
    const body = {
      id, base_model_id: existing?.base_model_id ?? null, name: existing?.name || id,
      meta: { ...(existing?.meta || {}), toolIds, capabilities: { ...(existing?.meta?.capabilities || {}), function_calling: true } },
      params: { ...(existing?.params || {}), system: prompt(), function_calling: 'native' },
      access_control: existing?.access_control ?? null, is_active: true,
    };
    const url = existing ? `${base}/api/v1/models/model/update?id=${encodeURIComponent(id)}` : `${base}/api/v1/models/create`;
    await http(url, { method: 'POST', headers: auth, body });
    done.push(id);
    log(`webui: ${existing ? 'updated' : 'configured'} model ${id} (tools: ${toolIds.join(', ')})`);
  }
  return { models: done, toolIds };
}

module.exports = { setup, prompt, dtConnection };
