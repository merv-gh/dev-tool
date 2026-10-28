// Storage XHTML is data. This small non-validating tree reader never evaluates markup, DTDs or entities.
const crypto = require('crypto');
const hash = (s) => crypto.createHash('sha256').update(Buffer.isBuffer(s) ? s : String(s)).digest('hex');
const decode = (s) => String(s || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, k) => {
  if (k[0] === '#') { const n = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all; }
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[k.toLowerCase()];
});
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function tree(source) {
  const root = { tag: 'root', children: [], start: 0, end: source.length }, stack = [root];
  const re = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g;
  for (const m of source.matchAll(re)) {
    const s = m[0], parent = stack.at(-1);
    if (s.startsWith('<![CDATA[')) { parent.children.push({ text: s.slice(9, -3), cdata: true, start: m.index, end: m.index + s.length }); continue; }
    if (/^<!|^<\?/.test(s)) continue;
    if (s.startsWith('</')) {
      const tag = s.match(/^<\/\s*([^\s>]+)/)?.[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { for (const n of stack.splice(i)) n.end = m.index + s.length; break; }
    } else if (s.startsWith('<')) {
      const tag = s.match(/^<\s*([^\s/>]+)/)?.[1].toLowerCase();
      if (!tag) continue;
      const attrs = Object.create(null);
      for (const a of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3]);
      const n = { tag, attrs, children: [], start: m.index, end: m.index + s.length };
      parent.children.push(n);
      if (!/\/$/.test(s.slice(0, -1)) && !['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag)) stack.push(n);
    } else parent.children.push({ text: decode(s), start: m.index, end: m.index + s.length });
  }
  return root;
}
const all = (n, tag) => [ ...(n.tag === tag ? [n] : []), ...(n.children || []).flatMap(c => all(c, tag)) ];
function text(n) {
  if (n.text !== undefined) return n.text;
  if (n.tag === 'br') return '\n';
  if (n.tag === 'ri:page') return n.attrs['ri:content-title'] || '';
  return (n.children || []).map(text).join('');
}
function sentences(s) { return s.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map(x => x.trim()).filter(Boolean) || (s ? [s] : []); }

function parse(page, previous = []) {
  const source = page.storage || page.body?.storage?.value || '', doc = tree(source), blocks = [], links = [], images = [], headings = [];
  const reusable = new Map();
  let next = 0, offset = 0;
  for (const b of previous) { const k = `${b.kind}|${b.text}`; if (!reusable.has(k)) reusable.set(k, []); reusable.get(k).push(b.id); next = Math.max(next, Number(b.id.match(/\.b(\d+)/)?.[1] || 0)); }
  const add = (kind, value, n, extra = {}) => {
    const valueText = kind === 'code' || kind === 'diagram' ? String(value).trim() : clean(value);
    if (!valueText) return;
    const id = reusable.get(`${kind}|${valueText}`)?.shift() || `p${page.id}.b${++next}-${hash(valueText).slice(0, 10)}`;
    const block = { id, pageId: String(page.id), version: page.version, kind, path: [...headings].filter(Boolean), text: valueText, start: offset, end: offset + valueText.length, storageStart: n.start, storageEnd: n.end, ...extra };
    blocks.push(block); offset = block.end + 1;
  };
  const walk = (n) => {
    if (!n.tag) return;
    if (/^h[1-6]$/.test(n.tag)) { const level = Number(n.tag[1]); headings.splice(level - 1); headings[level - 1] = clean(text(n)); add('heading', text(n), n, { level }); return; }
    if (n.tag === 'ac:structured-macro') {
      const name = n.attrs['ac:name'] || '';
      const params = Object.fromEntries(all(n, 'ac:parameter').map(p => [p.attrs['ac:name'], text(p)]));
      const body = all(n, 'ac:plain-text-body').map(text).join('\n');
      if (/^(code|noformat)$/.test(name)) { add('code', body, n, { language: params.language || '' }); return; }
      if (/plantuml|mermaid|drawio|draw\.io|gliffy/i.test(name)) { add('diagram', body || params.diagramName || params.name || name, n, { format: /plantuml/i.test(name) ? 'plantuml' : /mermaid/i.test(name) ? 'mermaid' : /gliffy/i.test(name) ? 'gliffy' : 'drawio', parameters: params }); return; }
      if (name === 'jira') { add('issue', params.key || params.jqlQuery || '', n, { issue: params.key }); return; }
    }
    if (n.tag === 'table') {
      const rows = all(n, 'tr'), headers = (rows.find(r => r.children.some(c => c.tag === 'th'))?.children || []).filter(c => /^(td|th)$/.test(c.tag)).map(c => clean(text(c)));
      for (const row of rows) { const cells = row.children.filter(c => /^(td|th)$/.test(c.tag)); if (cells.length && !cells.every(c => c.tag === 'th')) add('table-row', cells.map((c, i) => `${headers[i] || `Column ${i + 1}`}: ${clean(text(c))}`).join(' | '), row, { headers }); }
      return;
    }
    if (n.tag === 'ac:image') {
      const file = all(n, 'ri:attachment')[0]?.attrs['ri:filename'];
      const caption = clean(all(n, 'ac:caption').map(text).join(' ') || n.attrs['ac:title'] || n.attrs['ac:alt'] || '');
      images.push({ filename: file, caption, path: [...headings].filter(Boolean) });
      add('image', [file, caption].filter(Boolean).join(': '), n, { filename: file, caption }); return;
    }
    if (n.tag === 'p' || n.tag === 'li' || n.tag === 'pre') {
      const direct = { ...n, children: n.children.filter(c => !['ul', 'ol', 'table', 'ac:structured-macro'].includes(c.tag)) };
      add(n.tag === 'li' ? 'list-item' : n.tag === 'pre' ? 'code' : 'paragraph', text(direct), n);
      for (const c of n.children) if (['ul', 'ol', 'table', 'ac:structured-macro', 'ac:image'].includes(c.tag)) walk(c);
      return;
    }
    for (const c of n.children || []) walk(c);
  };
  walk(doc);
  for (const n of all(doc, 'ri:page')) links.push({ title: n.attrs['ri:content-title'], space: n.attrs['ri:space-key'] || page.space, id: n.attrs['ri:content-id'], blockId: blocks.find(b => b.storageStart <= n.start && b.storageEnd >= n.end)?.id });
  return { blocks, links, images, text: blocks.map(b => b.text).join('\n') };
}

module.exports = { parse, tree, text, all, decode, clean, hash, sentences };
