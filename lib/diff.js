// Diffs, written to run anywhere: in dt, in the script sandbox (lib/js.js) and in view pages, so every
// function is self-contained (they are copied into those places with toString()).

// Two lists of strings or numbers -> only in first, common, only in last. Values compare as trimmed
// text ("42" = 42); options: ignoreCase, numeric ("007" = 7). Duplicates are counted, order is kept.
function diffLists(first, last, opts) {
  const o = opts || {};
  const toList = (x) => (Array.isArray(x) ? x : x == null ? [] : String(x).split(/[\r\n,;\t]+/)).map(v => (v && typeof v === 'object' ? JSON.stringify(v) : String(v).trim())).filter(v => v !== '');
  const key = (v) => {
    let k = o.ignoreCase ? v.toLowerCase() : v;
    if (o.numeric !== false && /^[+-]?\d+(\.\d+)?$/.test(k)) k = String(Number(k));
    return k;
  };
  const a = toList(first), b = toList(last);
  const inB = new Map(), inA = new Map();
  for (const v of b) inB.set(key(v), (inB.get(key(v)) || 0) + 1);
  for (const v of a) inA.set(key(v), (inA.get(key(v)) || 0) + 1);
  const seen = new Set();
  const onlyFirst = [], common = [], onlyLast = [], dupFirst = [], dupLast = [];
  for (const v of a) {
    const k = key(v);
    if (seen.has('a' + k)) { dupFirst.push(v); continue; }
    seen.add('a' + k);
    (inB.has(k) ? common : onlyFirst).push(v);
  }
  for (const v of b) {
    const k = key(v);
    if (seen.has('b' + k)) { dupLast.push(v); continue; }
    seen.add('b' + k);
    if (!inA.has(k)) onlyLast.push(v);
  }
  return {
    counts: { first: a.length, last: b.length, onlyFirst: onlyFirst.length, common: common.length, onlyLast: onlyLast.length, duplicatesFirst: dupFirst.length, duplicatesLast: dupLast.length },
    onlyFirst, common, onlyLast, duplicatesFirst: dupFirst, duplicatesLast: dupLast,
    same: onlyFirst.length === 0 && onlyLast.length === 0,
  };
}

// Two texts -> line diff: [{ op: ' ' | '-' | '+', text, a, b }] (a/b: line numbers), via LCS on lines.
// Common head and tail are trimmed first; past ~4M cells the middle is shown as removed + added.
function diffLines(first, last, opts) {
  const o = opts || {};
  const split = (t) => (t == null ? [] : String(t).replace(/\r\n/g, '\n').split('\n'));
  const A = split(first), B = split(last);
  const eq = (x, y) => (o.ignoreWhitespace ? x.replace(/\s+/g, ' ').trim() === y.replace(/\s+/g, ' ').trim() : x === y);
  let s = 0;
  while (s < A.length && s < B.length && eq(A[s], B[s])) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && eq(A[ea - 1], B[eb - 1])) { ea--; eb--; }
  const ops = [];
  for (let i = 0; i < s; i++) ops.push({ op: ' ', text: A[i], a: i + 1, b: i + 1 });
  const n = ea - s, m = eb - s;
  if (n * m > 4e6) {
    for (let i = s; i < ea; i++) ops.push({ op: '-', text: A[i], a: i + 1 });
    for (let j = s; j < eb; j++) ops.push({ op: '+', text: B[j], b: j + 1 });
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(A[s + i], B[s + j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && eq(A[s + i], B[s + j])) { ops.push({ op: ' ', text: A[s + i], a: s + i + 1, b: s + j + 1 }); i++; j++; }
      else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) { ops.push({ op: '-', text: A[s + i], a: s + i + 1 }); i++; } // removed before added
      else { ops.push({ op: '+', text: B[s + j], b: s + j + 1 }); j++; }
    }
  }
  for (let i = ea, j = eb; i < A.length; i++, j++) ops.push({ op: ' ', text: A[i], a: i + 1, b: j + 1 });
  const added = ops.filter(x => x.op === '+').length, removed = ops.filter(x => x.op === '-').length;
  return { ops, counts: { first: A.length, last: B.length, added, removed, same: ops.length - added - removed }, same: added === 0 && removed === 0 };
}

module.exports = { diffLists, diffLines };
