// A controllable Jenkins + Bitbucket DC REST environment. No outside requests.
const http=require('node:http');
const SHA='a'.repeat(40),NEXT='b'.repeat(40);
async function start(){
 const state={sha:SHA,buildSha:SHA,result:'FAILURE',building:false,queueReady:true,approval:'NEEDS_WORK',reviewed:SHA,version:'8.19.0',draft:true,created:false,posts:0,reads:0,activities:[],checks:null,report:true,dropPost:false,incomplete:false,requests:[],log:'Starting\n'+('данные 😀\n'.repeat(5000))+'secret-jenkins-token\nFAILED OrderTest\n'};
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'),p=u.pathname;let body='';for await(const b of req)body+=b;state.requests.push({method:req.method,path:p,query:u.search,authorization:req.headers.authorization,body});
  if(state.respond&&await state.respond(req,res,u,body))return;
  const send=(x,status=200,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(x));};
  const root='/jenkins',job=root+'/job/team/job/orders/job/PR-42/';
  if(p.startsWith(root)){if(req.headers.authorization!=='Basic '+Buffer.from('builder:secret-jenkins-token').toString('base64'))return send({},401);
   if(p.endsWith('/build')||p.endsWith('/buildWithParameters')){state.posts++;if(state.dropPost)return req.socket.destroy();return send({},201,{location:root+'/queue/item/7/'});}
   if(p===root+'/api/json'||p===root+'/job/team/api/json')return send({jobs:[{name:'orders',fullName:'team/orders',_class:'com.cloudbees.hudson.plugins.folder.Folder'}]});
   if(p===root+'/queue/item/7/api/json')return send({id:7,task:{url:state.base+job},...(state.queueReady?{executable:{number:17}}:{why:'Waiting for executor'})});
   if(p.endsWith('/logText/progressiveText')){const b=Buffer.from(state.log),offset=Number(u.searchParams.get('start')||0);res.writeHead(200,{'x-text-size':b.length,'x-more-data':String(state.building),'content-type':'text/plain;charset=utf-8'});return res.end(req.method==='HEAD'?undefined:b.subarray(offset));}
   if(p.endsWith('/testReport/api/json'))return state.report?send({passCount:10,failCount:state.result==='SUCCESS'?0:1,skipCount:1,suites:[{name:'OrderTest',cases:state.result==='SUCCESS'?[]:[{name:'retainsOrderId',className:'OrderTest',status:'FAILED',errorDetails:'Expected 42, got null; secret-jenkins-token'}]}]}):send({},404);
   if(/\/\w+\/api\/json$/.test(p)){state.reads++;return send({number:17,building:state.building,result:state.building?null:state.result,actions:state.buildSha?[{lastBuiltRevision:{SHA1:state.buildSha}}]:[{parameters:[{name:'SHA',value:state.sha}]}]});}
   return send({},404);
  }
  if(req.headers.authorization!=='Bearer secret-bitbucket-token')return send({},401);
  if(p==='/rest/api/1.0/application-properties')return send({version:state.version});
  const pr=()=>({id:42,title:'Preserve order identity',draft:state.draft,state:'OPEN',fromRef:{id:'refs/heads/feature/order-id',latestCommit:state.sha},toRef:{id:'refs/heads/main'},reviewers:[{user:{name:'reviewer'},status:state.approval,lastReviewedCommit:state.reviewed}],links:{self:[{href:state.base+'/projects/SHOP/repos/orders/pull-requests/42'}]}});
  if(p.endsWith('/pull-requests')){
   if(req.method==='POST'){state.posts++;state.created=true;const value=JSON.parse(body);state.draft=value.draft;return send(pr(),201);}
   return send({values:state.created?[pr()]:[],isLastPage:!state.incomplete});
  }
  if(p.endsWith('/pull-requests/42/activities'))return send({values:state.activities,isLastPage:true});
  if(p.endsWith('/pull-requests/42')){state.reads++;const value=pr();state.onPrRead?.(state);return send(value);}
  if(p.startsWith('/rest/build-status/1.0/commits/'))return send({values:state.checks||[{key:'orders-ci',state:state.building?'INPROGRESS':state.result==='SUCCESS'?'SUCCESSFUL':'FAILED',url:state.base+job+'17/',updatedDate:1}],isLastPage:true});
  send({},404);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));state.base='http://127.0.0.1:'+server.address().port;
 return {state,server,config:{envs:{dev:{}},scripts:{starters:false},jenkins:{url:state.base+'/jenkins',user:'builder',token:'secret-jenkins-token',allowBuild:true,allowedJobs:['team/*']},bitbucket:{url:state.base,token:'secret-bitbucket-token',allowDraftCreate:true}},close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
module.exports={start,SHA,NEXT};
