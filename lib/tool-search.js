// Discovery stays local and deterministic. The opt-in BM25 ranker matches words
// and discounts common terms; the default preserves historical substring scoring.
const STOP = new Set('a an and are as at be before but by can do does every for from get how i if in into is it its me my of on or our show that the their then these this through to use was we what when where which who why with without you your'.split(' '));
const cache = new Map();
// Everyday words for the direct tools. A query with one of these words lists its tools first, in this
// order, ahead of any keyword score: "query the orders table" finds pg_query, not a fixture planner.
// Extend by hand; names that are not enabled are skipped.
const INTENTS = [
  [/\b(check|is \S+ (ok|up|healthy)|smoke|doctor)\b/, ['checks', 'health', 'doctor']],
  [/\b(test data|fixtures?|capture data|extract data|seed data)\b/, ['checks', 'fixture_plan', 'test_data']],
  [/\b(suites?|collections?|regression|junit)\b/, ['collection_run', 'collection_plan', 'collection_report']],
  [/\b(scenarios?)\b/, ['scenario_run', 'scenario_inventory', 'scenario_package']],
  [/\b(capture traffic|ui traffic|har|replay)\b/, ['api_browser_open', 'api_exchange_list', 'api_request_replay']],
  [/\b(sql|select|postgres|pg|database|db|table|tables|rows?|column)\b/, ['pg_query', 'pg_table', 'find']],
  [/\b(deprecat\w*|migrat\w*|field trace|trace (a |the )?fields?|which fields)\b/, ['field_trace', 'pg_function', 'impact']],
  [/\b(who (uses|writes|reads)|usages?)\b/, ['pg_usage', 'who_uses']],
  [/\b(function|procedure|trigger)\b/, ['pg_function']],
  [/\b(elastic\w*|es|index|indices|documents?)\b/, ['es_search', 'find']],
  [/\b(kafka|topics?|messages?|events?)\b/, ['kafka_last', 'kafka_topic', 'kafka_lag']],
  [/\b(logs?|errors?|exceptions?|stack ?trace)\b/, ['logs_search', 'logs_trace']],
  [/\b(pr|prs|pull requests?|review|merge requests?)\b/, ['bitbucket_pr', 'bitbucket_prs', 'bitbucket_my_prs']],
  [/\b(files?|\w+\.(ya?ml|xml|properties|json|java|kt|sql|gradle|md)|config|source)\b/, ['bitbucket_file', 'bitbucket_files', 'code_read', 'code_search']],
  [/\b(repos?|repositor(y|ies)|bitbucket)\b/, ['bitbucket_repos', 'bitbucket_files', 'bitbucket_file']],
  [/\b(grep|code|class|method)\b/, ['code_search', 'code_symbols', 'code_read']],
  [/\b(health|status|down|broken)\b/, ['health', 'overview']],
  [/\b(docs?|confluence|wiki|feature|architecture)\b/, ['feature', 'docs_search', 'confluence_search']],
];
function intents(query, names) {
  const q = String(query || '').toLowerCase(), out = [];
  for (const [re, tools] of INTENTS) if (re.test(q)) for (const name of tools) if (names.has(name) && !out.includes(name)) out.push(name);
  return out;
}
function terms(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(w => !STOP.has(w)).map(w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w) || [];
}
// Keep the historical scoring byte-for-byte in behavior for existing installs.
function legacyRank(tools, query, group) {
  const words = query.toLowerCase().split(/[\s_:-]+/).filter(Boolean);
  return tools.filter(t => !group || t.group === group).map(t => { const name = t.name.toLowerCase(), text = `${name.replace(/_/g, ' ')} ${t.group} ${t.description}`.toLowerCase(); return { t, score: (name === query.toLowerCase() ? 1000 : 0) + words.reduce((n, w) => n + (text.includes(w) ? 20 : 0) + (name.includes(w) ? 3 : 0), 0) }; }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
}
function search(tools, query, group, ranker = 'bm25') {
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
  const matches = ranker === 'legacy' ? legacyRank(tools, query, group) : docs.map(d => {
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
  const exactName = selected.find(t => t.name.toLowerCase() === String(query).trim().toLowerCase())?.name;
  const first = [...(exactName ? [exactName] : []), ...intents(query, new Set(selected.map(t => t.name))).filter(n => n !== exactName)];
  if (first.length) {
    const rest = matches.filter(m => !first.includes(m.t.name)), top = Math.max(0, ...matches.map(m => m.score));
    matches.splice(0, matches.length, ...first.map((name, i) => ({ t: selected.find(t => t.name === name), score: Math.max(top, 1) + first.length - i })), ...rest);
  }
  const matched = words.filter(w => df.get(w) > 0), unmatched = words.filter(w => !df.get(w));
  const bounded = xs => xs.slice(0, 12).map(w => w.slice(0, 80));
  return { matches, lexical: { mode: 'normalized-keywords', ranker, matchedTerms: bounded(matched), unmatchedTerms: bounded(unmatched), truncated: matched.length > 12 || unmatched.length > 12 || words.some(w => w.length > 80) } };
}
const rank = (...args) => search(...args).matches;
module.exports = { rank, search, legacyRank, terms };
