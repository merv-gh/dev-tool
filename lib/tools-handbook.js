module.exports=({str,int,env})=>[
 {name:'handbook',group:'catalog',description:'Find dev-tool workflow chapters or read one chapter: prerequisites, examples, indices, visualization guidance and proof limits. Does not execute examples.',input:{query:str('Workflow/question words'),chapter:str('Exact chapter id'),env,limit:int('Maximum chapter matches',6)},run:a=>require('./handbook').query(a)},
 {name:'self_context',group:'context',strictInput:true,description:'Read a safe briefing of this installation’s enabled tools, cache metadata and current story. save=true refreshes generated files in the scoped dev-tool-self context, preserving operator-notes.md. No remote refresh or credentials.',input:{env,save:{type:'boolean',default:false}},run:a=>require('./handbook').selfContext(a)}
];
