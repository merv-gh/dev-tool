// Offline fixed-fixture replay. It never interprets user JavaScript or contacts a backend.
const fs=require('node:fs');const{replay}=require('./fixture.cjs');try{const result=replay(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:1;}catch(e){console.error(e.message);process.exitCode=1;}
