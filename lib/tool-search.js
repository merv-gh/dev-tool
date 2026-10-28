// Capability discovery stays local and deterministic. Match words, not arbitrary
// substrings ("in" used to match almost every tool), and discount common words.
const STOP = new Set('a an and are as at be before but by can do does every for from get how i if in into is it its me my of on or our show that the their then these this through to use was we what when where which who why with without you your'.split(' '));
const cache = new Map();
function terms(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(w => !STOP.has(w)).map(w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w) || [];
}
function search(tools, query, group) {
  const activeNames = new Set(tools.map(t => t.name));
  for (const name of cache.keys()) if (!activeNames.has(name)) cache.delete(name);
  const selected = tools.filter(t => !group || t.group === group);
  const words = [...new Set(terms(query))];
  const docs = selected.map(t => {
    let saved = cache.get(t.name);
    if (!saved || saved.description !== t.description || saved.group !== t.group) {
      const text = terms(`${t.name} ${t.group} ${t.description}`), frequencies = new Map();
      for (const word of text) frequencies.set(word, (frequencies.get(word) || 0) + 1);
      saved = { description: t.description, group: t.group, frequencies, length: text.length }; cache.set(t.name, saved);
    }
    return { t, ...saved };
  });
  const df = new Map(words.map(w => [w, docs.filter(d => d.frequencies.has(w)).length]));
  const avgLength = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  const matches = docs.map(d => {
    const exact = d.t.name.toLowerCase() === query.trim().toLowerCase();
    let score = exact ? 1000 : 0;
    for (const word of words) {
      const tf = d.frequencies.get(word) || 0;
      if (!tf) continue;
      const frequency = df.get(word), idf = Math.log(1 + (docs.length - frequency + .5) / (frequency + .5));
      score += idf * (tf * 2.2) / (tf + 1.2 * (.25 + .75 * d.length / (avgLength || 1)));
    }
    return { t: d.t, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  const matched = words.filter(w => df.get(w) > 0), unmatched = words.filter(w => !df.get(w));
  const bounded = xs => xs.slice(0, 12).map(w => w.slice(0, 80));
  return { matches, lexical: { mode: 'normalized-keywords', matchedTerms: bounded(matched), unmatchedTerms: bounded(unmatched), truncated: matched.length > 12 || unmatched.length > 12 || words.some(w => w.length > 80) } };
}
const rank = (...args) => search(...args).matches;
module.exports = { rank, search, terms };
