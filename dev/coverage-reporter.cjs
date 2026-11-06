// Keep test identity and outcome, never assertion payloads or exception contents.
const path=require('node:path'),root=path.resolve(__dirname,'..');
module.exports=async function*(events){for await(const event of events){if(!['test:pass','test:fail','test:summary'].includes(event.type))continue;const d=event.data;
 yield JSON.stringify({type:event.type,name:String(d.name||'').slice(0,240),file:d.file?path.relative(root,d.file).split(path.sep).join('/'):undefined,line:d.line,skip:!!d.skip,details:d.details?{type:d.details.type}:undefined,...(event.type==='test:summary'?{counts:d.counts}: {})})+'\n';
}};
