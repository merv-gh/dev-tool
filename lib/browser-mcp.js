// dt as an MCP client of the Playwright MCP container (browser.mcp / DT_BROWSER_MCP), so saved
// scripts and route discovery can drive a browser without the model. Streamable HTTP transport:
// JSON-RPC over POST, answers as JSON or as an SSE stream. Each session is its own isolated browser
// context (the container runs with --isolated): it does not share pages or logins with the chat's
// browser session.
const PROTOCOL = '2025-06-18';

class BrowserSession {
  constructor(url, { timeout = 60000 } = {}) {
    if (!url) throw new Error('no browser MCP endpoint: set browser.mcp in config.json or DT_BROWSER_MCP (compose sets it when the browser profile is on)');
    this.url = url; this.timeout = timeout; this.id = null; this.seq = 0;
  }

  async post(body, { timeout = this.timeout } = {}) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
    if (this.id) headers['mcp-session-id'] = this.id;
    let res;
    try { res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
    catch (e) { throw new Error(`browser MCP ${this.url}: ${e.cause?.code || e.message}`); }
    if (res.headers.get('mcp-session-id')) this.id = res.headers.get('mcp-session-id');
    if (!res.ok) throw new Error(`browser MCP ${body.method}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    if (body.id === undefined) return null; // a notification
    if (!(res.headers.get('content-type') || '').includes('text/event-stream')) return answer(await res.json(), body.method);
    // SSE: read events until the answer to this request arrives
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
        const event = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const msg = JSON.parse(data);
        if (msg.id === body.id) { reader.cancel().catch(() => {}); return answer(msg, body.method); }
      }
      if (done) throw new Error(`browser MCP ${body.method}: stream ended without an answer`);
    }
  }

  async open() {
    if (this.id) return this;
    await this.post({ jsonrpc: '2.0', id: ++this.seq, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dt', version: '1' } } });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return this;
  }

  async tools() {
    await this.open();
    this.definitions = (await this.post({ jsonrpc: '2.0', id: ++this.seq, method: 'tools/list', params: {} })).tools || [];
    return this.definitions;
  }

  // -> { text, images: n }; throws when the tool reports an error
  async call(name, args = {}, options = {}) {
    await this.open();
    // Playwright MCP changed the exact element-reference field from ref to target. Existing
    // saved scripts keep working, using the endpoint's discovered schema rather than a version guess.
    if (args.ref !== undefined) {
      const definition = (this.definitions || await this.tools()).find(t => t.name === name);
      if (definition?.inputSchema?.properties?.target && !definition.inputSchema.properties.ref) { args = { ...args, target: args.target ?? args.ref }; delete args.ref; }
    }
    const r = await this.post({ jsonrpc: '2.0', id: ++this.seq, method: 'tools/call', params: { name, arguments: args } }, options);
    const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (r.isError) throw new Error(`${name}: ${text.slice(0, 1000)}`);
    return { text, images: (r.content || []).filter(c => c.type === 'image').length };
  }

  async close() {
    if (!this.id) return;
    try { await fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.id }, signal: AbortSignal.timeout(5000) }); } catch {}
    this.id = null;
  }
}

function answer(msg, method) {
  if (msg.error) throw new Error(`browser MCP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg.result || {};
}

const session = (opts) => new BrowserSession(require('./config').getBrowser().mcp, opts);

module.exports = { BrowserSession, session };
