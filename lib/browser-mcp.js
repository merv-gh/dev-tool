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
    this.lifecycle = require('./state-machine').create(require('./lifecycles').handshake);
    this.opening = null; this.closing = null;
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
    const frames = new (require('./state-machine').Framer)({ separator: /\r?\n\r?\n/ });
    try { for (;;) {
      const { value, done } = await reader.read();
      for (const event of value ? frames.push(value) : []) {
        const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const msg = JSON.parse(data);
        if (msg.id === body.id) return answer(msg, body.method);
      }
      if (done) { frames.finish(); throw new Error(`browser MCP ${body.method}: stream ended without an answer`); }
    } } finally { if (!frames.lifecycle.terminal) frames.discard(); reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  async open() {
    if (this.closing) { await this.closing; return this.open(); }
    if (this.lifecycle.is('ready')) return this;
    if (this.opening) return this.opening;
    this.lifecycle.to('initializing');
    this.opening = (async () => {
      try {
        await this.post({ jsonrpc: '2.0', id: ++this.seq, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dt', version: '1' } } });
        if (!this.lifecycle.is('initializing')) throw new Error('browser MCP session closed during initialization');
        await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        if (!this.lifecycle.is('initializing')) throw new Error('browser MCP session closed during initialization');
        this.lifecycle.to('ready'); return this;
      } catch (error) {
        // A received session ID is not proof that the handshake completed.
        // close() owns cleanup if it is already waiting for this attempt.
        if (!this.lifecycle.is('closing')) {
          if (this.id) try { await fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.id }, signal: AbortSignal.timeout(5000) }); } catch {}
          this.id = null; this.definitions = null; this.lifecycle.to('disconnected');
        }
        throw error;
      } finally { this.opening = null; }
    })();
    return this.opening;
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
    const images = (r.content || []).filter(c => c.type === 'image');
    const imageData = options?.includeImages ? images.filter(c => /^image\/(png|jpeg|webp)$/.test(c.mimeType) && typeof c.data === 'string' && c.data.length <= 4 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(c.data)).slice(0, 1).map(c => ({mimeType:c.mimeType,data:c.data})) : [];
    return { text, images: images.length, ...(imageData.length ? {imageData} : {}) };
  }

  async close() {
    if (this.closing) return this.closing;
    if (this.lifecycle.is('disconnected') && !this.id) return;
    this.lifecycle.to('closing');
    this.closing = (async () => {
      try {
        await this.opening?.catch(() => {});
        if (this.id) try { await fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.id }, signal: AbortSignal.timeout(5000) }); } catch {}
      } finally { this.id = null; this.definitions = null; this.lifecycle.to('disconnected'); this.closing = null; }
    })();
    return this.closing;
  }
}

function answer(msg, method) {
  if (msg.error) throw new Error(`browser MCP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg.result || {};
}

const session = (opts) => new BrowserSession(require('./config').getBrowser().mcp, opts);

module.exports = { BrowserSession, session };
