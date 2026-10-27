// Helpers for view pages (web/views/*.html and custom views), as `dt`. The page gets the data as DATA
// and META (title, view, at). dt.diffLists / dt.diffLines are added from lib/diff.js when the page is built.
const dt = {
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  $: (sel, root) => (root || document).querySelector(sel),

  // a collapsible JSON tree; open: levels expanded at first
  json(el, value, { open = 2 } = {}) {
    const node = (v, depth, key) => {
      const k = key === undefined ? '' : `<span class="j-k">${dt.esc(key)}</span>: `;
      if (v === null || typeof v !== 'object') {
        const cls = v === null ? 'j-null' : typeof v === 'string' ? 'j-s' : typeof v === 'number' ? 'j-n' : 'j-b';
        return `<div class="j-l">${k}<span class="${cls}">${dt.esc(typeof v === 'string' ? JSON.stringify(v) : String(v))}</span></div>`;
      }
      const arr = Array.isArray(v), entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
      if (!entries.length) return `<div class="j-l">${k}<span class="j-p">${arr ? '[]' : '{}'}</span></div>`;
      return `<details class="j-d" ${depth < open ? 'open' : ''}><summary>${k}<span class="j-p">${arr ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>${entries.map(([kk, x]) => node(x, depth + 1, kk)).join('')}</details>`;
    };
    el.innerHTML = `<div class="j-tree">${node(value, 0)}</div>`;
  },

  prettyJson: (v) => { try { return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v, null, 2); } catch { return String(v); } },

  // XML: re-indent, then highlight
  prettyXml(text) {
    const parts = String(text).replace(/>\s*</g, '><').replace(/</g, '\n<').split('\n').filter(x => x.trim());
    let depth = 0;
    const out = [];
    for (const p of parts) {
      const t = p.trim();
      if (/^<\//.test(t)) depth = Math.max(0, depth - 1);
      out.push('  '.repeat(depth) + t);
      if (/^<[^!?/][^>]*[^/]>/.test(t) && !/<\/[^>]+>$/.test(t)) depth++;
    }
    return out.join('\n');
  },
  highlightXml: (text) => dt.esc(text)
    .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="x-t">$2</span>')
    .replace(/([\w:.-]+)=(&quot;[^&]*?&quot;)/g, '<span class="x-a">$1</span>=<span class="x-v">$2</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="x-c">$1</span>'),

  // rows (array of objects) as a table
  table(el, rows, { limit = 2000 } = {}) {
    const cols = [...new Set(rows.slice(0, 500).flatMap(r => Object.keys(r || {})))];
    const cell = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v ?? '');
    el.innerHTML = `<div class="card scroll"><table><thead><tr>${cols.map(c => `<th>${dt.esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, limit).map(r => `<tr>${cols.map(c => `<td>${dt.esc(cell(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length > limit ? `<p class="muted">${rows.length - limit} more rows</p>` : ''}`;
  },

  async copy(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = o; }, 900); }
  },

  title(t) { const h = document.querySelector('[data-title]'); if (h) h.textContent = t || META.title || META.view; document.title = t || META.title || META.view; },
};

// size the iframe in a chat (Open WebUI); only report changes
window.addEventListener('DOMContentLoaded', () => {
  let last = 0;
  const post = () => { const h = Math.ceil(document.body.getBoundingClientRect().height); if (h !== last && parent !== window) { last = h; parent.postMessage({ type: 'iframe:height', height: h }, '*'); } };
  new ResizeObserver(post).observe(document.body);
});
