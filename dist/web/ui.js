// Shared helpers for dt pages: escaping, copy, toast, chat-embed sizing, data loading.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qs = new URLSearchParams(location.search);
const embed = qs.has('embed');
if (embed) document.body.classList.add('embed');

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); t.setAttribute('aria-live','polite'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 5000);
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast(`Copied ${what}`);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// In a chat (Open WebUI) the page sizes its iframe; only report changes to avoid a resize loop.
let lastHeight = 0;
function postHeight() {
  if (!embed || parent === window) return;
  const h = Math.ceil(document.body.getBoundingClientRect().height);
  if (h !== lastHeight) { lastHeight = h; parent.postMessage({ type: 'iframe:height', height: h }, '*'); }
}
new ResizeObserver(postHeight).observe(document.body);

// /<page>/<id> -> /api/result/<id>
async function loadResult() {
  const id = location.pathname.split('/').filter(Boolean)[1];
  const r = await fetch(`/api/result/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}
function fail(e) { document.querySelector('.wrap').innerHTML = `<div class="empty">${esc(e.message || e)}. Results are kept for the latest 500 runs.</div>`; postHeight(); }

const fmtTime = (t, ms = true) => { const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleTimeString([], { hour12: false }) + (ms ? '.' + String(d.getMilliseconds()).padStart(3, '0') : ''); };
const fmtDate = (t) => { const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString([], { hour12: false }); };
const levelVar = (l) => /ERR|FATAL|SEVERE/.test(l || '') ? 'error' : /WARN/.test(l || '') ? 'warn' : /INFO/.test(l || '') ? 'info' : /DEBUG|TRACE/.test(l || '') ? 'debug' : 'other';

// Preserve keyboard selection when a result redraw replaces its focused button.
function dtKeepKeyboardFocus(root=document){let previous=null;root.addEventListener('focusin',e=>{const n=e.target;if(n.matches('button,a,[role=button],[tabindex]'))previous={node:n,id:n.id,data:JSON.stringify(n.dataset),label:n.getAttribute('aria-label'),text:n.textContent};});new MutationObserver(()=>{if(!previous||previous.node.isConnected||document.activeElement!==document.body)return;const nodes=[...root.querySelectorAll('button,a,[role=button],[tabindex]')],n=nodes.find(n=>previous.id?n.id===previous.id:previous.data!=='{}'?JSON.stringify(n.dataset)===previous.data:previous.label?n.getAttribute('aria-label')===previous.label:n.textContent===previous.text);if(n){n.focus({preventScroll:true});previous.node=n;}}).observe(root===document?document.body:root,{subtree:true,childList:true});}
document.addEventListener('DOMContentLoaded',()=>dtKeepKeyboardFocus());
