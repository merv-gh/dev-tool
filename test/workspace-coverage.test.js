const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dt-change-coverage-'));Object.assign(process.env,{DT_HOME:home,DT_LOG:'quiet',DT_STATE_BACKEND:'legacy',DT_NO_DOCTOR:'1',DT_RATE_PER_SEC:'0'});for(const k of ['DT_CONFIG_DIR','DT_CACHE_DIR','DT_PASSPORTS_DIR','DT_RUNNER_URL','DT_TOOLS'])delete process.env[k];fs.writeFileSync(path.join(home,'config.json'),'{"envs":{"test":{}},"scripts":{"starters":false}}');
const C=require('../lib/workspace-coverage'),W=require('../lib/workspace'),A=require('../lib/access');let ws,root;
test.before(async()=>{const src=path.join(home,'seed');fs.mkdirSync(path.join(src,'src/main/java/demo'),{recursive:true});fs.writeFileSync(path.join(src,'pom.xml'),'<project/>');fs.writeFileSync(path.join(src,'src/main/java/demo/A.java'),'package demo;\nclass A {\n int f(boolean b) {\n  if (b) return 1;\n  return 0;\n }\n}\n');const env={...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.test'},g=(...a)=>execFileSync('git',a,{cwd:src,env,stdio:'pipe'});g('init','-q','-b','main');g('add','.');g('commit','-qm','base');ws=await W.open({project:'DEMO',repo:'change-coverage',url:'file://'+src,ref:'main'});root=W.checkId(ws.id).path;});
test.after(async()=>{await require('../lib/isolate').stop();await require('../lib/state-store').close();fs.rmSync(home,{recursive:true,force:true});});
test('plans include current added lines and untracked production files, not tests or unrelated code',async()=>{
 W.write(ws.id,'src/main/java/demo/A.java',{edits:[{find:'return 1;',replace:'return 2;'}]});W.write(ws.id,'src/main/java/demo/New.java',{content:'package demo;\nclass New {}\n'});W.write(ws.id,'src/test/java/demo/ExtraTest.java',{content:'class ExtraTest {}'});
 const p=await C.plan(ws.id);assert.equal(p.files.length,2);assert.deepEqual(p.files[0].changed,[4]);assert.deepEqual(p.files[1].changed,[1,2]);assert.equal(p.files[0].sourceLines[4],'  if (b) return 2;');assert.match(p.base,/^[a-f0-9]{40}$/);await assert.rejects(C.plan(ws.id,{base:'--help'}));
});
test('fresh coverage counts only changed executable lines and retains missed branches, unknown mappings and non-code',()=>{
 const scope={files:[{path:'src/main/java/demo/A.java',changed:[1,2,3],ranges:[[1,3]],sourceLines:{1:'if (b)',2:'return 1;'}},{path:'src/main/java/demo/Missing.java',changed:[8],ranges:[[8,8]]}]};
 const sources=new Map([['demo/A.java',new Map([[1,{line:1,coveredInstructions:2,missedInstructions:0,coveredBranches:1,missedBranches:1}],[2,{line:2,coveredInstructions:0,missedInstructions:1,coveredBranches:0,missedBranches:0}]])]]);
 let r=C.evaluate(scope,sources,{verified:true});assert.equal(r.summary.covered,1);assert.equal(r.summary.missed,1);assert.equal(r.summary.nonExecutable,1);assert.equal(r.summary.unknown,1);assert.equal(r.summary.percent,50);assert.equal(r.summary.fullyCovered,false);assert.equal(r.summary.branchPercent,50);
 const duplicate={files:[scope.files[0],{...scope.files[0],path:'other/src/main/java/demo/A.java'}]};r=C.evaluate(duplicate,sources,{verified:true});assert.equal(r.summary.covered,0);assert.equal(r.summary.unknown,6);
});
test('XML is streamed without resolving its DTD, validates nesting and counters, and rejects duplicates/truncation',async()=>{
 const file=path.join(home,'report.xml'),valid='<?xml version="1.0"?><!DOCTYPE report SYSTEM "https://never-fetch.test/report.dtd"><report name="x"><package name="demo"><sourcefile name="A.java"><line nr="4" mi="0" ci="4" mb="1" cb="1"/></sourcefile></package></report>';
 fs.writeFileSync(file,valid);let rows=await C.xmlLines(file);assert.equal(rows.get('demo/A.java').get(4).coveredInstructions,4);
 for(const bad of [valid.replace('</report>',''),valid.replace('ci="4"','ci="NaN"'),valid.replace('</package>','</wrong>'),valid.replace('</sourcefile>','</sourcefile><sourcefile name="A.java"/>')]){fs.writeFileSync(file,bad);await assert.rejects(C.xmlLines(file));}
 fs.writeFileSync(file,valid.replace('<line nr="4"', '<!-- '+('x'.repeat(70000))+' --><line nr="4"'));rows=await C.xmlLines(file);assert.equal(rows.get('demo/A.java').size,1);
});
test('report loading is scoped and a source edit invalidates previous full coverage',()=>{
 const dir=path.join(home,'cache/change-coverage',ws.id),id='a'.repeat(24);fs.mkdirSync(dir,{recursive:true});const r={workspace:ws.id,id,available:true,state:'measured',sourceFingerprint:require('../lib/testrun').fingerprint(root,{includeTests:true}),files:[],summary:{complete:true,fullyCovered:true}};fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(r));fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify({id}));assert.equal(C.load(ws.id).summary.fullyCovered,true);
 W.write(ws.id,'src/main/java/demo/A.java',{edits:[{find:'return 2;',replace:'return 3;'}]});assert.equal(C.load(ws.id).stale,true);assert.equal(C.load(ws.id).summary.fullyCovered,false);assert.throws(()=>C.load(ws.id,'../other'));
 A.run({principalId:'bob',storyId:'other'},()=>assert.throws(()=>C.load(ws.id),/workspace/));
});
test('class-file source identities include nested/generated classes without loading code',()=>{
 const {spawnSync}=require('child_process');if(spawnSync('javac',['-version']).status!==0)return;
 const dir=path.join(home,'classes');fs.mkdirSync(dir);const file=path.join(home,'Outer.java');fs.writeFileSync(file,'package demo; public class Outer { static class Generated {} }');execFileSync('javac',['-g','-d',dir,file]);const c=C.classIdentity(path.join(dir,'demo/Outer$Generated.class'));assert.equal(c.name,'demo/Outer$Generated');assert.equal(c.source,'demo/Outer.java');
});
test('unavailable collection is retained with unknown lines and explicit recovery; no-source changes have no 100% claim',async()=>{
 const scope=await C.plan(ws.id),session={scope,state:'unavailable',gaps:['Offline agent is missing.']};const r=await C.finish(session);assert.equal(r.available,false);assert.equal(r.state,'unavailable');assert.ok(r.summary.unknown>0);const reopened=C.get(ws.id);assert.equal(reopened.id,r.id);assert.match(reopened.gaps[0],/Offline/);assert.match(reopened.view,/\/show\//);assert.throws(()=>C.get(ws.id,{file:'absent.java'}),/outside/);
 const empty={...scope,files:[],counts:{files:0,changedLines:0,deletedFiles:0}},n=await C.finish({scope:empty,state:'no_changes'});assert.equal(n.state,'no_changes');assert.equal(n.summary.percent,null);assert.equal(n.summary.fullyCovered,false);assert.equal(C.load(ws.id).id,n.id);
 const p={tool:'node'},unsupported=await C.begin(ws.id,undefined,root,p,{},{});assert.equal(unsupported.state,'unavailable');assert.match(unsupported.gaps[0],/JVM/);
 const badJar=await C.begin(ws.id,undefined,root,{tool:'maven'},{coverage:{agentJar:'missing-agent.jar'},mavenRepo:home},{});assert.equal(badJar.state,'unavailable');assert.match(badJar.gaps[0],/jar/);
 assert.deepEqual(C.ranges([5,2,3,3,9]),[[2,3],[5,5],[9,9]]);
});
test('stream filtering preserves all duplicate suffix candidate lines and only proven module mapping receives credit',async()=>{
 const scope={files:[{path:'a/src/main/java/demo/A.java',changed:[4],ranges:[[4,4]]},{path:'b/src/main/java/demo/A.java',changed:[5],ranges:[[5,5]]}]},file=path.join(home,'module.xml');fs.writeFileSync(file,'<report><package name="demo"><sourcefile name="A.java"><line nr="4" mi="0" ci="2" mb="0" cb="0"/><line nr="5" mi="1" ci="0" mb="0" cb="0"/></sourcefile></package></report>');
 const sources=await C.xmlLines(file,scope);assert.equal(sources.get('demo/A.java').size,2);const r=C.evaluate(scope,sources,{verified:true,sourcePaths:new Set([scope.files[0].path])});assert.equal(r.files[0].counts.covered,1);assert.equal(r.files[1].counts.unknown,1);assert.equal(r.summary.fullyCovered,false);
});
test('Gradle DSL, version catalog and Lombok settings invalidate source pins',()=>{
 const TR=require('../lib/testrun');let fp=TR.fingerprint(root,{includeTests:true});for(const name of ['build.gradle','settings.gradle.kts','gradle/libs.versions.toml','lombok.config']){W.write(ws.id,name,{content:'// changed build input\n'});const next=TR.fingerprint(root,{includeTests:true});assert.notEqual(next,fp,name);fp=next;}
});
