(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DTWorkflow = factory();
})(globalThis, function() {
  'use strict';
  const types = { http:'HTTP request', open:'Open UI page', browser:'UI action', pg_query:'Postgres query', es_search:'Elasticsearch query', kafka_checkpoint:'Kafka checkpoint', kafka_wait:'Kafka wait', kafka_produce:'Kafka produce', tool:'Other tool', script:'Saved script', set:'Set values', js:'JavaScript' };
  function kind(step) { return step.tool ? (Object.hasOwn(types, step.tool) ? step.tool : 'tool') : Object.keys(step).find(k => Object.hasOwn(types,k)) || 'advanced'; }
  function create(type, env) {
    if (type === 'http') return {http:'GET https://',as:'response'};
    if (type === 'open') return {open:'https://',as:'page'};
    if (type === 'browser') return {browser:'snapshot',args:{},as:'page'};
    if (type === 'script') return {script:'collection/name',params:{}};
    if (type === 'set') return {set:{orderId:'{{uuid}}'}};
    if (type === 'js') return {js:'return vars;',as:'result'};
    const presets = {pg_query:{db:'',sql:'select 1 as value',params:[]},es_search:{index:'',query:'',size:20},kafka_checkpoint:{topic:''},kafka_wait:{topic:'',checkpoint:'{{checkpoint}}',match:{'value.orderId':'{{orderId}}'},timeout_ms:30000},kafka_produce:{topic:'',partition:0,key:null,value:{orderId:'{{orderId}}'}}};
    return {tool:type === 'tool' ? '' : type,args:{env,...(presets[type] || {})},as:type === 'kafka_checkpoint' ? 'checkpoint' : 'result'};
  }
  function title(step) { return step.http || step.open || (step.browser ? 'UI · '+step.browser : step.tool ? step.tool : step.script ? 'Script · '+step.script : step.js !== undefined ? 'JavaScript' : step.set ? 'Set values' : 'Advanced step'); }
  function target(step) { return [step.args?.env,step.args?.db,step.args?.index,step.args?.topic].filter(Boolean).join(' / '); }
  function definition(script) { const {id,revision,savedAt,...body}=script; return structuredClone(body); }
  function selection(id) { const parts=String(id).split('/'); if(parts.length<2) throw Error('Use collection/name for this workflow.'); parts.pop(); return {collection:parts.join('/'),select:[id]}; }
  function value(text, type='object') {
    let result;
    try { result=JSON.parse(text); } catch { throw Error('Enter valid JSON. Whole-value templates must be quoted, for example "{{checkpoint}}".'); }
    if (typeof result === 'string' && /^\{\{[^{}]+\}\}$/.test(result)) return result;
    if (type === 'object' && (!result || typeof result !== 'object' || Array.isArray(result))) throw Error('Enter a JSON object.');
    if (type === 'array' && !Array.isArray(result)) throw Error('Enter a JSON array.');
    return result;
  }
  return {types,kind,create,title,target,definition,selection,value};
});
