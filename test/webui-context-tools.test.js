const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('native chat tools keep explicit owned compaction durable and replay-safe',async()=>{
 const r=await promisify(execFile)('python3',[path.join(__dirname,'helpers/webui-context-check.py'),path.resolve(__dirname,'..')],{timeout:15000});assert.match(r.stdout,/cross-worker receipts passed/);
});
