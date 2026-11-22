#!/usr/bin/env node
// Persist a standalone practice repo without copying the private grader/oracle.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
function create(destination,{mutation}={}){
  const root=path.resolve(destination);if(fs.existsSync(root)&&fs.readdirSync(root).length)throw Error('Choose a new or empty directory; existing work is never overwritten');
  const E=require('./eval-person-mutations'),F=require('./person-mutations');if(mutation&&!F.validCase(mutation))throw Error('Choose a known mutation');E.seed(root);
  const resource=path.join(root,'src/test/resources');fs.mkdirSync(resource,{recursive:true});fs.writeFileSync(path.join(resource,'seed.sql'),F.sql(F.dataset(42,1)));
  const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim();};
  git(['init','-q','-b','main']);git(['add','.']);git(['-c','user.name=Practice fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','-qm','Person API practice baseline']);
  const baseline=git(['rev-parse','HEAD']);
  if(mutation){git(['checkout','-qb','codex/person-'+crypto.createHash('sha256').update(mutation).digest('hex').slice(0,8)]);F.mutate(root,mutation);}
  return {root,baseline,mutation:mutation||null,oracleIncluded:false};
}
module.exports={create};if(require.main===module){const a=process.argv.slice(2);if(!a[0]||![1,3].includes(a.length)||a[1]&&a[1]!=='--mutation')throw Error('Usage: node dev/create-person-repo.js <new-directory> [--mutation <name>]');console.log(JSON.stringify(create(a[0],{mutation:a[2]})));}
