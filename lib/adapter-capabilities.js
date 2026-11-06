const schema=require('../contracts/v1/adapter-capabilities.schema.json');
function validate(value){const issues=require('./schema').validate(value,schema);if(issues.length)throw Object.assign(Error('Invalid adapter capability manifest: '+issues[0].message),{code:'DT_BACKEND_CONTRACT',issues});return value;}
function list(){
 const builtins={protocol:'dt.adapter-capabilities/v1',id:'dev-tool',scopeAware:true,capabilities:[
  {operation:'code_search',languages:['text'],evidence:'text',sourceIdentity:'repository commit + source digest',gaps:['A text hit does not establish a call or data-flow edge.']},
  {operation:'passport',languages:['java','kotlin'],evidence:'static',sourceIdentity:'repository and internal-library commits',gaps:['Dynamic configuration, reflection and unindexed libraries remain explicit gaps.']},
  {operation:'semantic_query',languages:['java','js','ts','tsx'],evidence:'retained-semantic',sourceIdentity:'commit + content digest + engine/script generation',gaps:['Requires configured Joern and a retained analysis; static paths do not prove runtime execution.']}
 ]};
 const adapters=Object.entries(require('./config').getTools().backends).map(([route,b])=>({route,protocol:'dt.tool/v1',transport:'http',authenticated:!!b.token,scopeAware:b.scopeAware===true,capabilities:b.capabilities?validate(b.capabilities):null,gaps:b.capabilities?[]:['No capability manifest configured; inspect the operation contract before use.']}));
 return {builtin:builtins,adapters};
}
module.exports={validate,list};
