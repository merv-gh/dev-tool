// Required integration groups fail on skipped tests, not just test failures.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),files=process.argv.slice(2);if(!files.length)throw Error('Supply required test files');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt-required-')),report=path.join(dir,'events.jsonl');
try{
 const r=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=spec','--test-reporter='+path.join(__dirname,'coverage-reporter.cjs'),'--test-reporter-destination=stdout','--test-reporter-destination='+report,...files],{cwd:root,stdio:'inherit',env:process.env,timeout:40*60000});
 const events=fs.existsSync(report)?fs.readFileSync(report,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[],summary=events.filter(e=>e.type==='test:summary').at(-1)?.counts;
 if(r.status!==0||!summary||summary.skipped||summary.failed||summary.cancelled||!summary.passed)throw Error('Required tests failed, skipped, cancelled or produced no passing evidence');
 console.log(JSON.stringify({required:files,counts:summary}));
}catch(e){console.error(e.message);process.exitCode=1;}finally{fs.rmSync(dir,{recursive:true,force:true});}
