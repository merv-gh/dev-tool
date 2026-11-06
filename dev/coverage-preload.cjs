// Loaded in actual node:test children (and their workers), never in production.
const fs=require('node:fs'),path=require('node:path'),{threadId}=require('node:worker_threads');
const root=path.resolve(__dirname,'..'), file=path.relative(root,process.argv[1]||'').split(path.sep).join('/');
if(process.env.DT_COVERAGE_DIR && /^test\/.+\.test\.js$/.test(file) && !['test/state-machine.test.js','test/coverage.test.js'].includes(file)) {
 const counts=new Map();
 require('../lib/state-machine').observe(event=>{
  if(!['transition','rejected'].includes(event.kind))return;
  const key=JSON.stringify([event.machine,event.from,event.to,event.kind]);counts.set(key,(counts.get(key)||0)+1);
 });
 process.once('exit',()=>{
  const rows=[...counts].map(([key,hits])=>{const [machine,from,to,kind]=JSON.parse(key);return{machine,from,to,kind,hits};});
  fs.mkdirSync(process.env.DT_COVERAGE_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.DT_COVERAGE_DIR,process.pid+'-'+threadId+'.json'),JSON.stringify({file,rows}));
 });
}
