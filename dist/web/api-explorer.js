// One client for the standalone page and Admin. All execution uses backend tools.
(() => {
  'use strict';
  const $ = id => document.getElementById(id), SM = window.DTState;
  const dirty = new SM.Dirty(), edits = new SM.Revision(), navigation = new SM.Revision(), selection = new SM.Revision(), authVersion = new SM.Revision(), sending = new SM.Activity(), changingEnvironment = new SM.Activity();
  const query = new URLSearchParams(location.search), scope = { story: query.get('story') || 'default', principal: query.get('principal') || '' };
  const state = { mode: 'services', env: query.get('env') || '', services: [], group: null, route: null, exchange: null, response: null, session: null, params: {}, authChoice: null, script: null, scripts: [], raw: false, controller: null };
  if (query.get('embed') === 'true') document.body.classList.add('embed');
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = String(text); if (cls) n.className = cls; return n; };
  function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').classList.toggle('running', sending.value); }
  function changed() { dirty.value = true; edits.advance(); }
  function parse(id, array = false) {
    let value; try { value = JSON.parse($(id).value || (array ? '[]' : '{}')); } catch { throw Error(`${id}: enter valid JSON.`); }
    if (array ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${id}: enter a JSON ${array ? 'array' : 'object'}.`);
    return value;
  }
  async function tool(name, args, signal) {
    const response = await fetch('/api/tool/' + name, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-dt-story': scope.story, ...(scope.principal ? { 'x-dt-principal': scope.principal } : {}) }, body: JSON.stringify(args), signal });
    let payload; try { payload = await response.json(); } catch { throw Error(`HTTP ${response.status}: the backend returned a non-JSON response.`); }
    if (!response.ok || payload.error) throw Error(payload.error || `HTTP ${response.status}`);
    return payload.result;
  }
  function action(button, fn) { button.addEventListener('click', async () => { button.disabled = true; try { await fn(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; } }); }
  function canReplace() {
    if (changingEnvironment.value) { notice('Loading environment targets. Wait before replacing this draft.'); return false; }
    if (sending.value) { notice('A request is in flight. Cancel it before replacing this draft.', true); return false; }
    return !dirty.value || confirm('Discard the current unsaved request draft?');
  }
  function bindTabs(list, attribute, select) {
    const buttons = [...list.querySelectorAll('[role=tab]')];
    for (const b of buttons) b.onclick = () => { for (const other of buttons) { other.setAttribute('aria-selected', String(other === b)); other.tabIndex = other === b ? 0 : -1; $(other.getAttribute('aria-controls')).hidden = other !== b; } select?.(b.getAttribute(attribute)); };
    list.addEventListener('keydown', e => { const i = buttons.indexOf(e.target), next = e.key === 'ArrowRight' ? (i + 1) % buttons.length : e.key === 'ArrowLeft' ? (i + buttons.length - 1) % buttons.length : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null; if (i >= 0 && next !== null) { e.preventDefault(); buttons[next].click(); buttons[next].focus(); } });
  }
  bindTabs(document.querySelector('.source-tabs'), 'data-source', mode => { state.mode = mode; refreshLibrary(); });
  bindTabs(document.querySelector('[aria-label="Request editor"]'), 'data-tab');
  bindTabs(document.querySelector('[aria-label="Response inspector"]'), 'data-response-tab');
  const libraryStatus = (text, error = false) => { $('library-status').textContent = text; $('library-status').classList.toggle('error', error); };
  const empty = text => node('p', text, 'empty-note');
  const method = value => node('span', value || 'ANY', 'method ' + value);
  function routeButton(route, group) {
    const b = node('button', undefined, 'route-item'); b.append(method(route.method), node('span', route.path || '/', 'route-path'));
    b.title = [route.handler, route.where, route.source, ...(route.origins || [])].filter(Boolean).join(' · ');
    b.setAttribute('aria-current', String(state.route?.path === route.path && state.group?.key === group.key && state.route?.method === route.method));
    b.onclick = () => { if (!canReplace()) return; choose(route, group); for (const other of $('apiRoutes').querySelectorAll('[aria-current]')) other.setAttribute('aria-current', String(other === b)); };
    return b;
  }
  async function serviceRoutes(group, root, epoch, offset = 0) {
    if (!offset) root.replaceChildren(empty('Loading routes…'));
    try {
      const result = await tool('api_client_catalog', { env: state.env, q: $('apiRouteSearch').value, group: group.key, offset, limit: 100 });
      if (!navigation.current(epoch) || !root.isConnected) return;
      if (!offset) root.replaceChildren(); else root.querySelector('.load-more')?.remove();
      for (const route of result.routes) root.append(routeButton(route, group));
      if (!result.total) { root.append(empty('No indexed routes. You can start with this service URL.')); const b = node('button', 'Use service URL', 'load-more'); b.onclick = () => { if (canReplace()) choose({ method: 'GET', path: '/' }, group); }; root.append(b); }
      if (result.nextOffset !== null) { const more = node('button', `Load more · ${offset + result.routes.length} of ${result.total}`, 'load-more'); more.onclick = () => { more.disabled = true; serviceRoutes(group, root, epoch, result.nextOffset); }; root.append(more); }
    } catch (e) { if (navigation.current(epoch) && root.isConnected) { const retry = node('button', 'Retry loading routes', 'load-more'); retry.onclick = () => serviceRoutes(group, root, epoch, offset); if (!offset) root.replaceChildren(empty(e.message)); else root.querySelector('.load-more')?.remove(); root.append(retry); } }
  }
  async function services(epoch) {
    const result = await tool('api_client_catalog', { ...(state.env ? { env: state.env } : {}), q: $('apiRouteSearch').value });
    if (!navigation.current(epoch)) return;
    state.env = result.env; state.services = result.services;
    $('apiEnvironment').replaceChildren(...result.environments.map(env => new Option(env, env))); $('apiEnvironment').value = result.env;
    const root = $('apiRoutes'); root.replaceChildren();
    for (const group of result.services) {
      const details = node('details', undefined, 'service-group'), summary = node('summary'), routes = node('div', undefined, 'service-routes');
      summary.append(node('span', group.name, 'group-name'), node('span', group.routeCount, 'group-count')); summary.title = `${group.totalRoutes} indexed routes · ${group.targets.length} targets${group.stale ? ' · stale Consul evidence' : ''}`;
      details.append(summary, routes); root.append(details); let loaded = false;
      details.addEventListener('toggle', () => { if (details.open && !loaded) { loaded = true; serviceRoutes(group, routes, epoch); } });
      if (query.get('service') === group.service || $('apiRouteSearch').value.trim()) details.open = true;
    }
    if (!root.children.length) root.append(empty('No matching services. Refresh passports or Consul in Admin, or create a request manually.'));
    const count = result.services.reduce((n, s) => n + s.routeCount, 0);
    libraryStatus(`${result.services.length} services · ${count} routes${result.consul.indexed ? ' · cached Consul' : ' · Consul not indexed'}`);
    if (result.warnings.length) { root.prepend(empty(result.warnings.map(w => w.message).join(' '))); libraryStatus('Some cached routes could not be read. See the library message.', true); }
  }
  function collectionTree(scripts, collections) {
    const root = { folders: new Map(), scripts: [] };
    const folder = path => path.split('/').filter(Boolean).reduce((at, name) => { if (!at.folders.has(name)) at.folders.set(name, { folders: new Map(), scripts: [] }); return at.folders.get(name); }, root);
    for (const c of collections) folder(c.collection);
    for (const s of scripts) folder(s.id.split('/').slice(0, -1).join('/')).scripts.push(s);
    const build = (at, parent) => {
      for (const [name, child] of at.folders) { const details = node('details', undefined, 'service-group'), summary = node('summary'), rows = node('div', undefined, 'service-routes'); summary.append(node('span', name, 'group-name')); details.append(summary, rows); parent.append(details); details.open = true; build(child, rows); }
      for (const script of at.scripts) { const b = node('button', undefined, 'route-item'); b.append(node('span', script.id.split('/').at(-1))); b.title = script.description || script.id; b.onclick = () => openScript(script.id).catch(e => notice(e.message, true)); parent.append(b); }
    };
    const parent = $('apiCollections'); parent.replaceChildren(); build(root, parent);
    if (!parent.children.length) parent.append(empty('No saved requests here. Use Save to collection after preparing a request.'));
  }
  async function collections(epoch) {
    const result = await tool('script_list', {}); if (!navigation.current(epoch)) return;
    state.scripts = result.scripts;
    const words = $('apiRouteSearch').value.toLowerCase().split(/\s+/).filter(Boolean), scripts = result.scripts.filter(s => words.every(w => `${s.id} ${s.description || ''}`.toLowerCase().includes(w)));
    const folders = words.length ? result.collections.filter(c => scripts.some(s => s.id.startsWith(c.collection + '/'))) : result.collections;
    collectionTree(scripts, folders); $('saved-request-names').replaceChildren(...result.scripts.map(s => new Option(s.id, s.id)));
    libraryStatus(`${scripts.length} saved requests & scripts · current task`);
  }
  async function history(epoch) {
    const result = await tool('api_exchange_list', { q: $('apiRouteSearch').value, limit: 500 }); if (!navigation.current(epoch)) return;
    const root = $('history'); root.replaceChildren();
    for (const e of result.exchanges) { const b = node('button', undefined, 'history-item'); b.append(method(e.method), node('span', e.status || 'No response'), node('small', e.ms != null ? `${e.ms} ms` : ''), node('span', e.url, 'route-path')); b.setAttribute('aria-current', String(state.exchange === e.id)); b.onclick = () => openExchange(e.id).catch(error => notice(error.message, true)); root.append(b); }
    if (!root.children.length) root.append(empty('No exchanges in this task. Send a request or import captured traffic.'));
    libraryStatus(`${result.exchanges.length} exchanges · newest 500 retained per task`);
  }
  async function refreshLibrary() {
    const epoch = navigation.advance(); libraryStatus('Loading…');
    try { await ({ services, collections, history })[state.mode](epoch); }
    catch (e) { if (navigation.current(epoch)) libraryStatus(e.message + ' Use Refresh to retry.', true); }
  }
  let searchTimer; $('apiRouteSearch').oninput = () => { navigation.advance(); clearTimeout(searchTimer); searchTimer = setTimeout(refreshLibrary, 160); };
  $('refresh').onclick = refreshLibrary;
  function template(value) { return String(value || '/').replace(/\{(?!\{)([a-z_]\w*)\}(?!\})|<([a-z_]\w*)>|:([a-z_]\w*)(?=\/|$|\?)/gi, (_, a, b, c) => '{{' + (a || b || c) + '}}'); }
  const unescapeTemplate = text => text.replace(/%7B%7B([^%]+)%7D%7D/gi, '{{$1}}');
  function urlParts(value) { try { const u = new URL(value); return { base: u.origin, path: unescapeTemplate(u.pathname + u.search) }; } catch { return { base: '', path: value || '/' }; } }
  function setTargets(group, base) {
    $('apiTarget').replaceChildren(new Option('Custom URL', ''));
    for (const [i, t] of (group?.targets || []).entries()) $('apiTarget').add(new Option(`${t.source === 'consul' ? t.status : 'Observed'} · ${t.url}${t.id ? ' · ' + t.id : ''}`, String(i)));
    const index = group?.targets?.findIndex(t => t.url === base) ?? -1; $('apiTarget').value = index < 0 ? '' : String(index);
    $('apiBaseUrl').value = base;
    $('target-status').textContent = index >= 0 ? `${group.targets[index].source === 'consul' ? 'Cached Consul address' : 'Observed origin'}${group.observedAt ? ' · ' + group.observedAt : ''}${group.stale ? ' · stale; review before sending' : ''}. Editable; no live health check.` : 'Custom target. Edit the base URL or the full request URL.';
  }
  function pairs(root, entries, kind) {
    root.replaceChildren(); for (const [key, value] of entries) addPair(root, key, value, kind);
  }
  function addPair(root, key = '', value = '', kind) {
    const row = node('div', undefined, 'pair-row'), keyInput = node('input'), valueInput = node('input'), remove = node('button');
    keyInput.value = key; keyInput.placeholder = kind === 'query' ? 'Parameter' : 'Header'; keyInput.setAttribute('aria-label', kind === 'query' ? 'Query parameter name' : 'Header name'); valueInput.value = value; valueInput.placeholder = 'Value'; valueInput.setAttribute('aria-label', kind === 'query' ? 'Query parameter value' : 'Header value'); valueInput.autocomplete = 'off';
    remove.type = 'button'; remove.setAttribute('aria-label', 'Remove ' + kind); remove.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    const update = () => { if (kind === 'query') syncUrlQuery(); else { clearTimeout(authTimer); authVersion.advance(); authTimer = setTimeout(authProfiles, 180); } changed(); renderVariables(); };
    keyInput.oninput = update; valueInput.oninput = update; remove.onclick = () => { row.remove(); update(); }; row.append(keyInput, valueInput, remove); root.append(row);
  }
  function pairValues(root) { return [...root.querySelectorAll('.pair-row')].map(row => [...row.querySelectorAll('input')].map(input => input.value)).filter(([key]) => key.trim()); }
  function syncUrlQuery() {
    const [beforeHash, hash] = $('url').value.split('#'), base = beforeHash.split('?')[0], params = new URLSearchParams();
    for (const [key, value] of pairValues($('query-rows'))) params.append(key, value);
    $('url').value = base + (params.size ? '?' + unescapeTemplate(params.toString()) : '') + (hash !== undefined ? '#' + hash : '');
  }
  function queryRows() { try { pairs($('query-rows'), new URL($('url').value, 'http://placeholder.invalid').searchParams, 'query'); } catch { pairs($('query-rows'), [], 'query'); } }
  function headers() {
    const out = {}, seen = new Set();
    for (const [key, value] of pairValues($('header-rows'))) { const name = key.trim().toLowerCase(); if (seen.has(name)) throw Error('Duplicate header: ' + key); seen.add(name); Object.defineProperty(out, name, { value, enumerable: true, configurable: true, writable: true }); }
    return out;
  }
  function renderVariables() {
    const serialized = [$('url').value, ...pairValues($('header-rows')).flat(), $('body-value').hidden ? '' : $('body-value').value].join('\n');
    const names = [...new Set([...serialized.matchAll(/\{\{([a-z_]\w*)\}\}/gi)].map(m => m[1]))]; let values; try { values = parse('params'); } catch { return; }
    const root = $('apiParameterFields'); root.replaceChildren(); root.hidden = !names.length;
    for (const name of names) {
      const spec = state.params[name] || {}, label = node('label', name), input = node('input'); input.type = spec.secret || /token|password|secret|authorization|api.?key/i.test(name) ? 'password' : spec.type === 'number' || spec.type === 'integer' ? 'number' : 'text'; input.autocomplete = 'off'; input.value = values[name] ?? spec.default ?? ''; input.placeholder = spec.description || 'Required runtime value';
      input.oninput = () => { const current = parse('params'); let value = input.value; if (value && ['number','integer','boolean','object','array'].includes(spec.type)) { try { value = JSON.parse(value); } catch {} } Object.defineProperty(current, name, { value, enumerable: true, writable: true, configurable: true }); $('params').value = JSON.stringify(current, null, 2); changed(); }; label.append(input); root.append(label);
    }
  }
  async function authProfiles() {
    const epoch = authVersion.advance(), url = $('url').value;
    try {
      const result = await tool('api_auth_profiles', { url }); if (!authVersion.current(epoch)) return;
      const profiles = result.profiles.filter(p => p.matches && p.configured).sort((a,b) => b.url.length - a.url.length);
      $('apiAuthProfile').replaceChildren(new Option('No authentication', ''), ...profiles.map(p => new Option(p.label + ' · Bearer', p.id)));
      const explicitHeader = pairValues($('header-rows')).some(([key]) => key.trim().toLowerCase() === 'authorization');
      const picked = state.authChoice !== null ? profiles.find(p => p.id === state.authChoice) : !explicitHeader && profiles.find(p => p.autoPrefill);
      $('apiAuthProfile').value = picked?.id || '';
      $('apiAuthStatus').textContent = picked ? 'Bearer reference selected. Its value is applied only on the backend.' : explicitHeader ? 'The request has an Authorization header. A configured bearer was not automatically selected.' : 'No configured bearer selected. Add a profile in api.authProfiles to use a server-side token.';
    } catch (e) { if (authVersion.current(epoch)) { $('apiAuthProfile').replaceChildren(new Option('No authentication', '')); $('apiAuthStatus').textContent = e.message; } }
  }
  function setRequest(request, specs = {}, values = {}) {
    selection.advance(); state.params = specs; state.authChoice = null; state.script = null;
    $('method').value = request.method || 'GET'; $('send').textContent = 'Send ' + $('method').value; $('url').value = request.url || '';
    pairs($('header-rows'), Object.entries(request.headers || {}), 'header');
    const body = request.body || { kind: 'none' }; $('body-kind').value = ['none','json','text','form'].includes(body.kind) ? body.kind : 'none'; $('body-value').value = body.kind === 'json' ? JSON.stringify(body.value, null, 2) : typeof body.value === 'string' ? body.value : ''; bodyVisibility();
    $('params').value = JSON.stringify(values, null, 2); $('bindings').value = '{}'; $('assertions').value = '[]'; $('capture').value = '{}'; $('overwrite').checked = false; $('script-id').value = ''; $('description').value = ''; $('save-panel').open = false;
    queryRows(); renderVariables(); authProfiles(); dirty.value = false; edits.advance();
  }
  function choose(route, group = null, baseOverride) {
    state.route = route; state.group = group; state.exchange = null;
    const path = template(route.path || '/'), base = baseOverride ?? group?.targets?.[0]?.url ?? route.origin ?? '';
    setRequest({ method: ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(route.method) ? route.method : 'GET', url: route.url || base.replace(/\/$/, '') + path });
    setTargets(group, urlParts($('url').value).base || base);
    $('request-title').textContent = group?.name || route.service || 'Request'; $('route').textContent = [route.method, route.path, route.handler, route.where].filter(Boolean).join(' · ') || 'Custom request'; $('description').value = `${$('method').value} ${path}`;
    notice(base || route.url ? 'Draft ready. Review variables and authentication, then Send.' : 'Add a base URL before sending this route.');
  }
  async function openExchange(id, initial = false) {
    if (!initial && !canReplace()) return; const epoch = selection.advance(), revision = edits.value;
    const exchange = await tool('api_exchange_get', { exchange: id }); if (!selection.current(epoch) || !edits.current(revision)) return;
    state.route = null; state.group = null; state.exchange = id; setRequest(exchange.request, exchange.params, {}); setTargets(null, urlParts(exchange.request.url).base);
    $('request-title').textContent = 'Captured request'; $('description').value = `${exchange.request.method} ${exchange.route.path || ''}`; $('route').textContent = (exchange.route.candidates || []).map(c => `${c.service} · ${c.handler}`).join(' | ') || 'Captured traffic';
    show(exchange); notice(`${exchange.redactions.length} redactions · ${exchange.gaps.length} capture gaps. Fill credential variables before replay.`);
  }
  async function openScript(id) {
    if (!canReplace()) return; const epoch = selection.advance(), revision = edits.value;
    const script = await tool('script_get', { id }); if (!selection.current(epoch) || !edits.current(revision)) return;
    const step = script.steps?.[0];
    if (script.steps?.length !== 1 || !step?.http || ['before','after','finally','js'].some(k => script[k] || step[k])) throw Error('This is a workflow with hooks or multiple steps. Open Scripts & collections to edit and run it.');
    const match = step.http.match(/^([A-Z]+)\s+(https?:\/\/\S+)$/i); if (!match) throw Error('The saved HTTP URL is dynamic. Edit it in Scripts & collections.');
    const contentType = Object.entries(step.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
    const body = step.body === undefined ? { kind: 'none' } : typeof step.body === 'object' ? { kind: 'json', value: step.body } : { kind: /x-www-form-urlencoded/i.test(contentType) ? 'form' : 'text', value: step.body };
    state.route = null; state.group = null; state.exchange = null;
    const values = { ...(script.vars || {}), ...Object.fromEntries(Object.entries(script.params || {}).filter(([,s]) => s.default !== undefined && !s.secret).map(([key,s]) => [key,s.default])) };
    setRequest({ method: match[1].toUpperCase(), url: match[2], headers: step.headers, body }, script.params, values); state.script = script;
    setTargets(null, urlParts(match[2]).base); $('request-title').textContent = id.split('/').at(-1); $('route').textContent = 'Saved request · ' + id; $('script-id').value = id; $('description').value = script.description || '';
    $('assertions').value = JSON.stringify(step.assertions || [], null, 2); $('capture').value = JSON.stringify(step.capture || {}, null, 2);
    notice('Saved request loaded. Send runs HTTP only; assertions, collection variables and hooks run in Scripts & collections.');
  }
  function bodyVisibility() { const none = $('body-kind').value === 'none'; $('body-value').hidden = none; $('body-empty').hidden = !none; $('format-body').hidden = $('body-kind').value !== 'json'; }
  function request() {
    const kind = $('body-kind').value; let value = $('body-value').value;
    if (kind === 'json') { try { value = JSON.parse(value); } catch { throw Error('Request body: enter valid JSON or choose Text.'); } }
    return { method: $('method').value, url: $('url').value.trim(), headers: headers(), body: { kind, ...(kind !== 'none' ? { value } : {}), ...(kind === 'text' ? { reviewed: true } : {}) } };
  }
  async function prepare(snapshot = request(), signal) {
    const bindings = parse('bindings');
    const result = await tool('api_request_prepare', { ...(state.exchange ? { exchange: state.exchange } : {}), request: snapshot, bindings, description: $('description').value || undefined, assertions: parse('assertions', true) }, signal);
    for (const [name, spec] of Object.entries(state.params)) if (result.params[name] && !Object.hasOwn(bindings, name)) result.params[name] = { ...result.params[name], ...spec };
    return result;
  }
  function lock(on) {
    const controls = [...document.querySelectorAll('.request-pane input,.request-pane textarea,.request-pane select,.request-pane button,#apiEnvironment')];
    for (const control of controls) if (control.id !== 'cancel') { if (on) { control.dataset.wasDisabled = String(control.disabled); control.disabled = true; } else { control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled; } }
    $('cancel').hidden = !on; document.querySelector('.workspace').setAttribute('aria-busy', String(on));
  }
  $('send').onclick = async () => {
    if (sending.value) return;
    try {
      const snapshot = request(), values = parse('params'); sending.value = true; state.controller = new AbortController(); lock(true); notice(`Sending ${snapshot.method} through the backend…`);
      const prepared = await prepare(snapshot, state.controller.signal), profile = $('apiAuthProfile').value;
      const exchange = await tool('api_request_replay', { prepared, params: values, ...(profile ? { auth_profile: profile } : {}) }, state.controller.signal);
      show(exchange); notice(`${exchange.response.status || 'No response'} · ${exchange.timing.durationMs ?? '—'} ms · exchange saved.`);
      if (state.mode === 'history') refreshLibrary();
    } catch (e) { notice(e.name === 'AbortError' ? 'Stopped waiting. The request may already have reached the service; check History before retrying a mutation.' : e.message, true); }
    finally { sending.value = false; state.controller = null; lock(false); $('notice').classList.remove('running'); }
  };
  $('cancel').onclick = () => state.controller?.abort();
  action($('save'), async () => {
    const revision = edits.value, prepared = await prepare();
    if (!edits.current(revision)) return notice('The draft changed while preparing. Save again to use the current request.');
    const result = await tool('api_request_save', { id: $('script-id').value.trim(), prepared, description: $('description').value || undefined, overwrite: $('overwrite').checked, assertions: parse('assertions', true), capture: parse('capture') });
    if (edits.current(revision)) dirty.value = false;
    notice(`Saved ${result.id}. Available in Collections.`); if (state.mode === 'collections') refreshLibrary();
  });
  action($('prepare'), async () => { const revision = edits.value, result = await prepare(); if (!edits.current(revision)) return notice('The draft changed while preparing. Apply bindings again.'); $('url').value = result.request.url; pairs($('header-rows'), Object.entries(result.request.headers), 'header'); if (result.request.body.kind === 'json') $('body-value').value = JSON.stringify(result.request.body.value, null, 2); state.params = result.params; $('bindings').value = '{}'; queryRows(); renderVariables(); changed(); notice('Bindings applied. Fill runtime variables before sending.'); });
  $('new-request').onclick = () => { if (!canReplace()) return; state.route = state.group = state.exchange = null; setRequest({ method: 'GET', url: '' }); setTargets(null, ''); $('request-title').textContent = 'New request'; $('route').textContent = 'Enter a URL or choose a service route.'; notice('Ready. Requests run through the backend.'); $('url').focus(); };
  $('method').onchange = () => { $('send').textContent = 'Send ' + $('method').value; changed(); };
  let authTimer;
  $('url').oninput = () => { state.route = null; const base = urlParts($('url').value).base; setTargets(state.group, base); queryRows(); renderVariables(); changed(); clearTimeout(authTimer); authVersion.advance(); authTimer = setTimeout(authProfiles, 180); };
  $('apiBaseUrl').oninput = () => { const { path } = urlParts($('url').value); $('url').value = $('apiBaseUrl').value.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path); $('apiTarget').value = ''; $('target-status').textContent = 'Custom base URL override.'; queryRows(); renderVariables(); changed(); authProfiles(); };
  $('apiTarget').onchange = () => { const target = state.group?.targets?.[Number($('apiTarget').value)]; if ($('apiTarget').value && target) { const { path } = urlParts($('url').value); $('url').value = target.url + (path.startsWith('/') ? path : '/' + path); setTargets(state.group, target.url); queryRows(); renderVariables(); changed(); authProfiles(); } };
  $('apiEnvironment').onchange = async () => {
    if (!canReplace()) { $('apiEnvironment').value = state.env; return; }
    const previous = state.route, service = state.group?.service, old = state.env; state.env = $('apiEnvironment').value; const requested = state.env, epoch = selection.advance(); navigation.advance(); changingEnvironment.value = true; lock(true); $('cancel').hidden = true; notice('Loading environment targets…');
    try { const result = await tool('api_client_catalog', { env: requested }); if (!selection.current(epoch) || state.env !== requested) return; state.services = result.services; const group = result.services.find(s => s.service && s.service === service); if (previous && group) choose(previous, group); else { state.group = state.route = state.exchange = null; setRequest({ method: 'GET', url: '' }); setTargets(null, ''); $('request-title').textContent = 'New request'; $('route').textContent = 'Environment changed. Select a route to use this environment’s targets.'; } await refreshLibrary(); }
    catch (e) { if (!selection.current(epoch)) return; state.env = old; $('apiEnvironment').value = old; notice(e.message, true); }
    finally { changingEnvironment.value = false; lock(false); }
  };
  $('apiAuthProfile').onchange = () => { state.authChoice = $('apiAuthProfile').value; changed(); $('apiAuthStatus').textContent = state.authChoice ? 'Bearer reference selected. Its value stays on the backend.' : 'No configured bearer selected.'; };
  $('body-kind').onchange = () => { bodyVisibility(); changed(); renderVariables(); };
  $('body-value').oninput = () => { changed(); renderVariables(); };
  $('params').oninput = () => { changed(); renderVariables(); };
  for (const id of ['bindings','assertions','capture','description','script-id','overwrite']) $(id).addEventListener('input', changed);
  $('add-query').onclick = () => { addPair($('query-rows'), '', '', 'query'); $('query-rows').lastElementChild.querySelector('input').focus(); };
  $('add-header').onclick = () => { addPair($('header-rows'), '', '', 'header'); $('header-rows').lastElementChild.querySelector('input').focus(); };
  action($('format-body'), () => { try { $('body-value').value = JSON.stringify(JSON.parse($('body-value').value), null, 2); changed(); } catch { throw Error('Body is not valid JSON. Correct it before formatting.'); } });
  function responseText() { const body = state.response?.response.body; return body?.kind === 'json' ? JSON.stringify(body.value, null, 2) : typeof body?.value === 'string' ? body.value : ''; }
  function pretty(value, root) {
    let budget = 1500;
    const draw = (value, key, depth) => {
      if (--budget < 0 || depth > 25) return node('p', 'Preview limit reached. Use Raw or Download for the full retained body.', 'json-summary');
      const prefix = key === null ? '' : JSON.stringify(key) + ': ';
      if (value && typeof value === 'object') {
        const entries = Object.entries(value), details = node('details'), summary = node('summary'), children = node('div', undefined, 'json-children');
        summary.append(node('span', prefix, 'json-key'), node('span', `${Array.isArray(value) ? '[' : '{'} ${entries.length} ${Array.isArray(value) ? 'items' : 'fields'} ${Array.isArray(value) ? ']' : '}'}`, 'json-summary')); details.open = depth < 2; details.append(summary, children);
        let rendered = false; const populate = () => { if (rendered || !details.open) return; rendered = true; for (const [k,v] of entries.slice(0,500)) { children.append(draw(v, k, depth + 1)); if (budget < 0) break; } if (entries.length > 500) children.append(node('p', `${entries.length - 500} more values in Raw or Download.`, 'json-summary')); };
        details.addEventListener('toggle', populate); populate(); return details;
      }
      const row = node('div', undefined, 'json-leaf'); row.append(node('span', prefix, 'json-key'), node('span', JSON.stringify(value), 'json-' + (value === null ? 'null' : typeof value))); return row;
    };
    root.append(draw(value, null, 0));
  }
  function renderBody() {
    const body = state.response?.response.body, root = $('response-body'); root.replaceChildren(); if (!body) return;
    if (body.kind === 'json' && !state.raw) pretty(body.value, root);
    else root.append(node('pre', body.kind === 'none' ? 'No response body.' : responseText() || body.reason || `Body unavailable (${body.kind}).`));
    $('pretty-response').setAttribute('aria-pressed', String(!state.raw)); $('raw-response').setAttribute('aria-pressed', String(state.raw));
  }
  function show(exchange) {
    state.response = exchange; $('response-empty').hidden = true; $('response-content').hidden = false; $('response').hidden = true; $('response').removeAttribute('src');
    const { response, timing, request } = exchange, status = response.status, meta = $('response-meta'); meta.replaceChildren(node('span', `${status || 'No status'} ${response.statusText || ''}`.trim(), 'response-status' + (status >= 400 ? ' bad' : status >= 300 ? ' warn' : '')), node('span', `${timing.durationMs ?? '—'} ms`, 'muted'), node('span', `${new TextEncoder().encode(responseText()).length.toLocaleString()} B retained`, 'muted'));
    $('response-url').hidden = false; $('response-url').textContent = `${request.method} ${request.url}`; $('response-kind').textContent = response.body.kind.toUpperCase(); renderBody();
    const table = node('table'), tbody = node('tbody'); for (const [key,value] of Object.entries(response.headers || {})) { const tr = node('tr'); tr.append(node('td', key), node('td', value)); tbody.append(tr); } table.append(tbody); $('response-headers').replaceChildren(Object.keys(response.headers || {}).length ? table : empty('No retained response headers.'));
    $('response-request').textContent = JSON.stringify(request, null, 2);
    const evidence = $('response-evidence'); evidence.replaceChildren(node('p', `${exchange.redactions.length} redactions · ${exchange.gaps.length} capture gaps · ${exchange.at}`));
    const handlers = exchange.route?.candidates || []; evidence.append(node('p', handlers.length ? handlers.map(c => `${c.service} → ${c.handler || c.path} ${c.where || ''}`).join('\n') : 'No cached handler attribution.'));
    if (exchange.gaps.length) { const list = node('ul'); for (const gap of exchange.gaps) list.append(node('li', `${gap.kind}: ${gap.reason || gap.location || JSON.stringify(gap)}`)); evidence.append(list); }
    $('exchange-link').href = '/api-client?' + new URLSearchParams({ exchange: exchange.id, story: scope.story, ...(scope.principal ? { principal: scope.principal } : {}) }); $('copy-response').disabled = false; $('download-response').disabled = false;
    const pane = document.querySelector('.response-pane'); pane.classList.remove('updated'); requestAnimationFrame(() => pane.classList.add('updated'));
  }
  $('pretty-response').onclick = () => { state.raw = false; renderBody(); }; $('raw-response').onclick = () => { state.raw = true; renderBody(); };
  action($('copy-response'), async () => { await navigator.clipboard.writeText(responseText()); notice('Response body copied.'); });
  $('download-response').onclick = () => { if (!state.response) return; const blob = new Blob([JSON.stringify(state.response, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = 'exchange-' + state.response.id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  $('show-full-evidence').onclick = () => { if (state.response) { $('response').src = state.response.view; $('response').hidden = false; } };
  function captureButtons(on) { for (const id of ['act-browser','drain-browser','close-browser']) $(id).disabled = !on; }
  action($('import'), async () => { if (!canReplace()) return; const r = await tool('api_exchange_import', { data: $('import-data').value, source: 'API client import' }); $('import-data').value = ''; await refreshLibrary(); if (r.exchanges[0]) await openExchange(r.exchanges[0].id, true); notice(`Imported ${r.count} exchanges.`); });
  action($('open-browser'), async () => { if (state.session) await tool('api_browser_close', { session: state.session }); state.session = null; captureButtons(false); const r = await tool('api_browser_open', { url: $('browser-url').value }); state.session = r.session; captureButtons(true); $('capture-status').textContent = `Capture ${r.mode}; cookies remain in this browser session.`; notice('Browser opened. Inspect the UI or collect its traffic.'); });
  action($('act-browser'), async () => { const r = await tool('api_browser_action', { session: state.session, action: $('browser-action').value, args: parse('browser-args') }); $('snapshot').hidden = false; $('snapshot').textContent = r.text; });
  action($('drain-browser'), async () => { if (!canReplace()) return; const r = await tool('api_browser_capture', { session: state.session, source: 'API client UI capture' }); await refreshLibrary(); if (r.exchanges[0]) await openExchange(r.exchanges[0].id, true); notice(`Collected ${r.count} exchanges · ${r.gaps.length} capture gaps.`); });
  $('close-browser').onclick = async () => { try { await tool('api_browser_close', { session: state.session }); state.session = null; captureButtons(false); $('capture-status').textContent = 'Browser closed. Captured exchanges remain available.'; } catch (e) { notice(e.message, true); } };
  window.addEventListener('beforeunload', event => { if (dirty.value || sending.value) { event.preventDefault(); event.returnValue = ''; } });
  async function initialize() {
    await services(navigation.advance());
    if (query.has('exchange')) await openExchange(query.get('exchange'), true);
    else if (query.has('path') || query.has('url')) { const route = { method: query.get('method') || 'GET', path: query.get('path') || urlParts(query.get('url')).path, service: query.get('service') || '', ...(query.has('url') ? { url: query.get('url') } : {}) }; const group = state.services.find(s => s.service && s.service === route.service || s.key === 'host:' + query.get('host')); choose(route, group, query.get('base') || undefined); }
    else { bodyVisibility(); await authProfiles(); }
  }
  initialize().catch(e => { libraryStatus(e.message + ' Use Refresh to retry.', true); notice(e.message, true); });
})();
