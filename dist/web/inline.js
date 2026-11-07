// Shared disclosure and file navigation for sandboxed views and the older result pages.
// No requests or parent DOM access: embedded views retain their existing sandbox.
const dtInline = {
  // Native disclosures remain usable without Popover support. In modern browsers the
  // panel enters the top layer so scroll containers cannot clip its controls.
  actions(root = document) {
    const menus = [...root.querySelectorAll('details.dt-more')];
    if (!menus.length) return;
    const states = new WeakMap(menus.map(menu => [menu, DTState.create(DTState.disclosureModel, menu.open ? 'open' : 'closed')]));
    let spacer;
    const close = (menu, focus = false) => {
      states.get(menu).to('closed');menu.open = false;
      if (focus) menu.querySelector('summary').focus();
    };
    const size = () => {
      if (spacer) spacer.style.height = '0px';
      let bottom = 0;
      for (const menu of menus.filter(m => m.open)) {
        const panel = menu.querySelector('.dt-more-panel');
        if (typeof panel.showPopover !== 'function' || !panel.matches(':popover-open')) continue;
        const anchor = menu.querySelector('summary').getBoundingClientRect();
        const embedded = document.body.classList.contains('embed');
        panel.style.maxHeight = embedded ? '360px' : `${Math.max(80, innerHeight - 24)}px`;
        const rect = panel.getBoundingClientRect();
        const left = Math.max(8, Math.min(anchor.right - rect.width, innerWidth - rect.width - 8));
        const top = embedded || anchor.bottom + rect.height + 8 <= innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - rect.height - 6);
        panel.style.left = `${left}px`; panel.style.top = `${top}px`;
        if (embedded) bottom = Math.max(bottom, top + rect.height + scrollY + 8);
      }
      if (bottom) {
        if (!spacer) { spacer = document.createElement('div'); spacer.className = 'dt-more-space'; spacer.setAttribute('aria-hidden', 'true'); document.body.append(spacer); }
        spacer.style.height = `${Math.max(0, bottom - (document.body.getBoundingClientRect().bottom + scrollY))}px`;
      }
    };
    for (const menu of menus) {
      const summary = menu.querySelector('summary'), panel = menu.querySelector('.dt-more-panel');
      const label = summary.getAttribute('aria-label') || 'More options';
      const update = () => {
        const active = [...panel.querySelectorAll('[data-default]')].filter(control => String(control.type === 'checkbox' ? control.checked : control.getAttribute('aria-pressed') ?? control.value) !== control.dataset.default).length;
        summary.dataset.active = active || '';
        summary.setAttribute('aria-label', label + (active ? ` (${active} active)` : ''));
        summary.title = summary.getAttribute('aria-label');
      };
      panel.addEventListener('change', update);
      panel.addEventListener('input', update);
      panel.addEventListener('click', event => {
        const button = event.target.closest('button, a[href]');
        if (button && !button.hasAttribute('data-keep-open')) close(menu, true);
        queueMicrotask(update);
      });
      menu.addEventListener('toggle', () => {
        states.get(menu).to(menu.open ? 'open' : 'closed');
        if (menu.open) for (const other of menus) if (other !== menu && other.open) close(other);
        if (typeof panel.showPopover === 'function') {
          panel.setAttribute('popover', 'manual');
          if (menu.open) panel.showPopover(); else panel.hidePopover();
          size();
        }
      });
      update();
    }
    document.addEventListener('click', event => {
      for (const menu of menus) if (menu.open && !menu.contains(event.target)) close(menu);
    });
    document.addEventListener('keydown', event => {
      const menu = menus.find(m => m.open);
      if (menu && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(menu, true); }
      if (menu && event.key === 'Tab') setTimeout(() => { if (!menu.contains(document.activeElement)) close(menu); }, 0);
    }, true);
    window.addEventListener('resize', size);
    document.addEventListener('scroll', event => {
      for (const menu of menus) if (menu.open && !menu.querySelector('.dt-more-panel').contains(event.target)) close(menu);
    }, true);
  },

  describe(view, data, meta = {}) {
    const d = data && typeof data === 'object' ? data : {}, c = d.counts || {};
    const failedCase = (Array.isArray(d.cases) ? d.cases : []).some(k => ['failed', 'error', 'cancelled'].includes(k.status) || k.equal === false);
    let failed = !!d.error || d.ok === false || ['failed', 'error', 'compile-error', 'timeout', 'cancelled'].includes(d.outcome || d.status);
    let summary = '';
    if (view === 'tests' || view === 'collection-report') {
      failed ||= failedCase || !!(c.failed || c.errors) || !!d.compile?.length || !!d.cleanupErrors?.length || (d.hooks || []).some(h => h.result?.ok === false);
      summary = `${c.passed || 0} passed · ${c.failed || 0} failed${c.errors ? ` · ${c.errors} ${c.errors === 1 ? 'error' : 'errors'}` : ''}${c.skipped ? ` · ${c.skipped} skipped` : ''}${d.ms != null ? ` · ${(d.ms / 1000).toFixed(1)} s` : ''}`;
      if (d.outcome === 'compile-error' || d.compile?.length) summary = 'Compilation failed · ' + summary;
    } else if (view === 'patch' || view === 'pr') {
      const files = d.files || [];
      summary = `${files.length} files · +${files.reduce((n, f) => n + (Number(f.added ?? f.add) || 0), 0)} −${files.reduce((n, f) => n + (Number(f.removed ?? f.del) || 0), 0)}`;
    } else if (view === 'code') {
      failed ||= (d.calls || []).some(k => k.ok === false);
      summary = `${failed ? 'Execution needs attention' : 'Completed'} · ${(d.calls || []).length} tool calls${d.ms != null ? ` · ${d.ms} ms` : ''}`;
    } else if (view === 'code-cell') {
      failed ||= !!d.result?.error || ['failed', 'cancelled', 'interrupted'].includes(d.state) || (d.result?.tests || []).some(test => !test.ok);
      summary = `${d.state || 'unknown'}${d.engine ? ' · ' + d.engine : ''} · ${(d.output || []).length} output events${d.result?.returned !== undefined ? ' · returned '+JSON.stringify(d.result.returned).slice(0,100) : ''}`;
    } else if (view === 'semantic-analysis') {
      const state = typeof d.job === 'object' ? d.job.state : d.state;
      failed ||= ['failed', 'interrupted'].includes(state);
      summary = [d.operation || (d.job ? 'Index job' : 'Semantic evidence'), state, d.mode, Array.isArray(d.results) ? `${d.results.length} results` : null, (d.gaps || []).length ? `${d.gaps.length} gaps` : null, d.truncated ? 'bounded page' : null].filter(Boolean).join(' · ');
    } else if (view === 'passport-ports') {
      summary = `${(d.ports || []).length} typed ports${(d.gaps || []).length ? ` · ${d.gaps.length} gaps` : ''}${d.revision ? ' · adjusted' : ''}`;
    } else if (view === 'project-context') {
      summary = `${(d.document?.services || []).length} services · ${(d.files || []).length} files · revision ${(d.revision || 'unpublished').slice(0,10)}`;
    } else if (view === 'api-exchange') {
      failed ||= (d.response?.status || 0) >= 400;
      summary = `${d.request?.method || 'HTTP'} · ${d.response?.status || 'No response'}${d.timing?.durationMs != null ? ` · ${d.timing.durationMs} ms` : ''}`;
    } else if (view === 'differential') {
      failed ||= failedCase || d.outcome === 'different';
      summary = `${c.equal || 0} / ${c.cases || 0} cases equal`;
    } else if (view === 'scenario-run') {
      const r = d.result || d;
      failed ||= r.ok === false || !!r.checks?.failed || !!r.violations?.length;
      summary = failed ? 'Checks need attention' : r.ok === true ? 'Stage passed' : 'Scenario evidence';
    } else if (view === 'table') summary = `${(Array.isArray(data) ? data : d.rows || []).length} rows`;
    else if (view === 'json') summary = Array.isArray(data) ? `${data.length} items` : data && typeof data === 'object' ? `${Object.keys(data).length} fields` : 'Result';
    else if (view === 'list-diff') summary = d.counts ? `${(c.onlyFirst || 0) + (c.onlyLast || 0)} differences` : 'Compare values';
    else if (view === 'text-diff') summary = 'Compare changes';
    return { title: meta.title || ({ code: 'JavaScript', 'code-cell': 'Code cell', 'semantic-analysis': 'Semantic analysis', 'passport-ports': 'Passport ports', tests: 'Test run', 'collection-report': d.collection || 'Collection suite', patch: `${d.repo || 'Workspace'} patch` })[view] || view.replace(/-/g, ' '), summary, open: failed || ['diagram', 'knowledge-map'].includes(view) || view === 'code-cell' && ['queued', 'running', 'cancelling', 'draining'].includes(d.state) || view === 'semantic-analysis' && ['paths', 'slice'].includes(d.operation) && !!d.results?.length, failed };
  },

  mount(target, { title = 'Tool result', summary = '', open = false, failed = false } = {}) {
    if (!document.body.classList.contains('embed') || !target) return;
    let shell = [...target.children].find(n => n.classList.contains('inline-result'));
    if (!shell) {
      shell = document.createElement('details'); shell.className = 'inline-result'; shell.open = open;
      const head = document.createElement('summary');
      const label = document.createElement('strong'); label.className = 'inline-title';
      const info = document.createElement('span'); info.className = 'inline-info';
      head.append(label, info); shell.append(head);
      const content = document.createElement('div'); content.className = 'inline-content';
      for (const node of [...target.childNodes]) if (!['SCRIPT', 'STYLE', 'ASIDE'].includes(node.nodeName)) content.append(node);
      shell.append(content); target.prepend(shell);
      // Preserve signed query parameters and file selection when opening the full result.
      if (/^https?:$/.test(location.protocol)) {
        const url = new URL(location.href); url.searchParams.delete('embed');
        const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'inline-full'; link.textContent = 'Open full view'; content.prepend(link);
        const meta = typeof META === 'object' ? META : {};
        const resultId = meta.id || url.pathname.match(/^\/show\/([a-z0-9]+)$/)?.[1];
        if (/^[a-z0-9]+$/.test(resultId || '')) {
          const next = document.createElement('a'); next.href = '/admin#workbench?' + new URLSearchParams({result:resultId,story:meta.story||'default'});next.target='_blank';next.rel='noopener noreferrer';next.className='inline-full';next.textContent='Continue in Workbench';content.prepend(next);
        }
        const legacyLink = target.querySelector('#openfull'); if (legacyLink) legacyLink.hidden = true;
      }
      shell.addEventListener('toggle', () => window.dispatchEvent(new Event('resize')));
    }
    shell.querySelector('.inline-title').textContent = title;
    shell.querySelector('.inline-info').textContent = summary;
    shell.classList.toggle('inline-failed', failed);
    // Repeated background refreshes update the summary without undoing the user's choice.
    return shell;
  },

  // Decode Git's quoted paths, including octal UTF-8, without treating names as markup.
  gitPath(value) {
    if (!value.startsWith('"')) return value.replace(/^[ab]\//, '');
    const bytes = [], enc = new TextEncoder(), s = value.slice(1, -1);
    for (let i = 0; i < s.length;) {
      if (s[i] === '\\') {
        const octal = s.slice(i + 1).match(/^[0-7]{1,3}/);
        if (octal) { bytes.push(parseInt(octal[0], 8)); i += octal[0].length + 1; }
        else { const k = s[++i]; bytes.push(...enc.encode(({t:'\t',n:'\n',r:'\r',b:'\b',f:'\f',v:'\v',a:'\x07'})[k] || k)); i++; }
      } else { const char = String.fromCodePoint(s.codePointAt(i)); bytes.push(...enc.encode(char)); i += char.length; }
    }
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/^[ab]\//, '');
  },
  patchFiles(patch, metadata = []) {
    const chunks = String(patch || '').split(/^(?=diff --git )/m).filter(ch => ch.startsWith('diff --git '));
    const parsed = chunks.map(ch => {
      const lines = ch.split('\n'), header = lines[0].match(/^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*"|b\/.*)$/);
      const newPath = lines.find(l => l.startsWith('+++ '))?.slice(4), oldPath = lines.find(l => l.startsWith('--- '))?.slice(4);
      const path = dtInline.gitPath(newPath && newPath !== '/dev/null' ? newPath : oldPath && oldPath !== '/dev/null' ? oldPath : header?.[2] || 'Unknown file');
      return { path, patch: ch, added: lines.filter(l => l.startsWith('+') && !l.startsWith('+++ ')).length, removed: lines.filter(l => l.startsWith('-') && !l.startsWith('--- ')).length };
    });
    const byPath = new Map(parsed.map(f => [f.path, f])), known = new Set(metadata.map(f => f.path));
    return [...metadata.map(f => ({ ...f, added: f.added ?? f.add, removed: f.removed ?? f.del, patch: byPath.get(f.path)?.patch || '' })), ...parsed.filter(f => !known.has(f.path))];
  },

  files(el, entries, render) {
    el.innerHTML = '<div class="file-layout"><nav class="file-nav" aria-label="Changed files"><label class="file-filter">Filter files<input type="search" placeholder="Path or filename" aria-label="Filter changed files"></label><div class="file-tree"></div></nav><section class="file-preview" aria-label="Selected file diff"></section></div>';
    const tree = el.querySelector('.file-tree'), panel = el.querySelector('.file-preview'), search = el.querySelector('input');
    const expanded = new Set(); const selection = new DTState.Selection(entries[0]);
    const ancestors = p => { const parts = p.split('/'); parts.pop(); for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/')); };
    if (selection.value) ancestors(selection.value.path);
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
    function draw() {
      const root = { dirs: new Map(), files: [] }, q = search.value.trim().toLowerCase();
      entries.forEach((f, index) => {
        if (q && !f.path.toLowerCase().includes(q)) return;
        const parts = f.path.split('/'); let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const key = parts.slice(0, i + 1).join('/');
          if (!node.dirs.has(key)) node.dirs.set(key, { name: parts[i], dirs: new Map(), files: [] });
          node = node.dirs.get(key);
        }
        node.files.push({ f, index, name: parts.at(-1) });
      });
      const html = node => [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, dir]) => `<details data-folder="${esc(path)}" ${q || expanded.has(path) ? 'open' : ''}><summary>${esc(dir.name)}</summary><div>${html(dir)}</div></details>`).join('') + node.files.sort((a,b) => a.name.localeCompare(b.name)).map(({f,index,name}) => `<button type="button" data-file="${index}" aria-current="${selection.value === f}" title="${esc(f.path)}"><span class="file-name">${esc(name)}</span><span class="file-count"><span class="file-added">+${Number(f.added)||0}</span> <span class="file-removed">−${Number(f.removed)||0}</span></span></button>`).join('');
      tree.innerHTML = html(root) || '<p class="empty">No matching files.</p>';
    }
    function select(f) {
      selection.value = f;
      if (f) ancestors(f.path);
      tree.querySelectorAll('button[data-file]').forEach(b => b.setAttribute('aria-current', String(entries[Number(b.dataset.file)] === f)));
      panel.innerHTML = f ? `<h3 class="file-path">${esc(f.path)}</h3><div class="file-body"></div>` : '<p class="empty">No changed files.</p>';
      if (f) render(panel.querySelector('.file-body'), f);
    }
    tree.addEventListener('toggle', e => { const p = e.target.dataset.folder; if (p !== undefined && !search.value) e.target.open ? expanded.add(p) : expanded.delete(p); }, true);
    tree.onclick = e => { const b = e.target.closest('button[data-file]'); if (b) select(entries[Number(b.dataset.file)]); };
    search.oninput = draw;
    draw(); select(selection.value);
    return { select(path) { const f = entries.find(f => f.path === path); if (!f) return; ancestors(f.path); draw(); select(f); } };
  },
};
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => dtInline.actions());

if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{let last;document.addEventListener('focusin',e=>{const n=e.target;if(n.matches('button,[role=button],a[href]'))last={node:n,id:n.id,data:JSON.stringify(n.dataset),text:n.textContent};});new MutationObserver(()=>{if(!last||last.node.isConnected||document.activeElement!==document.body)return;const n=[...document.querySelectorAll('button,[role=button],a[href]')].find(n=>last.id?n.id===last.id:last.data!=='{}'?JSON.stringify(n.dataset)===last.data:n.textContent===last.text);if(n){n.focus({preventScroll:true});last.node=n;}}).observe(document.body,{childList:true,subtree:true});});
