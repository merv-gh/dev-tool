// Every tool call, logged to cache/_calls.jsonl (the newest ~5000), and the patterns in it: the same call
// made again and again (with only some values changing), or the same sequence of tools. Each pattern
// comes with a ready script (steps + params) to save as a shortcut.
const fs = require('fs');
const path = require('path');
const { CACHE } = require('./util');

const FILE = path.join(CACHE, '_calls.jsonl');
const KEEP = 5000;
const SKIP = new Set(['call_history', 'call_patterns', 'script_list', 'script_get', 'script_save']); // looking around, not work
let appendedLines = 0, appendedBytes = 0;

const clipArgs = (v, n = 600) => {
  if (typeof v === 'string') return v.length > n ? `${v.slice(0, n)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => clipArgs(x, n));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 50).map(([k, x]) => [k, clipArgs(x, n)]));
  return v;
};

function record({ tool, args, source, ok, ms, error, size, steps, redactions = [] }) {
  if (SKIP.has(tool)) return;
  // the top-level steps with their times, the failed one with its error
  const st = (steps || []).filter(x => x.depth === 0 || !x.ok).slice(0, 30).map(x => ({ name: x.name, ms: x.ms, ...(x.ok ? {} : { error: x.error }) }));
  const evidence = require('./redact').clean({ args: args || {}, error, steps: st }, { known: redactions });
  const line = JSON.stringify({ at: new Date().toISOString(), tool, source: source || 'api', args: clipArgs(evidence.args), ok, ms, ...(error ? { error: String(evidence.error).slice(0, 600) } : {}), ...(size ? { size } : {}), ...(st.length ? { steps: evidence.steps } : {}) });
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, line + '\n');
    appendedBytes += line.length;
    if (++appendedLines >= 200 || appendedBytes > 1048576) { appendedLines = 0; appendedBytes = 0; trim(); }
  } catch {}
}

// at most KEEP calls and log.maxMb (default 50) megabytes: the oldest go first
function trim() {
  let maxMb = 50;
  try { maxMb = Number(process.env.DT_LOG_MAX_MB || require('./config').load().raw.log?.maxMb || 50); } catch {}
  const size = fs.statSync(FILE).size;
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
  let keep = lines.length > KEEP ? Math.floor(KEEP * 0.8) : lines.length;
  if (size > maxMb * 1048576) keep = Math.min(keep, Math.floor(lines.length * (maxMb * 1048576 * 0.8) / size));
  if (keep < lines.length) fs.writeFileSync(FILE, lines.slice(-keep).join('\n') + '\n');
}

function all() {
  let text = '';
  try { text = fs.readFileSync(FILE, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// newest first, filtered
function history({ q, tool, source, limit = 200 } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return all().reverse()
    .filter(c => (!tool || c.tool === tool) && (!source || c.source === source || (source === 'direct' && !c.source.startsWith('script:'))))
    .filter(c => !words.length || words.every(w => `${c.tool} ${c.source} ${JSON.stringify(c.args)}`.toLowerCase().includes(w)))
    .slice(0, limit);
}

// ── patterns ──
// Values inside strings that usually change between calls: uuids, numbers, quoted literals.
const SLOT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|'[^']*'|\b\d+\b/gi;
const shape = (v) => (typeof v === 'string' ? v.replace(SLOT, '\u0000') : JSON.stringify(v));
const slots = (v) => (typeof v === 'string' ? v.match(SLOT) || [] : []);
const unquote = (x) => (/^'.*'$/.test(x) ? x.slice(1, -1) : x);
const same = (xs) => xs.every(x => JSON.stringify(x) === JSON.stringify(xs[0]));

// Calls of one tool -> step args with {{params}} where the values differ, and the params with examples.
function generalize(calls, prefix = '') {
  const keys = [...new Set(calls.flatMap(c => Object.keys(c.args || {})))].sort();
  const args = {}, params = {};
  const name = (k, i) => `${prefix}${k}${i ? i + 1 : ''}`.replace(/[^\w]/g, '_');
  for (const k of keys) {
    const vals = calls.map(c => (c.args || {})[k]);
    if (vals.some(v => v === undefined)) { params[name(k)] = { description: `${k} (not always given)`, examples: [...new Set(vals.filter(v => v !== undefined).map(String))].slice(0, 3) }; args[k] = `{{${name(k)}}}`; continue; }
    if (same(vals)) { args[k] = vals[0]; continue; }
    if (vals.every(v => typeof v === 'string') && same(vals.map(shape)) && slots(vals[0]).length) {
      // same text with different literals: keep the text, the changing literals become params
      const per = vals.map(slots);
      let i = 0;
      const tpl = vals[0].replace(SLOT, (lit, off, whole) => {
        const j = i++;
        const at = per.map(p => p[j]);
        if (same(at)) return lit;
        // name it after what it is compared to ("id = 42" -> id), else after the argument
        const near = (whole.slice(0, off).match(/([a-z_][\w.]*)["'`]?\s*(?:=|<>|!=|>=|<=|>|<|:|\blike|\bin\s*\()\s*$/i) || [])[1];
        const nk = near && near.split('.').pop().replace(/[^\w]/g, '_');
        const p = nk && !params[nk] && !keys.includes(nk) ? nk : name(k, j);
        params[p] = { description: `${k}: changing value`, examples: [...new Set(at.map(unquote))].slice(0, 3) };
        return /^'/.test(lit) ? `'{{${p}}}'` : `{{${p}}}`;
      });
      args[k] = tpl;
      continue;
    }
    params[name(k)] = { description: k, examples: [...new Set(vals.map(v => (typeof v === 'string' ? v : JSON.stringify(v))))].slice(0, 3) };
    args[k] = `{{${name(k)}}}`;
  }
  return { args, params };
}

const direct = (cs) => cs.filter(c => c.ok !== false && !String(c.source).startsWith('script:') && !String(c.tool).startsWith('script_'));

// Split into work sessions: a gap of more than 15 minutes, or another client.
function sessions(cs) {
  const out = [];
  let cur = [];
  for (const c of cs) {
    const last = cur[cur.length - 1];
    if (last && (Date.parse(c.at) - Date.parse(last.at) > 15 * 60e3 || last.source !== c.source)) { out.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length) out.push(cur);
  return out;
}

function patterns({ min = 3, limit = 20 } = {}) {
  const cs = direct(all());
  const out = [];
  // 1) one call made again and again: same tool + same argument names
  const groups = new Map();
  for (const c of cs) {
    const k = `${c.tool}|${Object.keys(c.args || {}).sort().join(',')}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const g of groups.values()) {
    if (g.length < min) continue;
    const { args, params } = generalize(g);
    out.push({
      kind: 'repeat', count: g.length, last: g[g.length - 1].at, tools: [g[0].tool],
      summary: `${g[0].tool} called ${g.length}×${Object.keys(params).length ? `, changing only ${Object.keys(params).join(', ')}` : ' with the same arguments'}`,
      script: { description: `${g[0].tool} ${describe(args)}`.slice(0, 200), params: paramDefs(params), steps: [{ tool: g[0].tool, args, as: 'result' }] },
    });
  }
  // 2) the same sequence of tools (2-5 calls in a row), in several places
  const seqs = new Map();
  for (const s of sessions(cs)) {
    for (let n = 5; n >= 2; n--) {
      for (let i = 0; i + n <= s.length; i++) {
        const part = s.slice(i, i + n);
        if (part.some((c, j) => j && c.tool === part[j - 1].tool)) continue; // runs of one tool are "repeats"
        const k = part.map(c => c.tool).join(' → ');
        if (!seqs.has(k)) seqs.set(k, []);
        const list = seqs.get(k);
        const prev = list[list.length - 1];
        if (prev && prev.s === s && prev.i + n > i) continue; // no overlaps
        list.push({ s, i, part });
      }
    }
  }
  const seqOut = [];
  for (const [k, occ] of seqs) {
    if (occ.length < 2) continue;
    const n = occ[0].part.length;
    const steps = [], params = {};
    for (let j = 0; j < n; j++) {
      const g = generalize(occ.map(o => o.part[j]), `s${j + 1}_`);
      Object.assign(params, g.params);
      steps.push({ tool: occ[0].part[j].tool, args: g.args, as: `step${j + 1}` });
    }
    seqOut.push({
      kind: 'sequence', count: occ.length, last: occ[occ.length - 1].part[n - 1].at, tools: k.split(' → '),
      summary: `${k}: done ${occ.length}× in a row`,
      script: { description: `Runs ${k}`, params: paramDefs(params), steps },
    });
  }
  // drop sequences that are only part of a longer one seen as often
  // drop sequences that are only part of a longer one seen as often, or a shorter one done twice over
  const key = (x) => ` ${x.tools.join(' ')} `;
  for (const p of seqOut) {
    if (seqOut.some(q => q !== p && q.tools.length > p.tools.length && q.count >= p.count && key(q).includes(key(p)))) continue;
    // inside a sequence done twice over (q q), e.g. "read → search" between two "search → read"
    if (seqOut.some(q => q !== p && q.count >= p.count && ` ${[...q.tools, ...q.tools].join(' ')} `.includes(key(p)) && key(p) !== key(q))) continue;
    out.push(p);
  }
  return out.sort((a, b) => b.count * b.tools.length - a.count * a.tools.length || b.last.localeCompare(a.last)).slice(0, limit);
}

const describe = (args) => Object.entries(args).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' ');
const paramDefs = (params) => Object.fromEntries(Object.entries(params).map(([k, p]) => [k, { description: `${p.description}${p.examples.length ? `, e.g. ${p.examples.join(' / ')}` : ''}`.slice(0, 200), required: true }]));

module.exports = { record, history, patterns, generalize, FILE };
