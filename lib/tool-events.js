const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
function progress(phase,data={}){const notify=context.getStore();if(notify)notify({phase,...data,executionId:require('./execution').current()?.id||null});}
module.exports={run:(notify,fn)=>context.run(notify,fn),progress,capture:()=>context.getStore()};
