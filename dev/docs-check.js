const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),r=spawnSync('git',['ls-files','-z','--','README.md','docs/*.md','demo/README.md','plugins/README.md'],{cwd:root,encoding:'utf8'});assert.equal(r.status,0);let links=0;
// Historical evidence documents remain historical. Check the maintained entry
// points and operator guide rather than rewriting dated source references.
const files=['README.md','docs/operator-guide.md','docs/known-limitations.md','docs/roadmap.md','docs/adapter-contracts.md','docs/observability.md','docs/guided-workbench.md'];
for(const file of files){const text=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(text,/\/Users\/[^\s/]+\/|\/home\/[^\s/]+\//,file+' contains a personal absolute path');for(const match of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)){const target=match[1];if(/^(https?:|mailto:)/.test(target))continue;assert.ok(fs.existsSync(path.resolve(root,path.dirname(file),target)),file+' -> '+target);links++;}}
console.log(JSON.stringify({files:files.length,localLinks:links,passed:true}));
