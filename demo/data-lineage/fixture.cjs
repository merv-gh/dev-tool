const fs=require('node:fs'),path=require('node:path');
function seed(home){
 const put=(p,v)=>{const file=path.join(home,p);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof v==='string'?v:JSON.stringify(v));return file;};
 put('config.json',{envs:{dev:{postgres:{alpha:'postgres://fixture@127.0.0.1:1/alpha',beta:'postgres://fixture@127.0.0.1:1/beta'}}}});
 const table={schema:'public',name:'person',kind:'table',columns:['id','legal_name'].map(name=>({name,type:'text'})),constraints:[],indexes:[]};
 for(const db of ['alpha','beta'])put(`cache/dev/pg/${db}.json`,{db,database:db,syncedAt:'2026-11-24T00:00:00Z',tables:[table],functions:[{schema:'public',name:'rename_person',args:'v_id bigint',kind:'procedure',lang:'plpgsql',body:"begin update public.person set legal_name = 'Anna' where id=v_id; end;"}],triggers:[],viewDeps:[]});
 const CI=require('../../lib/codeindex');
 for(const repo of ['person-core','person-api','person-search','other-cluster']){const root=path.join(home,'repos/DEMO',repo);fs.mkdirSync(root,{recursive:true});fs.cpSync(path.join(__dirname,'../../test/fixtures/data-lineage',repo),root,{recursive:true});CI.build(root,`DEMO/${repo}`,{project:'DEMO',repo,sha:'fixture-'+repo,...(repo==='person-api'?{libs:[{index:'DEMO/person-core'}]}:{})});}
 return {put};
}
module.exports={seed};
