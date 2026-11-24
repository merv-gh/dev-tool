/* Fixed-width graph navigation. Nodes are identities; edges retain distinct call sites. */
(function (root) {
  'use strict';
  function graph(nodes, edges) {
    const byId = new Map(nodes.map(n => [String(n.id), n])), byEdge = new Map(edges.map(e => [e.id, e])), incoming = new Map(), outgoing = new Map();
    for (const e of edges) {
      if (!byId.has(String(e.from)) || !byId.has(String(e.to))) continue;
      for (const [map, key] of [[incoming, e.to], [outgoing, e.from]]) { const id = String(key); if (!map.has(id)) map.set(id, []); map.get(id).push(e); }
    }
    const searchable = nodes.map(n => [n.label, n.kind, n.file, n.repo, n.field, n.table, n.id].filter(Boolean).join(' ').toLowerCase());
    return { nodes, edges, byId, byEdge, incoming, outgoing,
      search(query, offset = 0, limit = 25) { const terms = query.toLowerCase().trim().split(/\s+/), items = []; let total = 0; for (let i = 0; i < nodes.length; i++) if (terms.every(t => searchable[i].includes(t))) { if (total >= offset && items.length < limit) items.push(nodes[i]); total++; } return { items, total, next: offset + limit < total ? offset + limit : null }; }
    };
  }
  function pathGraph(path, metadata = {}) {
    const nodes = (path.nodes || []).map((n, i) => {
      const own = key => Object.prototype.hasOwnProperty.call(n, key);
      const sameSource = (!own('repo') || n.repo === metadata.repo) && (!own('sha') || n.sha === metadata.revision) && (!own('revision') || n.revision === metadata.revision);
      const node = { ...metadata, ...n, id: String(i), sourceNodeId: n.id, label: n.code || n.name || n.label || 'Unrecorded expression', kind: n.kind || n.label || 'Source step' };
      node.revision = own('revision') ? n.revision : own('sha') ? n.sha : sameSource ? metadata.revision : undefined;
      if (!sameSource) for (const key of ['revisionKey', 'analysis', 'workspace']) if (!own(key)) delete node[key];
      node.assumptions = [...n.assumptions || [], ...(path.conditions || []).filter(c => c.nodeId === n.id || (c.file === n.file && c.line === n.line)).map(c => c.expression + ' · ' + (c.polarity || 'unknown'))];
      return node;
    });
    return graph(nodes, nodes.slice(1).map((n, i) => ({ id: 'path:' + i, from: String(i), to: n.id, label: 'Retained static path · occurrence ' + (i + 1) })));
  }
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const button = (label, fn) => { const n = el('button', label); n.type = 'button'; n.addEventListener('click', fn); return n; };
  class Browser {
    constructor(host, { graph: model, initialId, onSource, sourceLink, onSelect, state } = {}) {
      this.host = host; this.graph = model; this.onSource = onSource; this.sourceLink = sourceLink; this.onSelect = onSelect; this.history = []; this.position = -1; this.query = ''; this.offset = 0; this.relations = {};
      host.classList.add('dt-path');
      this.toolbar = el('div', null, 'dt-path-toolbar'); this.back = button('Back', () => this.travel(-1)); this.forward = button('Forward', () => this.travel(1)); this.toolbar.append(this.back, this.forward);
      this.search = el('input'); this.search.type = 'search'; this.search.placeholder = 'Find a method, field, table or source'; this.search.setAttribute('aria-label', 'Find a path step'); this.toolbar.append(this.search);
      this.results = el('section', null, 'dt-path-results'); this.results.setAttribute('aria-label', 'Matching path steps');
      this.content = el('div', null, 'dt-path-content'); this.content.tabIndex = -1;
      host.replaceChildren(this.toolbar, this.results, this.content);
      this.search.addEventListener('input', () => { this.query = this.search.value; this.offset = 0; this.renderSearch(); });
      if (state?.history?.length) { this.history = state.history; this.position = state.position; this.restore(); }
      else this.focus(initialId ?? model.nodes[0]?.id);
    }
    snapshot() { return { history: this.history, position: this.position }; }
    capture() { if (this.history[this.position]) Object.assign(this.history[this.position], { scroll: this.content.scrollTop, query: this.query, offset: this.offset, relations: structuredClone(this.relations) }); }
    commit(state) { this.capture(); this.history.splice(this.position + 1); this.history.push(state); if (this.history.length > 200) this.history.shift(); this.position = this.history.length - 1; this.restore(); }
    focus(id, edge, selectedRoute) {
      id = String(id); if (!this.graph.byId.has(id)) return false;
      const previous = this.history[this.position], route = selectedRoute || (edge && previous ? [...previous.route, { id, edge: edge.id }].slice(-1000) : [{ id }]);
      this.commit({ id, edge, route, query: '', offset: 0, scroll: 0, relations: {} }); return true;
    }
    travel(direction) { if (!this.history[this.position + direction]) return; this.capture(); this.position += direction; this.restore(); }
    restore() {
      const state = this.history[this.position]; if (!state) { this.content.replaceChildren(el('p', 'No path steps available in this result.')); return; }
      this.query = state.query || ''; this.offset = state.offset || 0; this.relations = structuredClone(state.relations || {}); this.search.value = this.query;
      this.back.disabled = this.position === 0; this.forward.disabled = this.position === this.history.length - 1; this.renderSearch(); this.renderNode(state);
      this.content.scrollTop = state.scroll || 0; this.onSelect?.(this.graph.byId.get(state.id), state);
    }
    renderSearch() {
      this.results.replaceChildren(); this.results.hidden = !this.query.trim(); if (this.results.hidden) return;
      const r = this.graph.search(this.query, this.offset); this.results.append(el('p', `${r.total} matches · ${r.total ? this.offset + 1 : 0}–${Math.min(this.offset + 25, r.total)}`));
      const list = el('ul'); for (const n of r.items) { const li = el('li'), b = button(n.label, () => this.focus(n.id)); b.title = [n.repo, n.file, n.line].filter(Boolean).join(':'); li.append(b, el('small', [n.kind, n.file].filter(Boolean).join(' · '))); list.append(li); } this.results.append(list);
      const paging = el('div', null, 'dt-path-toolbar'); if (this.offset) paging.append(button('Previous matches', () => { this.offset = Math.max(0, this.offset - 25); this.renderSearch(); })); if (r.next !== null) paging.append(button('Next matches', () => { this.offset = r.next; this.renderSearch(); })); this.results.append(paging);
    }
    renderNode(state) {
      const n = this.graph.byId.get(state.id); this.content.replaceChildren(); if (!n) { this.content.append(el('p', 'This step is absent from the retained revision. Search for another step.')); return; }
      const route = el('details', null, 'dt-path-route'); route.append(el('summary', `Selected route · ${state.route.length === 1000 ? 'last ' : ''}${state.route.length} step${state.route.length === 1 ? '' : 's'}${state.route.length === 1 ? ' · no caller assumed' : ''}`));
      const routeList = el('ol'); for (const [i, step] of state.route.entries()) { const li = el('li'), b = button(this.graph.byId.get(step.id)?.label || step.id, () => this.focus(step.id, this.graph.byEdge.get(step.edge), state.route.slice(0, i + 1))); li.append(b); routeList.append(li); } route.append(routeList); this.content.append(route);
      this.content.append(el('p', n.kind || 'Step', 'dt-path-kind'), el('h3', n.label));
      const meta = el('p', [n.repo || 'Repository unrecorded', n.revision ? '@' + n.revision : 'Revision unrecorded', n.evidence || n.basis || 'Evidence not recorded', n.environment ? 'env ' + n.environment : '', n.execution ? 'execution ' + n.execution : 'No runtime execution', n.observedAt || ''].filter(Boolean).join(' · '), 'dt-path-meta'); this.content.append(meta);
      if (state.edge) this.content.append(el('p', `Selected connection: ${state.edge.label || state.edge.id}${state.edge.callSite ? ' · ' + state.edge.callSite : ''}`, 'dt-path-meta'));
      if (n.file || n.source) { const location = [n.file || n.source, n.line].filter(Boolean).join(':'); const row = el('div', null, 'dt-path-toolbar'); row.append(el('code', location)); if (this.onSource && n.file) row.append(button('Open source', () => this.onSource(n))); this.content.append(row); }
      if (this.sourceLink && n.file) { const source = this.sourceLink(n); if (source?.href) { const link = el('a', source.label || 'Prepare source read'); link.href = source.href; link.target = '_blank'; link.rel = 'noopener'; this.content.append(link, el('p', 'Opens a prepared read at the retained revision. Review arguments and Run there; this path stays selected.', 'dt-path-meta')); } else this.content.append(el('p', source?.reason || 'Exact source revision is unresolved.', 'dt-path-meta')); }
      if (n.code) { const peek = el('details'); peek.append(el('summary', 'Source peek'), el('pre', String(n.code).split('\n').slice(0, 12).join('\n'))); this.content.append(peek); }
      if (n.changes?.length || n.assumptions?.length || n.gap) { const details = el('details'); details.append(el('summary', `Changes & assumptions · ${(n.changes?.length || 0) + (n.assumptions?.length || 0) + (n.gap ? 1 : 0)}`)); const list = el('ul'); for (const item of [...n.changes || [], ...n.assumptions || [], ...n.gap ? [n.gap] : []]) list.append(el('li', item)); details.append(list); this.content.append(details); }
      const lists = el('div', null, 'dt-path-neighbors');
      for (const [label, edges, direction] of [['Callers / previous', this.graph.incoming.get(state.id) || [], 'from'], ['Callees / next', this.graph.outgoing.get(state.id) || [], 'to']]) {
        const section = el('section'); section.dataset.direction = direction; section.append(el('h4', label + ' · ' + edges.length));
        const rs = this.relations[direction] ||= { query: '', offset: 0 }, filter = el('input'); filter.type = 'search'; filter.placeholder = 'Filter connections or call sites'; filter.setAttribute('aria-label', 'Filter ' + label); filter.value = rs.query; const count = el('p', '', 'dt-path-meta'), list = el('ul'), paging = el('div', null, 'dt-path-toolbar');
        const prev = button('Previous 25', () => { rs.offset = Math.max(0, rs.offset - 25); update(); if (prev.disabled) next.focus(); }), next = button('Next 25', () => { rs.offset += 25; update(); if (next.disabled) prev.focus(); }); prev.setAttribute('aria-label', 'Previous ' + label); next.setAttribute('aria-label', 'Next ' + label); paging.append(prev, next);
        const update = () => {
          const terms = rs.query.toLowerCase().trim().split(/\s+/), matches = edges.filter(e => { const target = this.graph.byId.get(String(e[direction])); const text = [target?.label, target?.repo, target?.file, e.label, e.callSite, e.id].filter(Boolean).join(' ').toLowerCase(); return terms.every(t => text.includes(t)); });
          if (rs.offset >= matches.length) rs.offset = Math.max(0, Math.floor((matches.length - 1) / 25) * 25);
          list.replaceChildren(); for (const edge of matches.slice(rs.offset, rs.offset + 25)) { const target = this.graph.byId.get(String(edge[direction])), li = el('li'); li.append(button(target?.label || edge[direction], () => this.focus(edge[direction], edge)), el('small', [target?.kind, edge.label, edge.callSite, target?.repo].filter(Boolean).join(' · '))); list.append(li); }
          count.textContent = `${matches.length} matches · ${matches.length ? rs.offset + 1 : 0}–${Math.min(matches.length, rs.offset + 25)}`; prev.disabled = !rs.offset; next.disabled = rs.offset + 25 >= matches.length; paging.hidden = matches.length <= 25;
        };
        if (!edges.length) section.append(el('p', 'No retained connection. Absence is not proof of no connection.', 'dt-path-meta')); else { filter.addEventListener('input', () => { rs.query = filter.value; rs.offset = 0; update(); }); section.append(filter, count, list, paging); update(); } lists.append(section);
      }
      this.content.append(lists);
    }
    dispose() { this.host.replaceChildren(); }
  }
  const api = { graph, pathGraph, Browser };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DTPath = api;
})(globalThis);
