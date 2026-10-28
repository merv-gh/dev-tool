// Assemble an already-frozen solver submission for independent acceptance grading.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const manifest=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||''),'utf8'));const dest=path.resolve(process.argv[3]||'');
if(fs.existsSync(dest)&&fs.readdirSync(dest).length)throw new Error('candidate destination must be empty');
const pub=process.env.DT_CHALLENGE_PUBLIC_PACK||path.resolve(__dirname,'../challenges/developer-v1');fs.cpSync(pub,dest,{recursive:true});
for(const [relative,source]of Object.entries(manifest)){
 if(!/^C0[1-8](?:\/(?:LIB\/common-primitives|FIN\/ledger-service))?$/.test(relative))throw new Error('unknown candidate overlay '+relative);
 const target=path.join(dest,relative);fs.rmSync(target,{recursive:true,force:true});fs.cpSync(path.resolve(source),target,{recursive:true,filter:f=>!f.split(path.sep).some(x=>['.git','target','build','.gradle'].includes(x))});
}
const digest=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');console.log(JSON.stringify({candidate:dest,manifestSha256:digest,cases:Object.keys(manifest)},null,2));
