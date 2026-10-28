// Independent differential verifier, published after supplemental consumer submission froze.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawnSync}=require('child_process');
const candidate=path.resolve(process.argv[2]||'');const baseline=path.resolve(__dirname,'../challenges/developer-supplement-v1.2');
const javaDir=path.join(__dirname,'challenge-s03');const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const config=process.env.DT_HOME?JSON.parse(fs.readFileSync(path.join(process.env.DT_HOME,'config.json'))):{};
const env={...process.env,...config.tests?.env};const javaHome=process.env.DT_JAVA_HOME||process.env.JAVA_HOME;
const binary=n=>javaHome?path.join(javaHome,'bin',n):n;
const adapter=path.join(javaDir,'JdbcFunctions.java'),candidateAdapter=path.join(candidate,'src/main/java/com/lumen/orders/JdbcFunctions.java');
if(sha(fs.readFileSync(adapter))!==sha(fs.readFileSync(candidateAdapter)))throw new Error('supplement adapter changed; consumer-only refactor expected');
const results=[];
for(const[name,source]of [['baseline',baseline],['candidate',candidate]]){
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'dt-s03-compile-'));try{
 const consumer=path.join(source,'src/main/java/com/lumen/orders/OrderProjectionService.java');
 const compile=spawnSync(binary('javac'),['-d',out,consumer,adapter,path.join(javaDir,'S03Acceptance.java')],{encoding:'utf8'});if(compile.status)throw new Error(compile.stderr);
 const fake=spawnSync(binary('java'),['-cp',out,'S03Acceptance'],{encoding:'utf8'});
 let jdbc={status:null,stdout:'',stderr:'SELECT-only DT_FUNCTIONS_* source bindings unavailable; no source comparison claimed'};
 if(env.DT_FUNCTIONS_URL&&env.DT_FUNCTIONS_USERNAME){const jar=process.env.DT_CHALLENGE_JDBC_JAR||path.join(os.homedir(),'.m2/repository/org/postgresql/postgresql/42.7.4/postgresql-42.7.4.jar');jdbc=spawnSync(binary('java'),['-cp',out+path.delimiter+jar,'S03Acceptance','jdbc'],{encoding:'utf8',env,timeout:60000});}
 results.push({name,sourceSha256:sha(fs.readFileSync(consumer)),fake:{exit:fake.status,stdout:fake.stdout,stderr:fake.stderr},sourceReadOnly:{env:env.DT_DATA_SOURCE_ENV||'unspecified',execution:'local JVM',exit:jdbc.status,stdout:jdbc.stdout,stderr:jdbc.stderr}});
 }finally{fs.rmSync(out,{recursive:true,force:true});}
}
const same=results[0].fake.stdout===results[1].fake.stdout&&results[0].sourceReadOnly.stdout===results[1].sourceReadOnly.stdout;
console.log(JSON.stringify({kind:'post-freeze-independent-S03-differential',passed:same&&results.every(r=>r.fake.exit===0&&r.sourceReadOnly.exit===0),notes:['Baseline and candidate consumers compile separately with unchanged setup JDBC adapter','No source writes; DT_FUNCTIONS_* must bind a SELECT-only role','Local execution reading a source environment is not remote dev execution','Acceptance authored after candidate froze; no pre-frozen supplemental oracle claim'],results},null,2));
