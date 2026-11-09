// Portable before/after Java corpus. Expected behavior is checked outside the indexed sources.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const FILE='src/example/Scenarios.java',LIB='src/internal/AbstractHandler.java',SERVICE='src/example/PaymentService.java';
function sources(after=false){return{
 [FILE]:`package example;
import java.util.List;
public class Scenarios {
 public int conditional(int amount) {
  int result=0;
  if (amount ${after?'>=':'>'} 0) result=amount+1;
  Sink.accept("conditional",result);
  return result;
 }
 public int loop(int limit) {
  int total=0;
  for(int i=0; i ${after?'<=':'<'} limit; i++) {
   if(i==2) continue;
   total += i;
  }
  Sink.accept("loop",total);
  return total;
 }
 public int filtered(List<Integer> values) {
  int total=values.stream().filter(x -> x ${after?'>=':'>'} 0).mapToInt(x -> 1).sum();
  Sink.accept("filtered",total);
  return total;
 }
 public int mapped(List<Integer> values) {
  int total=values.stream().mapToInt(x -> x * ${after?'3':'2'}).sum();
  Sink.accept("mapped",total);
  return total;
 }
 public int fanout(int amount) {
${Array.from({length:28},(_,i)=>`  if(amount==${i}) Sink.accept("fanout-${i}",amount ${after&&i===27?'+ 9':'+ 1'});`).join('\n')}
  return amount;
 }
 public int stable(int amount) { Sink.accept("stable",amount); return amount; }
}
`,
 'src/example/Sink.java':`package example; public class Sink { public static int last; public static int calls; public static void accept(String key,int value){last=value;calls++;} }
`,
 [SERVICE]:`package example;
@org.springframework.stereotype.Service
public class PaymentService extends internal.AbstractHandler {
 @Override protected int transform(int amount) { return amount - 2; }
}
`,
 'src/example/OtherService.java':`package example; public class OtherService extends internal.AbstractHandler { @Override protected int transform(int amount){return amount * 7;} }
`,
 'src/org/springframework/stereotype/Service.java':'package org.springframework.stereotype; public @interface Service {}\n'
};}
function library(after=false){return{[LIB]:`package internal;
public abstract class AbstractHandler extends ValidatingHandler {
 public int handle(int amount) {
  if (!allowed(amount)) return -1;
  int adjusted=amount ${after?'- 5':'+ 5'};
  int value=transform(adjusted);
  example.Sink.accept("inherited",value);
  return value;
 }
 protected abstract int transform(int amount);
}
`,'src/internal/ValidatingHandler.java':`package internal; public abstract class ValidatingHandler { protected boolean allowed(int amount) { return amount ${after?'>':'>='} 0; } }
`};}
function write(root,files){for(const[file,code]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),code);}}
function git(root,args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:'2026-11-09T00:00:00Z',GIT_COMMITTER_DATE:'2026-11-09T00:00:00Z'},stdio:['ignore','pipe','pipe']}).trim();}
function repo(root,before,after){fs.mkdirSync(root,{recursive:true});git(root,['init','--quiet','--initial-branch=main']);const commit=(files,message)=>{write(root,files);git(root,['add','.']);git(root,['-c','user.name=Flow stress fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m',message]);return git(root,['rev-parse','HEAD']);};const a=commit(before,'Before behavior');git(root,['switch','--quiet','-c','feature/change']);const b=commit(after,'Change behavior');return{root,before:a,after:b};}
function create(root){return{service:repo(path.join(root,'service'),sources(false),sources(true)),library:repo(path.join(root,'library'),library(false),library(true))};}
const cases=[
 {id:'conditional',entry:'conditional',parameter:'amount',sink:'accept',file:FILE,expected:['amount > 0','amount >= 0'],change:'Branch boundary changes for zero'},
 {id:'loop',entry:'loop',parameter:'limit',sink:'accept',file:FILE,expected:['i < limit','i <= limit'],change:'Loop bound changes the accumulated value; continue bypass is retained'},
 {id:'stream-filter',entry:'filtered',parameter:'values',sink:'accept',file:FILE,expected:['x > 0','x >= 0'],change:'A lazy stream filter now admits zero'},
 {id:'stream-map',entry:'mapped',parameter:'values',sink:'accept',file:FILE,expected:['x * 2','x * 3'],change:'A lambda transformation changes each emitted contribution'},
 {id:'inherited-library',entry:'handle',receiver:'example.PaymentService',parameter:'amount',sink:'accept',file:LIB,expected:['amount + 5','amount - 5','amount >= 0','amount > 0'],change:'Unchanged Spring service inherits a changed two-level library template'},
 {id:'fanout-budget',entry:'fanout',parameter:'amount',sink:'accept',file:FILE,expected:['amount + 1','amount + 9'],change:'A late sink changes beyond the selected path count; coverage must stay bounded'},
 {id:'unchanged',entry:'stable',parameter:'amount',sink:'accept',file:FILE,expected:[],change:'Unchanged control prevents noisy false change claims'}
];
function grade(service,lib,after){const os=require('os'),out=fs.mkdtempSync(path.join(os.tmpdir(),'dt-stress-oracle-'));try{
 const probe=`import example.*; import java.util.*; public class Probe {public static void main(String[] a){ Scenarios s=new Scenarios(); if(s.conditional(0)!=${after?1:0})throw new AssertionError("conditional"); if(s.loop(4)!=${after?8:4})throw new AssertionError("loop"); if(s.filtered(List.of(-1,0,3))!=${after?2:1})throw new AssertionError("filter"); if(s.mapped(List.of(2,4))!=${after?18:12})throw new AssertionError("map"); PaymentService p=new PaymentService(); if(p.handle(10)!=${after?3:13})throw new AssertionError("library"); if(p.handle(0)!=${after?-1:3})throw new AssertionError("inherited guard"); s.fanout(27); if(Sink.last!=${after?36:28})throw new AssertionError("late sink"); if(s.stable(8)!=8)throw new AssertionError("stable"); System.out.println("7 scenarios passed");}}`;
 fs.writeFileSync(path.join(out,'Probe.java'),probe);const files=[...Object.keys(sources()).map(f=>path.join(service,f)),...Object.keys(library()).map(f=>path.join(lib,f)),path.join(out,'Probe.java')];execFileSync('javac',['-encoding','UTF-8','-d',out,...files],{stdio:'pipe',timeout:30000});return execFileSync('java',['-cp',out,'Probe'],{encoding:'utf8',timeout:10000}).trim();}finally{fs.rmSync(out,{recursive:true,force:true});}}
module.exports={create,sources,library,cases,grade,FILE,LIB,SERVICE,git};
