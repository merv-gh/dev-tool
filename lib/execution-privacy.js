// Runtime secrets belong to selected execution configuration, not model arguments.
const fs = require('fs'), path = require('path');
function secrets(cfg, execution) {
  return [...new Set([...Object.values(cfg.env || {}), ...Object.values(execution.env || {})].flatMap(v => { const s=String(v); return [s,...s.split(/\r?\n/).filter(line=>line.length>=3)]; }).filter(Boolean))];
}
const structural = new Set(['passed','failed','error','skipped','returned','threw','timeout','compile-error','no-tests-ran','all-tests-skipped','cleanup-failed','different','equivalent']);
const tags = new Set(['undefined','bigint','number','regexp','date','bytes','map','set','array','object']);
function clean(value, mask) {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map(v => clean(v, mask));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [mask(k), ((k === 'status' || k === 'outcome') && structural.has(v)) || (k === '$dtType' && tags.has(v)) ? v : clean(v, mask)]));
}
function reports(files, known) {
  const xml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const variants = [...new Set(known.flatMap(s => [s, JSON.stringify(s).slice(1,-1), xml(s), xml(s).replace(/\n/g,'&#10;').replace(/\r/g,'&#13;').replace(/\t/g,'&#9;')]))].filter(Boolean);
  for (const file of files) {
    let st; try { st=fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (!st.isFile()) throw new Error('test report must be a regular file');
    let text=fs.readFileSync(file,'utf8'), clean=text;
    for (const s of variants.sort((a,b)=>b.length-a.length)) clean=clean.split(s).join('***');
    if (clean!==text) fs.writeFileSync(file,clean,{mode:st.mode});
  }
}
function filesIn(dirs) { return dirs.flatMap(dir => { try { return fs.readdirSync(dir).filter(f=>/^TEST-.*\.(xml|json|jsonl)$/.test(f)).map(f=>path.join(dir,f)); } catch (e) { if(e.code==='ENOENT')return[];throw e; } }); }
module.exports={secrets,clean,reports,filesIn};
