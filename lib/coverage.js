// Reproducible evidence, not a claim that an executed line/edge was asserted.
const fs=require('node:fs'),path=require('node:path');
const catalog=require('../docs/benchmarks/state-machine-runtime.json');
const pct=(hit,total)=>total?Math.round(hit/total*1000)/10:null;
function lcov(text,root){const files=[];for(const block of text.split('end_of_record')){let name,lines=[],functions=[],branches=[];for(const line of block.split('\n')){
 const [tag,...rest]=line.split(':');const v=rest.join(':');if(tag==='SF'){name=path.relative(root,path.resolve(root,v)).split(path.sep).join('/');}
 if(tag==='DA'){const [at,hits]=v.split(',');lines.push({line:+at,hits:+hits});}
 if(tag==='FNDA'){const [hits,...name]=v.split(',');functions.push({name:name.join(','),hits:+hits});}
 if(tag==='BRDA'){const [at,block,branch,hits]=v.split(',');branches.push({line:+at,block,branch,hits:hits==='-'?0:+hits});}
 }if(!name||name.startsWith('../')||!(/^(lib|web)\//.test(name)||['server.js','cli.js'].includes(name))||name.startsWith('web/vendor/'))continue;
 const summary=rows=>({hit:rows.filter(r=>r.hits>0).length,total:rows.length,percent:pct(rows.filter(r=>r.hits>0).length,rows.length)});
 files.push({path:name,instrumented:true,lines:summary(lines),functions:summary(functions),branches:summary(branches),lineHits:lines.map(r=>[r.line,r.hits]),uncoveredLines:lines.filter(r=>!r.hits).map(r=>r.line)});
 }return files.sort((a,b)=>a.path.localeCompare(b.path));}
function aggregate({rows=[],tests=[],sourceFiles=[],run={}}){
 const outcomes=new Map();for(const test of tests){if(!['test:pass','test:fail'].includes(test.type)||!test.name)continue;if(!test.file||!test.file.startsWith('test/'))continue;const prev=outcomes.get(test.file)||{passed:0,failed:0,skipped:0,cases:[]};if(test.type==='test:fail')prev.failed++;else if(test.skip)prev.skipped++;else prev.passed++;prev.cases.push({name:test.name,line:test.line,status:test.type==='test:fail'?'failed':test.skip?'skipped':'passed'});outcomes.set(test.file,prev);}
 const machines=catalog.charts.map(chart=>{const observations=rows.filter(row=>row.machine===chart.name),edges=Object.entries(chart.transitions).flatMap(([from,targets])=>targets.filter(to=>to!==from).map(to=>{
  const matching=observations.filter(row=>row.from===from&&row.to===to&&row.kind==='transition');
  const evidence=[...new Set(matching.map(row=>row.file))].sort().map(file=>({file,hits:matching.filter(row=>row.file===file).reduce((n,row)=>n+row.hits,0),verified:!!outcomes.get(file)?.passed&&!outcomes.get(file)?.failed}));
  return{from,to,hits:matching.reduce((n,r)=>n+r.hits,0),covered:evidence.some(e=>e.verified),evidence};}));
  const rejections=observations.filter(row=>row.kind==='rejected').map(({file,from,to,hits})=>({file,from,to,hits,verified:!!outcomes.get(file)?.passed&&!outcomes.get(file)?.failed}));
  return{name:chart.name,initial:chart.initial,terminal:chart.terminal,states:chart.states,edges,rejections,covered:edges.filter(e=>e.covered).length,total:edges.length,percent:pct(edges.filter(e=>e.covered).length,edges.length)};
 });
 const total=machines.reduce((n,m)=>n+m.total,0),covered=machines.reduce((n,m)=>n+m.covered,0),sum=key=>{const hit=sourceFiles.reduce((n,f)=>n+f[key].hit,0),total=sourceFiles.reduce((n,f)=>n+f[key].total,0);return{hit,total,percent:pct(hit,total)};};
 return{protocol:'dt.coverage/v1',generatedAt:new Date().toISOString(),run,meaning:'Actual transitions and V8 source execution. Transition evidence is attributed to a test file, not an individual assertion. Failed files do not establish verified coverage. Model-vocabulary tests and this report generator are excluded from transition evidence.',
 summary:{transitions:{hit:covered,total,percent:pct(covered,total)},lines:sum('lines'),functions:sum('functions'),branches:sum('branches'),testedFiles:outcomes.size},machines,files:sourceFiles,testFiles:[...outcomes].map(([file,data])=>({file,...data})),families:catalog.families,limits:['Node coverage does not exercise browser-only controllers; browser checks are separate evidence.','Related tests in the original audit are not counted unless an actual transition was observed.','A covered transition does not prove every guard, race, input or failure case.']};
}
function source(file){
 const report=current(),entry=report.files?.find(item=>item.path===file);
 if(!entry||!(/^(lib|web)\/[a-zA-Z0-9_./-]+\.js$/.test(file)||['server.js','cli.js'].includes(file))||file.split('/').includes('..'))throw Object.assign(Error('Source is not in the coverage report'),{statusCode:404});
 const root=require('./config').ROOT,target=path.resolve(root,file);
 try{if(!fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep)||fs.statSync(target).size>512*1024)throw Error();return{path:file,content:fs.readFileSync(target,'utf8'),lineHits:entry.lineHits||[],stale:report.stale};}
 catch{return{path:file,available:false,uncoveredLines:entry.uncoveredLines,message:'This bundle has no source checkout for this file. Line numbers refer to the reported source digest.'};}
}
function current(){
 const file=path.join(require('./config').PATHS.cache,'diagnostics/coverage/latest.json');let report;
 for(const candidate of [file,path.join(__dirname,path.basename(__dirname)==='lib'?'../docs/benchmarks/test-coverage.json':'test-coverage.json')])try{if(fs.statSync(candidate).size>8*1048576)continue;report=JSON.parse(fs.readFileSync(candidate,'utf8'));break;}catch{}
 if(!report)return{protocol:'dt.coverage/v1',available:false,command:'npm run test:coverage',meaning:'No executed coverage report is installed.'};
 return{...report,available:true,stale:report.run.sourceDigest!==require('./source-version').digest(),currentSourceDigest:require('./source-version').digest()};
}
module.exports={lcov,aggregate,current,source,pct};
