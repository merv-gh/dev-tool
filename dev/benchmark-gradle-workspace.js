#!/usr/bin/env node
// Reproducible research fixture. Does not modify a real workspace or its build.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks'),assert=require('node:assert/strict');
const argv=process.argv.slice(2),option=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
if(argv.includes('--help')){console.log('node dev/benchmark-gradle-workspace.js --gradle <executable> --java-home <JDK21> [--out work/bench/gradle-workspace.json] [--fixture test/fixtures/lombok-service] [--classes 200] [--iterations 3] [--workers 2] [--timeout-ms 600000] [--spring-boot 2.7.18] [--lombok <fixture version>] [--jvm-args "-Xmx1g -Dfile.encoding=UTF-8"] [--keep]');process.exit(0);}
const gradle=option('gradle',process.env.DT_TEST_GRADLE),javaHome=option('java-home',process.env.JAVA_HOME);
if(!gradle||!javaHome)throw Error('Supply --gradle and --java-home (Java 21); no download or version upgrade is implicit');
const classes=Number(option('classes','200')),iterations=Number(option('iterations','3'));
assert.ok(Number.isInteger(classes)&&classes>=1&&classes<=10000);assert.ok(Number.isInteger(iterations)&&iterations>=1&&iterations<=20);
const fixtureDir=path.resolve(option('fixture',path.join(__dirname,'../test/fixtures/lombok-service'))),sourceQuote=fs.readFileSync(path.join(fixtureDir,'src/main/java/demo/Quote.java'),'utf8'),sourceCheck=fs.readFileSync(path.join(fixtureDir,'src/test/java/demo/QuoteTest.java'),'utf8');
const springBoot=option('spring-boot','2.7.18'),lombok=option('lombok',(fs.readFileSync(path.join(fixtureDir,'build.gradle'),'utf8').match(/org.projectlombok:lombok:([\d.]+)/)||[])[1]),workers=Number(option('workers','2')),timeoutMs=Number(option('timeout-ms','600000')),jvmArgs=option('jvm-args','-Xmx1g -Dfile.encoding=UTF-8');
assert.match(springBoot,/^[\d.]+$/);assert.match(lombok,/^[\d.]+$/);assert.ok(Number.isInteger(workers)&&workers>0&&workers<=64);assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>=1000);assert.ok(!/[\r\n]/.test(jvmArgs));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dt-gradle-research-')),gradleHome=path.join(dir,'gradle-home'),root=path.join(dir,'original'),other=path.join(dir,'other-checkout');
const out=path.resolve(option('out','work/bench/gradle-workspace.json')),logs=out.replace(/\.json$/,'')+'-logs',observer=path.join(__dirname,'gradle-workspace-observer.gradle');
const env={PATH:path.join(javaHome,'bin')+path.delimiter+(process.env.PATH||''),JAVA_HOME:javaHome,GRADLE_USER_HOME:gradleHome,
 HOME:os.homedir(),LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',JAVA_TOOL_OPTIONS:'-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8'};
// Public Maven dependencies only. Repository credentials and arbitrary dt secrets are absent.
for(const key of ['HTTPS_PROXY','HTTP_PROXY','NO_PROXY','https_proxy','http_proxy','no_proxy'])if(process.env[key])env[key]=process.env[key];
const canonicalDir=fs.realpathSync(dir),sanitize=text=>String(text).replaceAll(canonicalDir,'<benchmark>').replaceAll(dir,'<benchmark>').replaceAll(javaHome,'<jdk>').replaceAll(path.dirname(observer),'<dt-dev>');
const report={protocol:'dt.gradle-research/v1',at:new Date().toISOString(),fixture:{source:'existing lombok-service Quote/QuoteTest',sourceDigest:crypto.createHash('sha256').update(sourceQuote).update(sourceCheck).digest('hex'),java:21,springBoot,lombok,modules:2,extraLombokClasses:classes,dependencyMode:'in-process Spring; external PostgreSQL/Kafka not benchmarked'},host:{platform:process.platform,arch:process.arch,cpus:os.cpus().length},effective:{workers,timeoutMs,jvmArgs},iterations,runs:[],assertions:[],limits:['Existing Lombok source/test expanded into a synthetic two-module compile/context fixture, not a production service or a Testcontainers latency measurement.','Legacy comparison models module-clean compile-check followed by test; the current isolated annotation-aware check does not enable build cache explicitly.','No-configuration-cache and configuration-cache timings include the observer; no uninstrumented-overhead claim.','First run includes dependency downloads, daemon startup and Gradle script compilation.','Small sample counts are exploratory, not release performance thresholds.']};
fs.mkdirSync(logs,{recursive:true});fs.mkdirSync(path.dirname(out),{recursive:true});
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const write=(base,file,text)=>{const p=path.join(base,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};
const quote=(extra=false,offset=10)=>sourceQuote.replace('package demo;','package bench;').replace('int subtotal;','int subtotal;'+(extra?'\n    int surcharge;':'')).replace('return subtotal + 10;','return subtotal + '+(extra?'surcharge + ':'')+offset+';');
const checks=(extra=false,offset=10)=>sourceCheck.replace('package demo;','package bench;').replace('class QuoteTest','@org.springframework.boot.test.context.SpringBootTest(classes=ProbeApplication.class,webEnvironment=org.springframework.boot.test.context.SpringBootTest.WebEnvironment.NONE)\nclass QuoteTest').replace('.subtotal(20)','.subtotal(20)'+(extra?'.surcharge(5)':'')).replace('assertEquals(30, builder.build().total(true));','assertEquals('+(20+(extra?5:0)+offset)+', builder.build().total(true));\n        assertEquals(1,ProbeApplication.starts.get());');
function fixture(base){
 write(base,'settings.gradle',"rootProject.name='workspace-research'\ninclude 'domain','app'\n");
 write(base,'build.gradle',`subprojects { apply plugin:'java'; repositories { mavenCentral() }; java { toolchain { languageVersion=JavaLanguageVersion.of(21) } }; tasks.withType(JavaCompile).configureEach { options.encoding='UTF-8' }; tasks.withType(Test).configureEach { useJUnitPlatform(); maxParallelForks=1; forkEvery=0; outputs.upToDateWhen { false }; outputs.cacheIf { false }; testLogging { showStandardStreams=true } } }\n`);
 write(base,'gradle.properties','org.gradle.daemon=true\norg.gradle.caching=true\norg.gradle.workers.max='+workers+'\norg.gradle.jvmargs='+jvmArgs+'\n');
 write(base,'domain/build.gradle',`dependencies { compileOnly 'org.projectlombok:lombok:${lombok}'; annotationProcessor 'org.projectlombok:lombok:${lombok}' }\ntasks.withType(JavaCompile).configureEach { inputs.file(rootProject.file('lombok.config')).withPathSensitivity(PathSensitivity.RELATIVE) }\n`);
 write(base,'app/build.gradle',`dependencies { implementation project(':domain'); implementation platform('org.springframework.boot:spring-boot-dependencies:${springBoot}'); implementation 'org.springframework.boot:spring-boot-starter'; testImplementation 'org.springframework.boot:spring-boot-starter-test' }\n`);
 write(base,'lombok.config','config.stopBubbling = true\nlombok.addLombokGeneratedAnnotation = true\n');
 write(base,'domain/src/main/java/bench/Quote.java',quote());
 for(let i=0;i<classes;i++)write(base,`domain/src/main/java/bench/Value${i}.java`,`package bench; @lombok.Value @lombok.Builder public class Value${i} { long id; String label; }\n`);
 write(base,'app/src/main/java/bench/ProbeApplication.java',`package bench;\n@org.springframework.boot.SpringBootConfiguration\n@org.springframework.boot.autoconfigure.EnableAutoConfiguration\npublic class ProbeApplication { public static final java.util.concurrent.atomic.AtomicInteger starts=new java.util.concurrent.atomic.AtomicInteger(); @org.springframework.context.annotation.Bean String marker() { starts.incrementAndGet(); return "started"; } }\n`);
 write(base,'app/src/test/java/bench/QuoteTest.java',checks());
 for(let i=0;i<2;i++)write(base,`app/src/test/java/bench/Context${i}Test.java`,`package bench; @org.springframework.boot.test.context.SpringBootTest(classes=ProbeApplication.class,webEnvironment=org.springframework.boot.test.context.SpringBootTest.WebEnvironment.NONE) class Context${i}Test { @org.junit.jupiter.api.Test void contextIsShared() { org.junit.jupiter.api.Assertions.assertEquals(1,ProbeApplication.starts.get()); } }\n`);
}
const snapshot=base=>{const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['build','.gradle','.dt'].includes(e.name))continue;const f=path.join(d,e.name);if(e.isDirectory())walk(f);else files.push([path.relative(base,f).split(path.sep).join('/'),fs.readFileSync(f)]);}}walk(base);const h=crypto.createHash('sha256');for(const [name,bytes]of files.sort((a,b)=>a[0].localeCompare(b[0])))h.update(name).update('\0').update(bytes).update('\0');return h.digest('hex');};
function run(name,{base=root,tasks=[':app:test'],configurationCache=true,buildCache=true,expect=0}={}){
 const eventFile=path.join(base,'.dt/gradle-tasks.jsonl');fs.mkdirSync(path.dirname(eventFile),{recursive:true});fs.writeFileSync(eventFile,'');
 const args=['--console=plain','--info','--max-workers='+workers,configurationCache?'--configuration-cache':'--no-configuration-cache',buildCache?'--build-cache':'--no-build-cache',...(!configurationCache?['--no-watch-fs']:[]),'--init-script',observer,...tasks];
 const started=performance.now(),r=spawnSync(gradle,args,{cwd:base,env,encoding:'utf8',timeout:timeoutMs,maxBuffer:12*1024*1024}),wallMs=Math.round(performance.now()-started),text=sanitize((r.stdout||'')+(r.stderr||''));
 const events=fs.readFileSync(eventFile,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(sanitize(line))),first=Math.min(...events.map(t=>t.start)),last=Math.max(...events.map(t=>t.end));
 let tests=null;
 if(events.some(t=>t.task===':app:test'&&t.outcome==='EXECUTED')){
  tests={total:0,failures:0,errors:0,skipped:0};const reports=path.join(base,'app/build/test-results/test');
  if(fs.existsSync(reports))for(const f of fs.readdirSync(reports).filter(f=>/^TEST-.*\.xml$/.test(f))){const x=fs.readFileSync(path.join(reports,f),'utf8').match(/<testsuite\s[^>]*>/)?.[0]||'';for(const [key,attr]of Object.entries({total:'tests',failures:'failures',errors:'errors',skipped:'skipped'}))tests[key]+=Number(x.match(new RegExp('\\b'+attr+'="(\\d+)"'))?.[1]||0);}
 }
 const entry={name,sourceDigest:snapshot(base),wallMs,exit:r.status,arguments:sanitize(args.join(' ')),configurationCache:/Reusing configuration cache/.test(text)?'reused':/Configuration cache entry stored/.test(text)?'stored':configurationCache?'unavailable':'disabled',taskSpanMs:events.length?last-first:null,taskSumMs:events.reduce((n,t)=>n+t.ms,0),tests,tasks:events,compileNotes:text.split('\n').filter(l=>/Incremental compilation of|Full recompilation|not incremental|not up-to-date because|annotation processor/i.test(l)).slice(0,50)};
 fs.writeFileSync(path.join(logs,name+'.log'),text);report.runs.push(entry);save();console.error(name+': '+wallMs+'ms, '+entry.configurationCache+', exit '+r.status);
 assert.equal(r.status,expect,name+': '+text.slice(-4000));assert.ok(events.length,name+': task telemetry missing');if(tests&&expect===0){assert.equal(tests.total,3,name+': expected all three fixture tests to execute');assert.equal(tests.failures+tests.errors+tests.skipped,0);}return entry;
}
const executed=(entry,task)=>entry.tasks.find(t=>t.task===task)?.outcome;
const verify=(condition,text)=>{assert.ok(condition,text);report.assertions.push(text);save();};
try{
 fixture(root);
 report.jdk=sanitize(spawnSync(path.join(javaHome,'bin','java'),['-version'],{env,encoding:'utf8'}).stderr||'').trim();assert.match(report.jdk,/version "21\./);
 const version=spawnSync(gradle,['--version'],{env,encoding:'utf8'});assert.equal(version.status,0);report.gradle=(version.stdout.match(/Gradle ([\d.]+)/)||[])[1];assert.match(report.gradle,/^8\./,'Research baseline targets Gradle 8.x rather than assuming Boot 2.7 supports newer majors');
 run('cold-dependencies');
 const warm=run('warm-unchanged');verify(warm.configurationCache==='reused','Observer survives configuration-cache reuse');verify(executed(warm,':domain:compileJava')==='UP-TO-DATE','Unchanged compilation is skipped while tests execute');verify(executed(warm,':app:test')==='EXECUTED','Warm tests actually execute; passing results are not replayed from cache');
 for(let i=0;i<iterations;i++){
  write(root,'domain/src/main/java/bench/Quote.java',quote(false,11+i));write(root,'app/src/test/java/bench/QuoteTest.java',checks(false,11+i));
  run('legacy-edit-compile-'+i,{tasks:[':app:clean',':app:testClasses'],configurationCache:false,buildCache:false});
  run('legacy-edit-test-'+i,{configurationCache:false});
 }
 run('prime-configuration-cache');
 for(let i=0;i<iterations;i++){
  write(root,'domain/src/main/java/bench/Quote.java',quote(false,21+i));write(root,'app/src/test/java/bench/QuoteTest.java',checks(false,21+i));
  const edited=run('incremental-edit-'+i);verify(executed(edited,':app:compileJava')==='UP-TO-DATE','Library body edit '+i+' avoids consumer production recompilation');
 }
 write(root,'domain/src/main/java/bench/Quote.java',quote(true));write(root,'app/src/test/java/bench/QuoteTest.java',checks(true));run('lombok-builder-api-edit');
 verify(fs.existsSync(path.join(root,'domain/build/classes/java/main/bench/Quote$QuoteBuilder.class')),'Lombok generated builder exists after an API edit');
 fs.unlinkSync(path.join(root,'domain/src/main/java/bench/Value0.java'));run('source-deletion');verify(!fs.existsSync(path.join(root,'domain/build/classes/java/main/bench/Value0.class')),'Deleted source removes its stale class without clean');verify(!fs.existsSync(path.join(root,'domain/build/classes/java/main/bench/Value0$Value0Builder.class')),'Deleted source removes its generated builder without clean');
 fs.unlinkSync(path.join(root,'domain/build/classes/java/main/bench/Quote$QuoteBuilder.class'));run('missing-generated-output');verify(fs.existsSync(path.join(root,'domain/build/classes/java/main/bench/Quote$QuoteBuilder.class')),'Missing generated class is restored without a manual clean');
 write(root,'lombok.config','config.stopBubbling = true\nlombok.addLombokGeneratedAnnotation = false\n');const config=run('lombok-config-edit');verify(executed(config,':domain:compileJava')!=='UP-TO-DATE','Declared lombok.config edit invalidates compilation');
 fixture(other);const checkout=run('fresh-checkout-shared-cache',{base:other});verify(executed(checkout,':domain:compileJava')==='FROM-CACHE','Fresh checkout reuses baseline compile outputs by content rather than branch name');
 write(other,'domain/src/main/java/bench/Quote.java',quote(false,33));write(other,'app/src/test/java/bench/QuoteTest.java',checks(false,33));run('fresh-checkout-next-edit',{base:other});
 write(root,'domain/src/main/java/bench/Quote.java',quote());write(root,'app/src/test/java/bench/QuoteTest.java',checks());write(root,'domain/src/main/java/bench/Value0.java','package bench; @lombok.Value @lombok.Builder public class Value0 { long id; String label; }\n');write(root,'lombok.config','config.stopBubbling = true\nlombok.addLombokGeneratedAnnotation = true\n');const returned=run('return-to-baseline');verify(executed(returned,':domain:compileJava')==='FROM-CACHE','Returning to baseline content restores a retained compile task result');
 const sum=(prefix,index)=>report.runs.filter(r=>r.name.startsWith(prefix)&&r.name.endsWith('-'+index)).reduce((n,r)=>n+r.wallMs,0),median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const legacy=Array.from({length:iterations},(_,i)=>sum('legacy-edit-',i)),incremental=report.runs.filter(r=>r.name.startsWith('incremental-edit-')).map(r=>r.wallMs);
 report.comparison={legacyEditMs:legacy,incrementalEditMs:incremental,legacyMedianMs:median(legacy),incrementalMedianMs:median(incremental),medianSpeedup:Number((median(legacy)/median(incremental)).toFixed(2))};report.passed=true;save();console.log(JSON.stringify({out,comparison:report.comparison,assertions:report.assertions.length}));
}catch(error){report.passed=false;report.error=sanitize(error.message);save();throw error;}
finally{spawnSync(gradle,['--stop'],{cwd:root,env,encoding:'utf8',timeout:20000});if(!argv.includes('--keep'))fs.rmSync(dir,{recursive:true,force:true});else console.error('Retained disposable benchmark: '+dir);}
