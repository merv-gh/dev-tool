// Small schema-driven forms for the shared tool registry; JSON remains the exact contract.
window.dtToolForm={mount(root,schema,value={},change=()=>{},options={}){
 root.replaceChildren();const state={...value},required=schema?.required||[],properties=Object.entries(schema?.properties||{}),basic=document.createElement('div');basic.className='tool-fields';root.append(basic);
 const more=document.createElement('details');more.className='tool-extra';more.innerHTML='<summary>More arguments</summary>';const extra=document.createElement('div');extra.className='tool-fields';more.append(extra);root.append(more);let count=0;
 for(const [name,s]of properties){const visible=!(options.secondary||[]).includes(name)&&(required.includes(name)||Object.hasOwn(value,name)||count++<4),field=document.createElement('label');field.className='tool-field';const title=document.createElement('span');title.textContent=name.replaceAll('_',' ')+(required.includes(name)?' · required':'');field.append(title);const types=[].concat(s.type||'string'),type=types.find(t=>t!=='null');let input;
  if(s.enum){input=document.createElement('select');if(!required.includes(name))input.add(new Option('Not set',''));for(const option of s.enum)input.add(new Option(String(option),String(option)));}
  else if(type==='object'||type==='array'&&s.items?.type!=='string'){input=document.createElement('textarea');input.rows=3;input.spellcheck=false;}
  else{input=document.createElement('input');input.type=type==='boolean'?'checkbox':['integer','number'].includes(type)?'number':'text';if(s.minimum!==undefined)input.min=s.minimum;if(s.maximum!==undefined)input.max=s.maximum;}
  if(input.type==='checkbox')input.checked=!!value[name];else input.value=value[name]===undefined||value[name]===null?'':typeof value[name]==='object'?type==='array'&&s.items?.type==='string'?value[name].join(', '):JSON.stringify(value[name],null,2):String(value[name]);
  input.setAttribute('aria-label',name.replaceAll('_',' '));if(s.description)input.title=s.description;field.append(input);const error=document.createElement('small');error.className='err-text';error.setAttribute('role','status');field.append(error);
  input.oninput=()=>{try{let v=input.type==='checkbox'?input.checked:input.value;if(v===''&&!required.includes(name)){delete state[name];}else{if(type==='object'||type==='array'&&s.items?.type!=='string')v=JSON.parse(v||'null');else if(type==='array')v=v.split(',').map(x=>x.trim()).filter(Boolean);else if(['integer','number'].includes(type))v=v===''?undefined:Number(v);state[name]=v;}error.textContent='';change({...state});}catch{error.textContent='Enter valid JSON for this field.';}};
  (visible?basic:extra).append(field);
 }
 more.hidden=!extra.children.length;return{value:()=>({...state})};
}};
