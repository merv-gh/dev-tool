// Text-only Qwen3.5 framing for REA's raw {{ .Prompt }} Ollama alias.
// Protocol reference: https://huggingface.co/Qwen/Qwen3.5-27B/blob/main/chat_template.jinja
// Deliberately isolated from production. No argument repair or source evaluation.
const crypto=require('node:crypto');
function callText(name,args){return '<tool_call>\n<function='+name+'>\n'+Object.entries(args).map(([k,v])=>'<parameter='+k+'>\n'+(typeof v==='string'?v:JSON.stringify(v))+'\n</parameter>').join('\n')+'\n</function>\n</tool_call>';}
function prompt(payload){
 let system=payload.messages[0]?.role==='system'?payload.messages[0].content:'';
 if(payload.tools?.length)system='# Tools\nUse these function schemas:\n<tools>\n'+payload.tools.map(t=>JSON.stringify(t)).join('\n')+'\n</tools>\nTo call a function, use <tool_call><function=NAME><parameter=ARGUMENT>VALUE</parameter></function></tool_call>. Write each parameter separately. Use JSON for arrays and objects; plain text for strings. Include all required arguments. A parameter named query must start with <parameter=query>, never <query>. Example syntax:\n<tool_call>\n<function=FUNCTION_NAME>\n<parameter=PARAMETER_NAME>\nvalue\n</parameter>\n</function>\n</tool_call>\nTool results arrive inside tool_response tags. Do not imitate a result. When calling tools, leave no text after the last closing tool_call tag.\n\n'+system;
 let text='<|im_start|>system\n'+system+'<|im_end|>\n';
 for(let i=0;i<payload.messages.length;i++){
  const m=payload.messages[i];if(m.role==='system')continue;
  if(m.role==='tool'){text+='<|im_start|>user\n';do{text+='<tool_response>\n'+payload.messages[i].content+'\n</tool_response>\n';i++;}while(payload.messages[i]?.role==='tool');i--;text+='<|im_end|>\n';continue;}
  if(!['user','assistant'].includes(m.role)||m.content&&typeof m.content!=='string')throw Error('REA adapter supports text messages only');
  text+='<|im_start|>'+m.role+'\n'+(m.content||'');
  for(const c of m.tool_calls||[])text+='\n'+callText(c.function.name,JSON.parse(c.function.arguments));
  text+='<|im_end|>\n';
 }
 return text+'<|im_start|>assistant\n<think>\n\n</think>\n\n';
}
function parse(text,payload){
 text=text.replace(/<think>[\s\S]*?<\/think>/g,'').trim();const calls=[];
 for(const match of text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)){
  const fn=match[1].trim().match(/^<function=([\w]+)>\s*([\s\S]*?)\s*<\/function>$/);if(!fn)throw Error('Malformed native function call');
  const schema=payload.tools?.find(t=>t.function.name===fn[1])?.function.parameters;if(!schema)throw Error('Native response called an unlisted tool');
  const args={},parameters=[...fn[2].matchAll(/<parameter=([\w]+)>([\s\S]*?)<\/parameter>/g)];let remaining=fn[2];
  for(const parameter of parameters){const name=parameter[1],property=schema.properties?.[name];if(!property||Object.hasOwn(args,name))throw Error('Unknown or duplicate native parameter');const value=parameter[2].trim();args[name]=property.type==='string'?value:JSON.parse(value);remaining=remaining.replace(parameter[0],'');}
  if(remaining.trim())throw Error('Unparsed native parameter text');
  calls.push({id:'rea-'+crypto.randomUUID(),type:'function',function:{name:fn[1],arguments:JSON.stringify(args)}});
 }
 const content=text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g,'').trim();
 if(/<\/?(?:tool_call|function|parameter)[=>]/.test(content))throw Error('Incomplete native tool call; nothing executed');
 return {role:'assistant',content:content||null,...(calls.length?{tool_calls:calls}:{})};
}
async function generate(upstream,payload,{window=24000,signal,onResponse}={}){
 const request={model:payload.model,prompt:prompt(payload),raw:true,stream:false,keep_alive:'5m',options:{num_ctx:window,num_predict:payload.max_tokens,temperature:payload.temperature??0,repeat_penalty:1.05,stop:['<|im_end|>']}};
 const response=await fetch(upstream.replace(/\/v1\/?$/,'').replace(/\/$/,'')+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal});
 const raw=await response.text();if(!response.ok)return {status:response.status,body:raw};
 const value=JSON.parse(raw);onResponse?.(value);let message;try{message=parse(value.response||'',payload);}catch(error){return {status:422,body:JSON.stringify({error:error.message,code:'REA_MODEL_PROTOCOL',response:value.response||''}),requestBytes:Buffer.byteLength(JSON.stringify(request))};}return {status:200,body:JSON.stringify({model:payload.model,choices:[{finish_reason:value.done_reason==='length'?'length':'stop',message}],usage:{prompt_tokens:value.prompt_eval_count||0,completion_tokens:value.eval_count||0,total_tokens:(value.prompt_eval_count||0)+(value.eval_count||0)}}),requestBytes:Buffer.byteLength(JSON.stringify(request))};
}
module.exports={prompt,parse,generate,callText};
