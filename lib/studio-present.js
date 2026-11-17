// Passive inline records share the existing immutable result/capability policy.
function wrap(tools){return tools.map(t=>({...t,run:async args=>{const result=await t.run(args);if(result===null||typeof result!=='object'||Array.isArray(result)||t.name==='automation_flow_model'||result.view)return result;return {...result,view:require('./results').saveView('work-record',{tool:t.name,result},{title:result.title||t.name.replaceAll('_',' ')})};}}));}
module.exports={wrap};
