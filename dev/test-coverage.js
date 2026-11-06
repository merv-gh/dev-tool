// Run real tests once with V8 coverage plus transition observation, then publish
// an atomic, portable report. Failed/skipped tests never become passing evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'dt-coverage-'));
const output=process.env.DT_COVERAGE_OUTPUT||path.join(root,'docs/benchmarks/test-coverage.json');
const files=process.argv.slice(2),selected=files.length?files:fs.readdirSync(path.join(root,'test')).filter(f=>f.endsWith('.test.js')).sort().map(f=>'test/'+f);
const sourceDigest=require('../lib/source-version').digest();
const args=['--require',path.join(__dirname,'coverage-preload.cjs'),'--test','--test-concurrency=6','--experimental-test-coverage','--test-coverage-include=lib/**','--test-coverage-include=web/**','--test-coverage-include=server.js','--test-coverage-include=cli.js','--test-coverage-exclude=web/vendor/**',
 '--test-reporter=spec','--test-reporter='+path.join(__dirname,'coverage-reporter.cjs'),'--test-reporter=lcov','--test-reporter-destination=stdout','--test-reporter-destination='+path.join(scratch,'events.jsonl'),'--test-reporter-destination='+path.join(scratch,'coverage.lcov'),...selected];
try{
 const result=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,DT_COVERAGE_DIR:path.join(scratch,'transitions')},stdio:'inherit',timeout:30*60000});
 const C=require('../lib/coverage'),tests=fs.readFileSync(path.join(scratch,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const rows=fs.existsSync(path.join(scratch,'transitions'))?fs.readdirSync(path.join(scratch,'transitions')).flatMap(file=>{const r=JSON.parse(fs.readFileSync(path.join(scratch,'transitions',file)));return r.rows.map(row=>({...row,file:r.file}));}):[];
 const sourceFiles=C.lcov(fs.readFileSync(path.join(scratch,'coverage.lcov'),'utf8'),root),loaded=new Set(sourceFiles.map(f=>f.path));
 for(const file of require('../lib/source-version').files(root).filter(f=>f.endsWith('.js')))if(!loaded.has(file))sourceFiles.push({path:file,instrumented:false,lines:{hit:0,total:0,percent:null},functions:{hit:0,total:0,percent:null},branches:{hit:0,total:0,percent:null},uncoveredLines:[]});
 sourceFiles.sort((a,b)=>a.path.localeCompare(b.path));
 const report=C.aggregate({rows,tests,sourceFiles,run:{sourceDigest,command:'npm run test:coverage'+(files.length?' -- '+files.join(' '):''),scope:files.length?'selected-files':'full-suite',exitCode:result.status??-1,node:process.version,counts:tests.filter(t=>t.type==='test:summary').at(-1)?.counts}});
 report.summary.sourceFiles={measured:loaded.size,unmeasured:sourceFiles.length-loaded.size,total:sourceFiles.length};
 report.limits.push('V8 percentages describe measured sources only. Never-loaded sources are explicitly listed as unmeasured.');
 require('../lib/atomic-file').atomicFile(output,JSON.stringify(report)+'\n');
 console.log(JSON.stringify({coverage:path.relative(root,output),summary:report.summary,exitCode:result.status}));
 process.exitCode=result.status??1;
}catch(error){console.error(error.message);process.exitCode=1;}finally{fs.rmSync(scratch,{recursive:true,force:true});}
