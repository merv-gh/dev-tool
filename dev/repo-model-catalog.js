// Build-time extraction of this repository's trusted executable lifecycle tables.
// Never evaluates code supplied by a repository/tool caller.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.join(__dirname, '..');
function generate({check = false} = {}) {
  const families = require('../docs/benchmarks/state-machine-runtime.json').families;
  const S = require('../lib/state-machine'), L = require('../lib/lifecycles');
  const charts = [['serviceEnvironment',require('../lib/service-env-worker').lifecycle],...Object.entries(L), ...Object.entries(S.models), ['automation', require('../lib/automation-flow').lifecycle], ['checkpoint', require('../lib/automation-flow').checkpointLifecycle], ['continuation', require('../lib/continuation').lifecycle], ['selection', require('../lib/continuation').selection], ['decoding', require('../web/map-format').decoding], ['atomic', require('../lib/atomic-file').model]];
  const files = require('../lib/source-version').files(root), texts = new Map(files.map(f => [f, fs.readFileSync(path.join(root,f),'utf8')]));
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const machines = charts.map(([key, chart]) => {
    const family = families.find(f => chart.name.startsWith(f.id + '.'));
    let source;
    for (const [file, text] of texts) {
      const at = text.indexOf("'" + chart.name + "'");
      if (at < 0) continue;
      const line = text.slice(0,at).split('\n').length;
      source = {file,line,sha256:hash(text),snippet:text.split('\n').slice(Math.max(0,line-2),line+14).join('\n').slice(0,4000)}; break;
    }
    // Shared helper models have a generated name, but a concrete declaration call.
    if (!source) throw Error('No source declaration for ' + chart.name);
    const consumers = [];
    if (Object.hasOwn(L,key)) for (const [file,text] of texts) {
      if(file==='lib/lifecycles.js')continue;
      const aliases = [...text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*require\(['"]\.\/lifecycles['"]\)/g)].map(m=>m[1]);
      const patterns = [new RegExp("require\\(['\"]\\./lifecycles['\"]\\)\\."+key+"\\b"), ...aliases.map(a=>new RegExp('\\b'+a+'\\.'+key+'\\b'))];
      text.split('\n').forEach((s,i)=>{if(patterns.some(p=>p.test(s)))consumers.push({file,line:i+1,snippet:s.trim().slice(0,400)});});
    }
    return {id:chart.name,component:family?.owners?.[0] || source.file,label:chart.name,origin:'executable-declaration',source,consumers,chart};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const value = {protocol:'dt.repo-source/v1',repo:'dev-tool',sourceDigest:require('../lib/source-version').digest(root),machines};
  const bytes=JSON.stringify(value,null,2)+'\n', file=path.join(root,'lib/self-model-catalog.json');
  if(check){if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==bytes)throw Error('Source model is stale: node dev/repo-model-catalog.js');}else if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==bytes)fs.writeFileSync(file,bytes);
  return value;
}
module.exports={generate};
if(require.main===module)console.log(generate({check:process.argv.includes('--check')}).machines.length+' source-backed lifecycle models');
