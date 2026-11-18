(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.DTToolSocket=api.create({WebSocket:root.WebSocket,fetch:root.fetch.bind(root),location:root.location,emit:(type,detail)=>root.dispatchEvent(new CustomEvent(type,{detail}))});root.fetch=root.DTToolSocket.fetch;}})(globalThis,function(){
 'use strict';
 function create({WebSocket:Socket,fetch:original,location,emit=()=>{}}){
  let socket,opening,sequence=0,reconnect;const pending=new Map(),subscriptions=new Map(),stats={sent:0,completed:0,failed:0,active:0};
  const notify=state=>emit('dt:tool-connection',{state});
  function connection(){
   if(socket?.readyState===1)return Promise.resolve(socket);if(opening)return opening;
   if(!Socket)return Promise.reject(Object.assign(Error('WebSocket unavailable'),{beforeSend:true}));
   opening=new Promise((resolve,reject)=>{
    let settled=false;const target=new URL('/api/tool-events',location.origin);target.protocol=target.protocol==='https:'?'wss:':'ws:';let ws;try{ws=socket=new Socket(target.href);}catch(e){reject(Object.assign(e,{beforeSend:true}));return;}
    const timer=setTimeout(()=>{if(!settled){settled=true;ws.close();reject(Object.assign(Error('WebSocket connection timed out'),{beforeSend:true}));}},1500);
    notify('connecting');
    ws.onopen=()=>{clearTimeout(timer);settled=true;notify('connected');resolve(ws);};
    ws.onerror=()=>{if(!settled){settled=true;clearTimeout(timer);reject(Object.assign(Error('WebSocket unavailable'),{beforeSend:true}));}};
    ws.onclose=()=>{clearTimeout(timer);opening=null;if(socket===ws)socket=null;notify('disconnected');if(!settled){settled=true;reject(Object.assign(Error('WebSocket unavailable'),{beforeSend:true}));}for(const task of [...pending.values()])task.reject(Object.assign(Error('Live connection lost; request outcome may be unknown. Check retained history before retrying.'),{transport:true}));if(subscriptions.size){for(const s of subscriptions.values())s.onState('reconnecting');clearTimeout(reconnect);reconnect=setTimeout(()=>{for(const s of subscriptions.values())attachSubscription(s);},1000);}};
    ws.onmessage=event=>{let frame;try{frame=JSON.parse(event.data);}catch{return;}const subscription=subscriptions.get(frame.id);if(subscription){if(frame.type==='event'){subscription.after=frame.event.id;subscription.onEvent(frame.event);}else if(frame.type==='subscribed'){subscription.after=frame.cursor||subscription.after;subscription.onState('connected');subscription.onReady(frame);for(const e of frame.events||[]){subscription.after=e.id;subscription.onEvent(e);}}else if(frame.type==='error'){subscriptions.delete(frame.id);subscription.onState('unavailable');}return;}const task=pending.get(frame.id);if(!task)return;
     if(frame.type==='accepted'||frame.type==='progress'){emit('dt:tool-progress',{id:frame.id,tool:task.tool,...frame});return;}
     if(frame.type==='result'||frame.type==='error'){stats[frame.type==='result'?'completed':'failed']++;task.resolve(new Response(JSON.stringify(frame.type==='result'?{result:frame.result}:frame),{status:frame.status||400,headers:{'content-type':'application/json','x-dt-transport':'websocket'}}));}
    };
   }).finally(()=>opening=null);return opening;
  }
  async function toolFetch(input,options={}){
   const url=new URL(typeof input==='string'?input:input.url,location.origin),name=url.pathname.match(/^\/api\/tool\/([a-z][a-z0-9_]*)$/)?.[1];
   if(url.origin!==location.origin||options.credentials==='omit'||!name||String(options.method||'GET').toUpperCase()!=='POST'||typeof options.body!=='string')return original(input,options);
   let args;try{args=JSON.parse(options.body);}catch{return original(input,options);}
   const requestHeaders=new Headers(options.headers),headers={};for(const key of ['authorization','x-dt-story','x-dt-principal','x-openwebui-chat-id','x-chat-id','traceparent'])if(requestHeaders.has(key))headers[key]=requestHeaders.get(key);
   const timeoutMs=name==='api_request_replay'?Math.max(1000,Math.min(120000,args.timeoutMs||30000))+10000:name==='api_instances_refresh'?15000:name==='api_client_catalog'?30000:900000;
   if(options.signal?.aborted)throw options.signal.reason||new DOMException('Aborted','AbortError');
   let ws;try{ws=await connection();}catch(e){if(!e.beforeSend)throw e;notify('http-fallback');return original(input,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(timeoutMs)])});}
   if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
   return new Promise((resolve,reject)=>{
    const id='cmd_'+(++sequence),cancel=()=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'cancel',id,headers}));};
    const finish=fn=>value=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);pending.delete(id);stats.active=pending.size;fn(value);};
    const abort=()=>{cancel();task.reject(new DOMException('Stopped waiting; outcome may be unknown','AbortError'));};
    const timer=setTimeout(()=>{cancel();task.reject(Object.assign(Error('Operation timed out. Check retained evidence before retrying; no request was replayed.'),{transport:true}));},timeoutMs+1000);
    const task={tool:name,resolve:finish(resolve),reject:finish(reject)};pending.set(id,task);stats.active=pending.size;options.signal?.addEventListener('abort',abort,{once:true});
    try{ws.send(JSON.stringify({type:'call',id,tool:name,args,headers,timeoutMs}));stats.sent++;}catch(error){task.reject(Object.assign(error,{transport:true}));}
   });
  }
  function attachSubscription(s){connection().then(ws=>{if(!subscriptions.has(s.id)||s.socket===ws)return;s.socket=ws;ws.send(JSON.stringify({type:'subscribe',id:s.id,channel:s.channel,after:s.after,headers:s.headers}));}).catch(()=>{if(subscriptions.delete(s.id))s.onState('unavailable');});}
  function subscribe({channel,headers={},after='',onEvent=()=>{},onReady=()=>{},onState=()=>{},signal}){
   headers=Object.fromEntries(new Headers(headers));
   const id='sub_'+(++sequence),s={id,channel,headers,after,onEvent,onReady,onState};subscriptions.set(id,s);onState('connecting');
   const close=()=>{subscriptions.delete(id);if(s.socket?.readyState===1)s.socket.send(JSON.stringify({type:'unsubscribe',id,headers}));signal?.removeEventListener('abort',close);onState('closed');};signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();else attachSubscription(s);return {close,get cursor(){return s.after;}};
  }
  return {fetch:toolFetch,subscribe,stats,close:()=>{clearTimeout(reconnect);subscriptions.clear();socket?.close();}};
 }
 return {create};
});
