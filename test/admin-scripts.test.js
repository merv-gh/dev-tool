const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function harness(api) {
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', handlers: {}, addEventListener(type,fn) { this.handlers[type]=fn; }, querySelectorAll:()=>[] }); return elements.get(id); };
  const runtime = vm.createContext({ $, api, DTState: require('../lib/state-machine'), console, setTimeout, clearTimeout, confirm:()=>true, toast() {}, esc:String, dur:String, show() {}, tab:'scripts', localStorage:{getItem:()=>null,setItem(){}}, window:{addEventListener(){}}, document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null} });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/admin-scripts.js'),'utf8'),runtime);
  const run = code => vm.runInContext(code,runtime);
  run('renderEditor=()=>{};renderTree=()=>{};renderView=()=>{};readForm=()=>true;readSite=()=>{};loadScripts=async()=>{};loadSites=async()=>{};loadViews=async()=>{};');
  return { $, run };
}
function deferred() { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; }
test('saved script read responses cannot replace a later selection or a newly edited draft', async () => {
  const a=deferred(),b=deferred(),h=harness(url=>url.endsWith('=a')?a.promise:b.promise);
  const first=h.run("openScript('a')"),second=h.run("openScript('b')");
  b.resolve({id:'b',steps:[]});await second;a.resolve({id:'a',steps:[]});await first;
  assert.equal(h.run('cur.id'),'b');
  const next=deferred(),other=harness(()=>next.promise);
  other.run("cur=DTState.flag({id:'existing',dirty:false,def:{steps:[]}})");
  const reading=other.run("openScript('new')");other.run('touch()');next.resolve({steps:[]});await reading;
  assert.equal(other.run('cur.id'),'existing');assert.equal(other.run('cur.dirty'),true);
});
test('a late script save updates its persisted identity without clearing a newer draft', async () => {
  const reply=deferred(),h=harness(()=>reply.promise);
  h.run("cur=DTState.flag({id:'one',folder:'',name:'one',dirty:true,def:{steps:[]}})");
  const saving=h.run('saveScript()');h.run('touch()');reply.resolve({id:'one',replaced:true});await saving;
  assert.equal(h.run('cur.dirty'),true);assert.equal(h.run('scriptSaving.value'),false);
  const other=deferred(),second=harness(()=>other.promise);
  second.run("cur=DTState.flag({id:'one',folder:'',name:'one',dirty:true,def:{steps:[]}})");
  const old=second.run('saveScript()');second.run("cur=DTState.flag({id:'two',dirty:true,def:{steps:[]}})");
  other.resolve({id:'one'});await old;assert.equal(second.run('cur.id'),'two');assert.equal(second.run('cur.dirty'),true);
});
test('site saves and view previews retain edits made while the request is pending', async () => {
  const reply=deferred(),h=harness(()=>reply.promise);
  h.run("site=DTState.flag({was:'one',name:'one',url:'/',secrets:[],links:[],dirty:true})");
  const saving=h.run('saveSite()');h.run('touchSite()');reply.resolve({site:'one'});await saving;
  assert.equal(h.run('site.dirty'),true);
  const preview=deferred(),v=harness(()=>preview.promise);
  v.run("vw=DTState.flag({name:'one',dirty:false})");v.$('vwSample').value='{}';v.$('vwHtml').value='old';
  const rendering=v.run('preview()');v.run('vw.dirty=true');preview.resolve({html:'old rendered'});await rendering;
  assert.equal(v.$('vwPrev').srcdoc,undefined);
});
