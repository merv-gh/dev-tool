const fs=require('node:fs'),assert=require('node:assert/strict');
function check(report,baseline){
 assert.equal(report.run.scope,'full-suite','Coverage gate requires the full suite');assert.equal(report.run.exitCode,0);assert.equal(report.run.sourceDigest,require('../lib/source-version').digest(),'Coverage is stale');
 const major=v=>String(v).match(/^v?(\d+)/)?.[1],comparable=baseline.run.scope==='full-suite'&&major(report.run.node)===major(baseline.run.node)&&report.run.platform&&report.run.platform===baseline.run.platform;
 // Initial cross-platform floors are the retained full-suite baseline. Comparable
 // runs also ratchet upwards. Percentages apply to measured sources only.
 const floors={lines:91.7,functions:86.2,branches:81.3,transitions:53};
 for(const [key,floor]of Object.entries(floors)){const required=comparable?Math.max(floor,baseline.summary[key].percent):floor;assert.ok(report.summary[key].percent>=required,`${key}: ${report.summary[key].percent}% < ${required}%`);}
 if(comparable)assert.ok(report.summary.sourceFiles.unmeasured<=baseline.summary.sourceFiles.unmeasured,'Unmeasured file count grew');
 return {passed:true,comparableBaseline:!!comparable,summary:report.summary};
}
module.exports={check};if(require.main===module){try{console.log(JSON.stringify(check(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3]||'docs/benchmarks/test-coverage.json')))));}catch(e){console.error(e.message);process.exitCode=1;}}
