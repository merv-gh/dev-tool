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
    let response;
    try{response = await fetch('/api/tool/' + name, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-dt-story': scope.story, ...(scope.principal ? { 'x-dt-principal': scope.principal } : {}) }, body: JSON.stringify(args), signal });}catch(e){e.transport=true;throw e;}
    let payload; try { payload = await response.json(); } catch { throw Error(`HTTP ${response.status}: the backend returned a non-JSON response.`); }
    if (!response.ok || payload.error) throw Object.assign(Error(payload.error?.message || payload.error || `HTTP ${response.status}`), {exchange:payload.exchange,code:payload.code});
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
    const build = (at, parent, prefix='') => {
      for (const [name, child] of at.folders) { const path=prefix?prefix+'/'+name:name, details = node('details', undefined, 'service-group'), summary = node('summary'), rows = node('div', undefined, 'service-routes'), manage=node('button','Collection settings','text-button'); summary.append(node('span', name, 'group-name'));manage.onclick=()=>openCollection(path).catch(e=>notice(e.message,true));rows.append(manage); details.append(summary, rows); parent.append(details); details.open = true; build(child, rows, path); }
      for (const script of at.scripts) { const b = node('button', undefined, 'route-item'); b.dataset.scriptId=script.id;b.setAttribute('aria-current',String((!$('workflow-editor').hidden?wfSavedId:state.script?.id)===script.id));b.append(node('span', script.id.split('/').at(-1))); b.title = script.description || script.id; b.onclick = () => openScript(script.id).catch(e => notice(e.message, true)); parent.append(b); }
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
    await sharedLibrary();
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
    $('refresh-instances').disabled=!group?.service;
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
    hideOtherEditors();
    idleResult('http');
    $('http-editor').hidden = false; $('workflow-editor').hidden = true;
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
    if (script.steps?.length !== 1 || !step?.http || ['before','after','finally','js'].some(k => script[k] || step[k])) return openWorkflow(script);
    const match = step.http.match(/^([A-Z]+)\s+(https?:\/\/\S+)$/i); if (!match) return openWorkflow(script);
    const contentType = Object.entries(step.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
    const body = step.body === undefined ? { kind: 'none' } : typeof step.body === 'object' ? { kind: 'json', value: step.body } : { kind: /x-www-form-urlencoded/i.test(contentType) ? 'form' : 'text', value: step.body };
    state.route = null; state.group = null; state.exchange = null;
    const values = { ...(script.vars || {}), ...Object.fromEntries(Object.entries(script.params || {}).filter(([,s]) => s.default !== undefined && !s.secret).map(([key,s]) => [key,s.default])) };
    setRequest({ method: match[1].toUpperCase(), url: match[2], headers: step.headers, body }, script.params, values); state.script = script;markCollections(id);
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
    } catch (e) {
      if(e.exchange)show(e.exchange);
      else {state.response=null;wfResultVisible(false);$('response-content').hidden=true;$('response-empty').hidden=true;$('response-meta').replaceChildren(node('span','No complete response','response-status bad'));$('response-url').hidden=true;$('copy-response').disabled=$('download-response').disabled=true;}
      const message=e.name === 'AbortError' ? 'Stopped waiting. The request may already have reached the service; check History before retrying a mutation.' : e.exchange?.failure?.reason || (e.transport?'Backend request failed: '+e.message+'. Check connectivity and History before retrying; no action is replayed automatically.':e.message);
      failure(message,e.exchange?.failure?.executionId);notice(message,true);console.warn('API explorer request failed',{code:e.code||e.name,exchange:e.exchange?.id||null});
      if(state.mode==='history')refreshLibrary();
    }
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
    wfResultVisible(false);
    $('db-query-result').hidden=true;
    $('request-failure').hidden=true;
    state.response = exchange; $('response-empty').hidden = true; $('response-content').hidden = false; $('response').hidden = true; $('response').removeAttribute('src');
    const { response, timing, request } = exchange, status = response.status, meta = $('response-meta'); meta.replaceChildren(node('span', `${status || 'No HTTP response'} ${response.statusText || ''}`.trim(), 'response-status' + (exchange.failure || status >= 400 ? ' bad' : !status || status >= 300 ? ' warn' : '')), node('span', `${timing.durationMs ?? '—'} ms`, 'muted'), node('span', `${new TextEncoder().encode(responseText()).length.toLocaleString()} B retained`, 'muted'));
    $('response-url').hidden = false; $('response-url').textContent = `${request.method} ${request.url}`; $('response-kind').textContent = response.body.kind.toUpperCase(); renderBody();
    const table = node('table'), tbody = node('tbody'); for (const [key,value] of Object.entries(response.headers || {})) { const tr = node('tr'); tr.append(node('td', key), node('td', value)); tbody.append(tr); } table.append(tbody); $('response-headers').replaceChildren(Object.keys(response.headers || {}).length ? table : empty('No retained response headers.'));
    $('response-request').textContent = JSON.stringify(request, null, 2);
    const evidence = $('response-evidence'); evidence.replaceChildren(node('p', `${exchange.redactions.length} redactions · ${exchange.gaps.length} capture gaps · ${exchange.at}`));
    const handlers = exchange.route?.candidates || []; evidence.append(node('p', handlers.length ? handlers.map(c => `${c.service} → ${c.handler || c.path} ${c.where || ''}`).join('\n') : 'No cached handler attribution.'));
    if (exchange.gaps.length) { const list = node('ul'); for (const gap of exchange.gaps) list.append(node('li', `${gap.kind}: ${gap.reason || gap.location || JSON.stringify(gap)}`)); evidence.append(list); }
    $('exchange-link').href = '/api-client?' + new URLSearchParams({ exchange: exchange.id, story: scope.story, ...(scope.principal ? { principal: scope.principal } : {}) }); $('copy-response').disabled = false; $('download-response').disabled = false;
    const pane = document.querySelector('.response-pane'); pane.classList.remove('updated'); requestAnimationFrame(() => pane.classList.add('updated'));
    if(exchange.failure)failure(exchange.failure.reason,exchange.failure.executionId);
  }
  function failure(message,executionId){$('request-failure').hidden=false;$('failure-detail').textContent=message;$('failure-trace').hidden=!executionId;if(executionId)$('failure-trace').href='/admin#runtime?'+new URLSearchParams({execution:executionId,story:scope.story});}
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
  // Workflows are ordinary scripts. HTTP-only drafts keep their existing lightweight editor.
  const W = window.DTWorkflow, wfTargets = new Map(), wfTargetReads = new SM.Revision();
  const wfLife = SM.create(SM.define('UI.apiWorkflowRun', 'idle', { idle:['starting','running'], starting:['running','complete','unknown'], running:['cancelling','complete','unknown'], cancelling:['running','complete','unknown'], complete:['starting','running','idle'], unknown:['running','complete','idle'] }));
  let wf = null, wfIndex = 0, wfRevision = null, wfSavedId = null, wfRun = null, wfJob = null, wfTimer, wfJsonDirty = false, wfStepDirty = false, wfLocked = false;
  const wfBusy = () => wfLife.is('starting','running','cancelling','unknown');
  const wfPretty = value => JSON.stringify(value, null, 2);
  function wfNotice(text, error = false) { notice(text,error); }
  function wfSync() { if (!wfJsonDirty) $('wf-definition').value = wfPretty(wf); if (!wfStepDirty) $('wf-step-json').value = wfPretty(wf.steps[wfIndex]); }
  function wfChange() { changed(); wf.description = $('wf-description').value; wfSync(); renderWorkflowSteps(); }
  function wfPending(checkFields=true) { if (wfJsonDirty || wfStepDirty) throw Error('Apply the edited definition or step JSON before saving, running or changing steps.'); if(checkFields){const invalid=[...$('wf-fields').querySelectorAll('input,textarea,select')].find(n=>!n.validity.valid);if(invalid){invalid.reportValidity();throw Error('Fix the selected step field before changing steps, saving or running.');}} }
  function wfUrl() {
    const q = new URLSearchParams(location.search); for (const k of ['exchange','workflow','run','job','shared','revision']) q.delete(k);
    if (wfSavedId) q.set('workflow',wfSavedId); if (wfRun) q.set('run',wfRun); if (wfJob) q.set('job',wfJob);
    window.history.replaceState(null,'',location.pathname+'?'+q);
  }
  function wfLock(on) { sending.value=on; if(on!==wfLocked){lock(on);wfLocked=on;} $('cancel').hidden=true; $('wf-cancel').hidden=!on; $('wf-cancel').disabled=!wfRun; $('wf-observe').hidden=!wfLife.is('unknown'); }
  function wfResultVisible(on) {
    $('db-query-result').hidden=true;
    $('workflow-result').hidden=!on;$('result-title').textContent=on?'Run results':'Response';
    for(const id of ['copy-response','download-response','response-meta','response-url'])$(id).hidden=on;
    $('response-empty').hidden=on||!!state.response;$('response-content').hidden=on||!state.response;
  }
  async function openWorkflow(script) {
    clearTimeout(wfTimer);wfRun=wfJob=null;if(wfLife.is('complete'))wfLife.to('idle');wfResultVisible(false);
    selection.advance(); wf=W.definition(script); wfIndex=0; wfRevision=script.revision||null; wfSavedId=script.id||null; wfJsonDirty=wfStepDirty=false;
    $('http-editor').hidden=true; $('workflow-editor').hidden=false; $('request-title').textContent=wfSavedId?.split('/').at(-1)||'New workflow';
    hideOtherEditors();$('wf-share-link').hidden=true;$('wf-share-status').textContent='';
    idleResult('workflow');markCollections(wfSavedId);
    $('route').textContent='Collection workflow · HTTP, UI, databases and events'; $('wf-id').value=wfSavedId||''; $('wf-description').value=wf.description||'';
    $('wf-params').value=wfPretty(Object.fromEntries(Object.entries(wf.params||{}).filter(([,p])=>p.default!==undefined&&!p.secret).map(([k,p])=>[k,p.default])));
    dirty.value=false; edits.advance(); wfSync(); renderWorkflowSteps(); renderWorkflowStep(); wfUrl();
    if(state.mode!=='collections')$('source-collections').click();
    wfNotice('Workflow loaded. Review targets and runtime values, then Validate or Run.');
  }
  function renderWorkflowSteps() {
    const root=$('wf-steps'); root.replaceChildren(); $('wf-step-count').textContent=`${wf.steps.length} steps`;
    wf.steps.forEach((step,i)=>{ const li=node('li'),b=node('button',undefined,'workflow-step'); b.setAttribute('aria-current',String(i===wfIndex));
      b.append(node('span',W.title(step),'workflow-step-title')); const detail=[W.target(step),step.as?'→ '+step.as:''].filter(Boolean).join(' · '); if(detail)b.append(node('small',detail));
      b.disabled=wfBusy(); b.onclick=()=>{try{wfPending();wfIndex=i;wfStepDirty=false;wfSync();renderWorkflowSteps();renderWorkflowStep();}catch(e){wfNotice(e.message,true);}};li.append(b);root.append(li); });
  }
  function wfField(label, value, update, { json, list, resource, options, rows, type = 'text', hint } = {}) {
    const id='wf-field-'+$('wf-fields').children.length, wrap=node('div',undefined,'workflow-field'), caption=node('label',label), input=node(options?'select':rows||json?'textarea':'input'); input.id=id;caption.htmlFor=id;wrap.append(caption);
    if(options)for(const option of options)input.add(new Option(typeof option==='string'?option:option.label,typeof option==='string'?option:option.value));
    if(input.tagName==='INPUT')input.type=type; if(rows||json){input.rows=rows||3;input.spellcheck=false;}
    if(list){const dl=node('datalist');dl.id=id+'-choices';if(resource)dl.dataset.resource=resource;for(const name of list)dl.append(new Option(name,name));input.setAttribute('list',dl.id);wrap.append(dl);}
    input.value=json?wfPretty(value):value??'';input.autocomplete='off';input.disabled=wfBusy();
    input[options?'onchange':'oninput']=()=>{try{wfPending(false);const next=json?W.value(input.value,json):input.value;update(next);input.setCustomValidity('');wfChange();}catch(e){changed();input.setCustomValidity(e.message);wfNotice(label+': '+e.message,true);}};
    wrap.append(input);if(hint){const note=node('p',hint,'field-note');note.id=id+'-hint';input.setAttribute('aria-describedby',note.id);wrap.append(note);}$('wf-fields').append(wrap);return input;
  }
  async function wfResources(env, step) {
    const epoch=wfTargetReads.advance();
    try { if(!wfTargets.has(env))wfTargets.set(env,await tool('api_client_catalog',{env,resources:true})); if(!wfTargetReads.current(epoch)||wf?.steps[wfIndex]!==step)return; const r=wfTargets.get(env).resources||{};for(const dl of $('wf-fields').querySelectorAll('datalist[data-resource]'))dl.replaceChildren(...(r[dl.dataset.resource]||[]).map(name=>new Option(name,name))); }
    catch(e){if(wfTargetReads.current(epoch))wfNotice('Target suggestions unavailable: '+e.message+'. Enter a configured name manually.',true);}
  }
  function renderWorkflowStep(fromCache=false) {
    const step=wf.steps[wfIndex], root=$('wf-fields');root.replaceChildren();$('wf-step-title').textContent=`Step ${wfIndex+1} · ${W.types[W.kind(step)]||'Advanced'}`;
    $('wf-up').disabled=wfBusy()||wfIndex===0;$('wf-down').disabled=wfBusy()||wfIndex===wf.steps.length-1;$('wf-remove').disabled=wfBusy()||wf.steps.length===1;
    $('wf-as').value=step.as||'';$('wf-step-json').value=wfPretty(step);
    const defaultEnv=$('apiEnvironment').options[0]?.value||state.env, env=step.args?.env||defaultEnv, catalog=wfTargets.get(env), resources=catalog?.resources||{}, type=W.kind(step);
    const arg=(key,value)=>{step.args||={};step.args[key]=value;};
    if(step.tool){
      wfField('Environment',step.args?.env||'',v=>{if(v)arg('env',v);else delete step.args.env;wfChange();wfResources(v||defaultEnv,step);},{options:[{label:`Default (${defaultEnv})`,value:''},...[...new Set([...$('apiEnvironment').options].map(o=>o.value).concat(env).filter(Boolean))].map(value=>({label:value,value}))],hint:'Independent of the library environment above. Default uses the first configured environment.'});
      if(!catalog&&!fromCache&&!String(env).includes('{{'))wfResources(env,step);
    }
    if(type==='http'){
      const match=step.http.match(/^(\S+)\s+([\s\S]*)$/)||['','GET',''];
      wfField('Method',match[1],v=>{step.http=v+' '+(step.http.split(/\s+/).slice(1).join(' '));},{options:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']});
      wfField('URL',match[2],v=>{step.http=step.http.split(/\s+/)[0]+' '+v;});
      const targets=(wfTargets.get(state.env)?.services||state.services).flatMap(s=>s.targets.map(t=>({label:s.name+' · '+t.url,value:t.url})));
      wfField('Use service base URL','',v=>{if(!v)return;step.http=step.http.split(/\s+/)[0]+' '+v+(urlParts(step.http.split(/\s+/).slice(1).join(' ')).path||'/');wfSync();renderWorkflowStep();},{options:[{label:'Keep current URL',value:''},...targets]});
      wfField('Headers',step.headers||{},v=>step.headers=v,{json:'object'});wfField('Body (JSON value)',step.body??null,v=>{if(v===null)delete step.body;else step.body=v;},{json:'any',hint:'Use null for no body, a quoted string for text, or a JSON object.'});
    } else if(type==='pg_query'){
      wfField('Database',step.args.db||'',v=>arg('db',v),{list:resources.databases||[],resource:'databases',hint:'Configured database name; SQL stays read-only.'});
      wfField('SQL',step.args.sql||'',v=>arg('sql',v),{rows:6});wfField('Bound parameters ($1, $2, …)',step.args.params||[],v=>arg('params',v),{json:'array'});
    } else if(type==='es_search'){
      wfField('Index or alias',step.args.index||'',v=>arg('index',v),{list:resources.indices||[],resource:'indices'});wfField('Query or JSON DSL',step.args.query||'',v=>arg('query',v),{rows:5});
    } else if(type.startsWith('kafka_')){
      wfField('Cluster',step.args.cluster||'',v=>{if(v)arg('cluster',v);else delete step.args.cluster;},{list:resources.cluster?[resources.cluster]:[],hint:'Blank selects the first online cluster.'});
      wfField('Topic',step.args.topic||'',v=>arg('topic',v),{list:resources.topics||[],resource:'topics'});
      if(type==='kafka_wait'){
        wfField('Checkpoint (JSON or quoted template)',step.args.checkpoint??'{{checkpoint}}',v=>arg('checkpoint',v),{json:'any',hint:'Checkpoint before the action that emits the event. Without one, waiting starts at the current end.'});
        wfField('Match message paths',step.args.match||{},v=>arg('match',v),{json:'object'});wfField('Timeout in milliseconds',step.args.timeout_ms??30000,v=>arg('timeout_ms',Number(v)),{type:'number'});
      }
      if(type==='kafka_produce'){
        wfField('Partition',step.args.partition??0,v=>arg('partition',Number(v)),{type:'number'});wfField('Message key (JSON value)',step.args.key??null,v=>arg('key',v),{json:'any'});
        wfField('Message value (JSON value)',step.args.value??{},v=>arg('value',v),{json:'any',hint:'Produce sends once. An explicit null value creates a tombstone.'});wfField('Headers',step.args.headers||{},v=>arg('headers',v),{json:'object'});
      }
    } else if(type==='open')wfField('UI URL or configured site.link',step.open,v=>step.open=v,{list:(resources.sites||[]).flatMap(s=>[s.site,...s.links.map(l=>s.site+'.'+l)])});
    else if(type==='browser'){
      wfField('UI action',step.browser,v=>step.browser=v,{options:['snapshot','click','type','fill_form','press_key','select_option','hover','wait_for','take_screenshot','navigate','navigate_back','run_code']});
      wfField('Playwright arguments',step.args||{},v=>step.args=v,{json:'object',hint:'Use refs from a snapshot, or run_code with durable Playwright locators for repeatable UI tests.'});
    } else if(type==='tool'){
      wfField('Tool name',step.tool,v=>step.tool=v);wfField('Tool arguments',step.args||{},v=>step.args=v,{json:'object'});
    } else if(type==='script'){
      wfField('Saved script',step.script,v=>step.script=v,{list:state.scripts.map(s=>s.id)});wfField('Script parameters',step.params||{},v=>step.params=v,{json:'object'});
    } else if(type==='set')wfField('Values',step.set,v=>step.set=v,{json:'object'});
    else if(type==='js')wfField('JavaScript',step.js,v=>step.js=v,{rows:8});
    else root.append(node('p','This step uses the full script language. Edit its JSON below.','field-note'));
  }
  async function saveWorkflow() {
    wfPending();
    const id=$('wf-id').value.trim();W.selection(id);wf.description=$('wf-description').value;const rev=edits.value;
    const r=await tool('script_save',{id,description:wf.description,steps:wf.steps,definition:wf,expected_revision:id===wfSavedId?wfRevision:null});
    wfSavedId=id;wfRevision=r.revision;if(edits.current(rev))dirty.value=false;wfUrl();markCollections(id);if(state.mode==='collections')refreshLibrary();return r;
  }
  const wfArgs=()=>({...W.selection(wfSavedId),params:parse('wf-params')});
  for(const [key,label] of Object.entries(W.types))$('wf-add-kind').add(new Option(label,key));
  $('new-workflow').onclick=()=>{if(!canReplace())return;openWorkflow({description:'',steps:[W.create('http',state.env)]});changed();};
  action($('request-to-workflow'),async()=>{if(sending.value)return;const revision=edits.value,p=await prepare();if(!edits.current(revision))throw Error('Draft changed. Try again.');await openWorkflow({...p.script,steps:[{...p.script.steps[0],assertions:parse('assertions',true),capture:parse('capture')} ]});$('wf-params').value=$('params').value;changed();});
  $('wf-add').onclick=()=>{try{wfPending();const step=W.create($('wf-add-kind').value,state.env);if(step.as){const names=new Set(wf.steps.map(s=>s.as));let name=step.as,i=2;while(names.has(name))name=step.as+i++;step.as=name;}wf.steps.push(step);wfIndex=wf.steps.length-1;wfChange();renderWorkflowStep();}catch(e){wfNotice(e.message,true);}};
  function wfMove(delta){try{wfPending();const next=wfIndex+delta;if(next<0||next>=wf.steps.length)return;[wf.steps[wfIndex],wf.steps[next]]=[wf.steps[next],wf.steps[wfIndex]];wfIndex=next;wfChange();renderWorkflowStep();}catch(e){wfNotice(e.message,true);}}
  $('wf-up').onclick=()=>wfMove(-1);$('wf-down').onclick=()=>wfMove(1);
  $('wf-copy').onclick=()=>{try{wfPending();const step=structuredClone(wf.steps[wfIndex]);if(step.as)delete step.as;wf.steps.splice(wfIndex+1,0,step);wfIndex++;wfChange();renderWorkflowStep();}catch(e){wfNotice(e.message,true);}};
  $('wf-remove').onclick=()=>{try{wfPending();if(wf.steps.length===1)return;wf.steps.splice(wfIndex,1);wfIndex=Math.min(wfIndex,wf.steps.length-1);wfChange();renderWorkflowStep();}catch(e){wfNotice(e.message,true);}};
  $('wf-as').oninput=()=>{try{wfPending(false);if($('wf-as').value)wf.steps[wfIndex].as=$('wf-as').value;else delete wf.steps[wfIndex].as;wfChange();}catch(e){wfNotice(e.message,true);}};
  $('wf-description').oninput=wfChange;$('wf-id').oninput=changed;$('wf-params').oninput=changed;
  $('wf-definition').oninput=()=>{wfJsonDirty=true;changed();};$('wf-step-json').oninput=()=>{wfStepDirty=true;changed();};
  $('wf-apply-definition').onclick=()=>{try{const def=W.value($('wf-definition').value);if(!Array.isArray(def.steps)||!def.steps.length)throw Error('A workflow needs at least one step.');wf=W.definition(def);wfIndex=Math.min(wfIndex,wf.steps.length-1);wfJsonDirty=wfStepDirty=false;$('wf-description').value=wf.description||'';wfChange();renderWorkflowStep();wfNotice('Definition applied. Validate before running.');}catch(e){wfNotice(e.message,true);}};
  $('wf-apply-step').onclick=()=>{try{if(wfJsonDirty)throw Error('Apply the full definition first.');wf.steps[wfIndex]=W.value($('wf-step-json').value);wfStepDirty=false;wfChange();renderWorkflowStep();wfNotice('Step applied.');}catch(e){wfNotice(e.message,true);}};
  action($('wf-save'),async()=>{const r=await saveWorkflow();wfNotice('Saved '+r.id+'. No steps executed.');});
  action($('wf-validate'),async()=>{await saveWorkflow();const r=await tool('collection_validate',wfArgs());wfResultVisible(true);$('wf-run-errors').hidden=r.ok;$('wf-run-errors').textContent=wfPretty(r.errors||[]);$('wf-run-status').textContent=r.ok?'Validation passed':'Validation failed';$('wf-progress').textContent='No steps executed.';$('wf-run-steps').replaceChildren();$('wf-report-link').hidden=true;wfNotice(r.ok?'Validation passed. No steps executed.':'Fix the reported validation errors before running.',!r.ok);});
  function wfPaint(report){
    wfResultVisible(true);$('wf-run-status').textContent='Workflow · '+report.status;
    const p=report.progress;$('wf-progress').textContent=[`${report.counts.passed}/${report.counts.cases} cases passed`,p?`Step ${p.step}: ${p.do} · ${p.status}`:'Starting…',report.run].join(' · ');
    const errors=[report.error,...(report.cleanupErrors||[]).map(e=>e.error),...(report.cases||[]).map(c=>c.result?.error||c.error)].filter(Boolean);$('wf-run-errors').hidden=!errors.length;$('wf-run-errors').textContent=errors.join('\n');
    const root=$('wf-run-steps');root.replaceChildren();for(const c of report.cases||[])for(const s of c.result?.steps||[]){const target=s.target?Object.values(s.target).filter(Boolean).join(' / '):'',d=node('details'),summary=node('summary',[`Step ${s.step}`,s.ok?'Passed':'Failed',s.do,target,s.name?'→ '+s.name:'',`${s.ms} ms`].filter(Boolean).join(' · '));d.append(summary,node('pre',s.error||wfPretty(s.result)));if(!s.ok)d.open=true;root.append(d);}
    if(p&&report.status==='running'){const d=node('details'),summary=node('summary',`Current · ${p.do} · ${p.status}`);d.append(summary,node('pre',p.error||wfPretty(p.result)));root.append(d);}
    if(report.view){$('wf-report-link').href=report.view;$('wf-report-link').hidden=false;}
  }
  async function observeWorkflow(){
    clearTimeout(wfTimer);
    try{
      if(!wfRun&&wfJob){const r=await tool('collection_run',{job:wfJob,wait_ms:0});if(r.run)wfRun=r.run;else if(r.error)throw Error(r.error);else if(r.status!=='running')throw Error('Job ended without a run. Check collection history.');}
      if(!wfRun){wfTimer=setTimeout(observeWorkflow,1000);return;}
      const report=await tool('collection_history',{run:wfRun});wfUrl();wfPaint(report);
      if(report.status==='running') {if(!wfLife.is('cancelling'))wfLife.to('running');wfLock(true);wfTimer=setTimeout(observeWorkflow,1000);}
      else {wfLife.to('complete');wfLock(false);$('wf-observe').hidden=true;wfNotice('Workflow '+report.status+'. Results are retained for this task.',!report.ok);renderWorkflowSteps();renderWorkflowStep();}
    }catch(e){wfLife.to('unknown');wfLock(true);$('wf-cancel').disabled=!wfRun;$('wf-progress').textContent='Status unavailable: '+e.message;wfNotice('Run status unavailable. Refresh status to reconnect; no actions will be replayed.',true);}
  }
  $('wf-run').onclick=async()=>{
    if(wfBusy())return;
    let dispatched=false;
    try{
      wfPending();wfLife.to('starting');wfLock(true);await saveWorkflow();wfRun=wfJob=null;wfUrl();wfResultVisible(true);$('wf-run-status').textContent='Validating workflow…';$('wf-progress').textContent='Starting one background run…';$('wf-run-errors').hidden=true;$('wf-report-link').hidden=true;$('wf-run-steps').replaceChildren();
      dispatched=true;
      const r=await tool('collection_run',{...wfArgs(),wait_ms:0});
      if(r.status==='invalid'){wfLife.to('complete');wfLock(false);$('wf-run-errors').hidden=false;$('wf-run-errors').textContent=wfPretty(r.validation.errors);$('wf-run-status').textContent='Validation failed';return wfNotice('No steps executed. Fix validation errors.',true);}
      wfRun=r.run||null;wfJob=r.job||null;wfUrl();await observeWorkflow();
    }catch(e){if(wfLife.is('starting')){wfLife.to(dispatched?'unknown':'complete');wfLock(dispatched);wfNotice(dispatched?'Start acknowledgement failed. Check collection history before retrying: '+e.message:e.message,true);$('wf-observe').hidden=!dispatched;}else wfNotice(e.message,true);}
  };
  $('wf-observe').onclick=async()=>{if(!wfRun&&!wfJob){try{const rows=await tool('collection_history',{collection:W.selection(wfSavedId).collection,limit:10});$('wf-run-errors').hidden=false;$('wf-run-errors').textContent=wfPretty(rows);wfNotice('Review the retained runs. Reload a run URL to inspect it; no run was started.');}catch(e){wfNotice(e.message,true);}return;}observeWorkflow();};
  $('wf-cancel').onclick=async()=>{if(!wfRun)return;try{const r=await tool('collection_cancel',{run:wfRun,reason:'Cancelled in API explorer'});if(r.cancelled)wfLife.to('cancelling');wfNotice('Cancellation requested. Waiting for cleanup.');observeWorkflow();}catch(e){wfNotice(e.message,true);}};
  window.addEventListener('beforeunload', event => { if (dirty.value || sending.value) { event.preventDefault(); event.returnValue = ''; } });
  function hideOtherEditors(){for(const id of ['collection-editor','shared-preview'])$(id).hidden=true;}
  function markCollections(id){for(const b of $('apiCollections').querySelectorAll('[data-script-id]'))b.setAttribute('aria-current',String(b.dataset.scriptId===id));}
  function idleResult(kind){
    state.response=null;wfResultVisible(false);$('request-failure').hidden=true;$('response-content').hidden=true;$('response-empty').hidden=false;$('response-url').hidden=true;$('copy-response').disabled=$('download-response').disabled=true;$('response-meta').replaceChildren(node('span','No execution yet','muted'));
    $('result-title').textContent=kind==='workflow'?'Run results':'Response';$('response-empty').querySelector('h3').textContent=kind==='workflow'?'Workflow results appear here':'Your response appears here';
    $('response-empty').querySelector('p').textContent=kind==='workflow'?'Review targets and runtime values, then press Run workflow. Database previews appear here after Run query.':'Choose a route, review the request and press Send. Open History to inspect a previous exchange.';
  }
  action($('refresh-instances'),async()=>{
    const service=state.group?.service,env=state.env;if(!service)throw Error('Choose a service route first.');
    $('instances-status').textContent='Contacting Consul…';
    try{
      const r=await tool('api_instances_refresh',{env,service}),catalog=await tool('api_client_catalog',{env});
      if(env!==state.env||service!==state.group?.service)return notice('Refreshed '+service+' in '+env+'.');
      state.services=catalog.services;state.group=catalog.services.find(s=>s.service===service);
      setTargets(state.group,urlParts($('url').value).base);
      $('instances-status').textContent=`${r.instances.length} live instances · ${r.observedAt}. URL kept; choose a target to apply.`;
      notice('Live instances refreshed. Current URL kept. Select a refreshed service target before sending.');
      if(state.mode==='services')await refreshLibrary();
    }catch(e){$('instances-status').textContent='Refresh failed. Previous cached targets kept: '+e.message;throw e;}
  });
  let colRevision=null,colSavedId=null;
  async function openCollection(id){
    if(!canReplace())return;
    const epoch=selection.advance(),edit=edits.value;
    const r=id?await tool('collection_get',{collection:id}):{collection:'',description:'',vars:{}};
    if(!selection.current(epoch)||!edits.current(edit))return notice('Draft changed while loading collection settings. Open them again when ready.');
    hideOtherEditors();$('http-editor').hidden=$('workflow-editor').hidden=true;$('collection-editor').hidden=false;
    $('request-title').textContent=id?'Collection settings':'New collection';$('route').textContent='Persistent collection · variables, hooks and suite';
    $('col-id').value=r.collection;$('col-description').value=r.description||'';
    $('col-settings').value=JSON.stringify(Object.fromEntries(['vars','before','after','finally','suite'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])),null,2);
    colRevision=r.revision||null;colSavedId=id||null;$('col-delete').disabled=!id;dirty.value=false;
  }
  $('new-collection').onclick=()=>openCollection().catch(e=>notice(e.message,true));
  for(const id of ['col-id','col-description','col-settings'])$(id).oninput=changed;
  action($('col-save'),async()=>{
    const id=$('col-id').value.trim(),revision=edits.value,settings=parse('col-settings');
    for(const k of Object.keys(settings))if(!['vars','before','after','finally','suite'].includes(k))throw Error('Collection metadata supports vars, before, after, finally and suite.');
    const r=await tool('collection_save',{...settings,collection:id,description:$('col-description').value,expected_revision:id===colSavedId?colRevision:null});colSavedId=id;colRevision=r.revision;$('col-delete').disabled=false;if(edits.current(revision))dirty.value=false;await refreshLibrary();notice('Collection saved. No actions executed.');
  });
  action($('col-delete'),async()=>{
    if(!colSavedId)throw Error('Save the collection first.');
    if(!confirm('Delete '+colSavedId+' and all nested workflow definitions? Retained run reports stay available.'))return;
    await tool('collection_delete',{collection:colSavedId,expected_revision:colRevision,recursive:true});dirty.value=false;hideOtherEditors();$('http-editor').hidden=false;colSavedId=null;await refreshLibrary();notice('Collection deleted. Retained reports preserved.');
  });
  async function transferWorkflow(move){
    if(dirty.value)throw Error('Save your workflow before copying or moving it.');if(!wfSavedId)throw Error('Save the workflow first.');
    const r=await tool('script_transfer',{id:wfSavedId,to:$('wf-destination').value.trim(),expected_revision:wfRevision,move});
    const id=r.id||r.to;await openWorkflow(await tool('script_get',{id}));await refreshLibrary();notice(move?'Workflow moved. Review inherited collection settings.':'Workflow copied. Review inherited collection settings.');
  }
  action($('wf-duplicate'),()=>transferWorkflow(false));action($('wf-rename'),()=>transferWorkflow(true));
  action($('wf-delete'),async()=>{
    if(!wfSavedId)throw Error('Save the workflow first.');if(!confirm('Delete saved workflow '+wfSavedId+'? Retained reports are preserved.'))return;
    await tool('script_delete',{id:wfSavedId,expected_revision:wfRevision});dirty.value=false;await openWorkflow({description:'',steps:[W.create('http',state.env)]});await refreshLibrary();notice('Workflow deleted. Retained reports preserved.');
  });
  let sharedRecord=null;const sharedHeads=new Map();
  async function sharedLibrary(){
    const r=await tool('workflow_share',{action:'list'});sharedHeads.clear();$('shared-workflows').replaceChildren();
    $('wf-publish').disabled=!r.canPublish;$('wf-share-status').textContent=r.canPublish?'':'Administrator access is required to publish.';
    for(const row of r.workflows){sharedHeads.set(row.name,row.revision);const b=node('button',row.name,'route-item');b.title=row.description;b.onclick=()=>openShared(row.name,row.revision).catch(e=>notice(e.message,true));$('shared-workflows').append(b);}
    if(!r.workflows.length)$('shared-workflows').append(empty('Publish a workflow with a memorable name to share a reproducible definition.'));
  }
  async function openShared(name,revision){
    if(!canReplace())return;
    const epoch=selection.advance(),edit=edits.value,record=await tool('workflow_share',{action:'get',name,revision,include_definitions:true});if(!selection.current(epoch)||!edits.current(edit))return notice('Draft changed while loading the shared definition. Open it again when ready.');sharedRecord=record;hideOtherEditors();$('http-editor').hidden=$('workflow-editor').hidden=true;$('shared-preview').hidden=false;
    $('shared-title').textContent=name;$('shared-description').textContent=sharedRecord.definitions[sharedRecord.entry].description;
    $('shared-definition').textContent=JSON.stringify(sharedRecord,null,2);$('shared-prefix').value='shared/'+name;
    $('request-title').textContent='Shared workflow';$('route').textContent='Published '+sharedRecord.at+' · '+sharedRecord.revision.slice(0,12);dirty.value=false;
    const q=new URLSearchParams({shared:name,revision:sharedRecord.revision,story:scope.story});window.history.replaceState(null,'',location.pathname+'?'+q);notice('Shared definition loaded. Copy into your task to edit or run.');
  }
  action($('wf-publish'),async()=>{
    if(dirty.value)throw Error('Save the workflow before publishing its definition.');if(!wfSavedId)throw Error('Save the workflow first.');
    const name=$('wf-share-name').value.trim(),expected=sharedHeads.get(name)||null;
    if(!confirm('Publish '+name+' for everyone to read? Review scripts and hooks for embedded credentials.'))return;
    const r=await tool('workflow_share',{action:'publish',name,id:wfSavedId,expected_revision:expected});sharedHeads.set(name,r.revision);$('wf-share-link').href=r.url;$('wf-share-link').hidden=false;$('wf-share-status').textContent='Published revision '+r.revision.slice(0,12)+'. Link previews definitions; results stay private.';notice('Named workflow published. Share its link.');
  });
  action($('shared-copy-link'),async()=>{await navigator.clipboard.writeText(sharedRecord.url);notice('Named definition link copied. It contains no task or execution results.');});
  action($('shared-import'),async()=>{
    const r=await tool('workflow_share',{action:'import',name:sharedRecord.name,revision:sharedRecord.revision,prefix:$('shared-prefix').value.trim()});await openWorkflow(await tool('script_get',{id:r.id}));await refreshLibrary();notice('Workflow copied into your task. Review targets and parameters before running.');
  });
  let dbNext=null;const dbReads=new SM.Revision();
  async function databaseNames(){
    const env=$('db-env').value,epoch=dbReads.advance();$('db-name').disabled=true;
    try{const r=await tool('api_client_catalog',{env,resources:true});if(!dbReads.current(epoch))return;$('db-name').replaceChildren(...r.resources.databases.map(n=>new Option(n,n)));$('db-status').textContent=r.resources.databases.length?'Choose Browse schema. No live query has run.':'No databases configured in this environment.';$('db-objects').replaceChildren();dbNext=null;$('db-more').hidden=true;}
    finally{if(dbReads.current(epoch))$('db-name').disabled=false;}
  }
  $('inspect-database').onclick=()=>{$('db-inspector').open=true;$('db-env').focus();};
  $('db-env').onchange=()=>databaseNames().catch(e=>notice(e.message,true));
  $('db-name').onchange=()=>{dbReads.advance();$('db-objects').replaceChildren();$('db-more').hidden=true;$('db-status').textContent='Database changed. Browse schema to inspect it.';};
  $('db-search').oninput=()=>{dbReads.advance();dbNext=null;$('db-more').hidden=true;$('db-status').textContent='Search changed. Browse schema to update the list.';};
  async function browseDatabase(more=false){
    const epoch=dbReads.advance(),env=$('db-env').value,db=$('db-name').value;$('db-status').textContent='Reading cached schema…';
    try{const r=await tool('api_database_inspect',{env,db,q:$('db-search').value,offset:more?dbNext:0});if(!dbReads.current(epoch))return;
      const root=$('db-objects');if(!more)root.replaceChildren();
      for(const o of r.objects){const d=node('details'),summary=node('summary',o.name+' · '+o.kind);d.append(summary);
        if(o.columns){const table=node('table'),head=node('tr');head.append(node('th','Column'),node('th','Type'));table.append(head);for(const c of o.columns){const tr=node('tr');tr.append(node('td',c.name),node('td',c.type||c.data_type||''));table.append(tr);}d.append(table);}else d.append(node('pre',JSON.stringify({arguments:o.arguments,body:o.body},null,2)));
        if(o.sql){const b=node('button','Use SELECT query');b.onclick=()=>{$('db-sql').value=o.sql;$('db-params').value='[]';$('db-result').hidden=true;};d.append(b);}root.append(d);}
      dbNext=r.nextOffset;$('db-more').hidden=dbNext===null;$('db-status').textContent=r.gap||`${root.children.length} cached objects${dbNext!==null?' · more available':''}. SELECT drafts never execute automatically.`;
    }catch(e){if(dbReads.current(epoch))$('db-status').textContent='Inspection failed: '+e.message;throw e;}
  }
  action($('db-browse'),()=>browseDatabase());action($('db-more'),()=>browseDatabase(true));
  const dbArgs=()=>({env:$('db-env').value,db:$('db-name').value,sql:$('db-sql').value,params:W.value($('db-params').value,'array')});
  action($('db-run'),async()=>{const args=dbArgs();idleResult('workflow');$('response-content').hidden=$('response-empty').hidden=true;$('request-failure').hidden=true;$('db-query-result').hidden=false;$('result-title').textContent='Query results';$('db-target').textContent=args.env+' / '+args.db;$('db-view').hidden=true;$('db-output').textContent='Running read-only query…';$('db-result').hidden=false;$('db-result').textContent=args.env+' / '+args.db+' · Query running. Results appear in the right pane.';try{const r=await tool('pg_query',args);$('db-output').textContent=JSON.stringify(r,null,2);$('db-result').textContent=args.env+' / '+args.db+' · Query complete. Results in the right pane.';$('response-meta').textContent='Query complete';if(r.view){$('db-view').href=r.view;$('db-view').hidden=false;}notice('Query complete. Add it to a workflow to reproduce it.');}catch(e){$('db-output').textContent='Query failed: '+e.message;$('db-result').textContent='Query failed · '+args.env+' / '+args.db;$('response-meta').textContent='Query failed';throw e;}});
  action($('db-add'),async()=>{if(sending.value)throw Error('Wait for the active request or run.');const step={tool:'pg_query',args:dbArgs(),as:'queryResult'};if(!$('workflow-editor').hidden){wfPending();delete step.as;wf.steps.push(step);wfIndex=wf.steps.length-1;wfChange();renderWorkflowStep();}else{if(!canReplace())return;await openWorkflow({description:'Inspect database state',steps:[step]});changed();}notice('Query added. Save the workflow to keep this reproducible step.');});
  async function initialize() {
    await services(navigation.advance());
    $('db-env').replaceChildren(...[...$('apiEnvironment').options].map(o=>new Option(o.text,o.value)));$('db-env').value=state.env;await databaseNames();
    if(query.has('shared')){await openShared(query.get('shared'),query.get('revision'));$('source-collections').click();}
    else if(query.has('workflow')){await openWorkflow(await tool('script_get',{id:query.get('workflow')}));if(query.has('run')||query.has('job')){wfRun=query.get('run');wfJob=query.get('job');wfLife.to('running');wfLock(true);observeWorkflow();}}
    else if (query.has('exchange')) await openExchange(query.get('exchange'), true);
    else if (query.has('path') || query.has('url')) { const route = { method: query.get('method') || 'GET', path: query.get('path') || urlParts(query.get('url')).path, service: query.get('service') || '', ...(query.has('url') ? { url: query.get('url') } : {}) }; const group = state.services.find(s => s.service && s.service === route.service || s.key === 'host:' + query.get('host')); choose(route, group, query.get('base') || undefined); }
    else { bodyVisibility(); await authProfiles(); }
  }
  initialize().catch(e => { libraryStatus(e.message + ' Use Refresh to retry.', true); notice(e.message, true); });
})();
