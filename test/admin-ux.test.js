const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function harness(){
  const elements=new Map(),make=()=>{
    const attributes=new Map();let writes=0;
    return{hidden:true,textContent:'',children:[],get writes(){return writes;},getAttribute:key=>attributes.get(key)||null,removeAttribute:key=>attributes.delete(key),set src(value){writes++;attributes.set('src',value);},get src(){return attributes.get('src');},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;this.textContent='';}};
  };
  const $=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);},reads=[];
  const context=vm.createContext({$,contextState:{id:'one',files:[]},contextRead:async file=>reads.push(file),contextMessage(){},rtNativeView:view=>view?'/show/result?embed=1':null,document:{addEventListener(){},createElement:make}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/admin-ux.js'),'utf8'),context);
  return{$,reads,context,run:code=>vm.runInContext(code,context)};
}
test('native memory previews keep an existing frame loaded and clear when a context changes',()=>{
  const h=harness();
  h.run("contextRenderResult({resultView:'/show/result',preview:'{\"result\":{\"view\":\"/show/result\"}}'})");
  assert.equal(h.$('cxNativeResult').hidden,false);assert.equal(h.$('cxSavedNative').hidden,false);
  h.run("contextRenderResult({resultView:'/show/result',preview:'{}'})");
  assert.equal(h.$('cxNativeResult').writes,1);assert.equal(h.$('cxSavedNative').writes,1);
  h.run('contextResetResults()');
  assert.equal(h.$('cxNativeResult').hidden,true);assert.equal(h.$('cxSavedNative').src,undefined);assert.equal(h.$('cxSavedRaw').textContent,'');
});
test('saved evidence uses the existing draft-aware and versioned file read path',async()=>{
  const h=harness();h.context.contextState.files=[{path:'calls/run.json',summary:'Saved evidence',bytes:100}];h.run('contextSavedList()');
  await h.$('cxSavedResults').children[0].onclick();assert.deepEqual(h.reads,['calls/run.json']);
});
