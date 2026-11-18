// One authenticated, multiplexed command/event connection per UI. Commands are never replayed.
const {WebSocketServer,WebSocket}=require('ws');
const A=require('./access'),C=require('./config'),E=require('./execution');
function attach(server,{errorPayload}){
 const wss=new WebSocketServer({noServer:true,maxPayload:4*1048576,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{
  try{
   if(new URL(req.url,'http://local').pathname!=='/api/tool-events'){socket.destroy();return;}
   if(wss.clients.size>=256)throw Error('Connection capacity reached');
   require('./security').enforce(req);if(req.headers.origin&&!require('./security').originAllowed(req.headers.origin,C.getServer()))throw Error('Browser origin is not allowed');
   wss.handleUpgrade(req,socket,head,ws=>connect(ws,req));
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
 });
 function connect(ws,req){
  const pending=new Map(),subscriptions=new Map();let alive=true;
  const send=frame=>{if(ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>8*1048576){ws.terminate();return;}ws.send(JSON.stringify(frame));};
  const identity=frame=>{
   const headers={...req.headers};for(const key of ['authorization','x-dt-story','x-dt-principal','x-openwebui-chat-id','x-chat-id'])if(frame.headers?.[key]!==undefined){if(typeof frame.headers[key]!=='string'||frame.headers[key].length>8192)throw Error('Invalid command context');headers[key]=frame.headers[key];}
   const request={headers,method:'POST',socket:req.socket};require('./security').enforce(request);const owner=A.identity(request);if(!owner)throw Object.assign(Error('Authentication is required'),{statusCode:403});return owner;
  };
  const heartbeat=setInterval(()=>{if(!alive)return ws.terminate();alive=false;ws.ping();},20000);heartbeat.unref();ws.on('pong',()=>alive=true);
  ws.on('message',raw=>{
   let frame;try{try{frame=JSON.parse(raw.toString());}catch{throw Error('Invalid command JSON');}if(!frame||typeof frame.id!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(frame.id))throw Error('Invalid command id');const owner=identity(frame);
    if(frame.type==='cancel'){const task=pending.get(frame.id);if(task)A.run(owner,()=>A.assertOwner(task.owner));task?.controller.abort('Cancelled by UI');return;}
    if(frame.type==='unsubscribe'){const s=subscriptions.get(frame.id);if(s){A.run(owner,()=>A.assertOwner(s.owner));s.remove();subscriptions.delete(frame.id);}return;}
    if(pending.has(frame.id)||subscriptions.has(frame.id))throw Error('Command id is already active');
    if(pending.size>=16||subscriptions.size>=16)throw Object.assign(Error('Too many active operations in this connection'),{statusCode:429});
    if(frame.type==='subscribe'){
     const reserved={owner,remove:()=>{}};subscriptions.set(frame.id,reserved);
     A.run(owner,async()=>{try{const B=require('./ui-events');await B.access(frame.channel);if(ws.readyState!==WebSocket.OPEN||subscriptions.get(frame.id)!==reserved)return;const backlog=B.replay(frame.channel,frame.after);reserved.remove=B.subscribe(frame.channel,event=>send({id:frame.id,type:'event',event}));send({id:frame.id,type:'subscribed',...backlog});}catch(e){subscriptions.delete(frame.id);send({id:frame.id,type:'error',status:e.statusCode||400,...errorPayload(e)});}});return;
    }
    if(frame.type!=='call'||!/^\w+$/.test(frame.tool||''))throw Error('Choose call, cancel, subscribe or unsubscribe');
    const controller=new AbortController(),started=Date.now(),deadline=Math.max(1000,Math.min(1800000,Number(frame.timeoutMs)||900000));
    const timer=setTimeout(()=>controller.abort('UI command deadline exceeded; inspect retained evidence before retrying'),deadline);timer.unref();pending.set(frame.id,{controller,owner});send({id:frame.id,type:'accepted',at:new Date().toISOString()});
    setImmediate(()=>A.run(owner,()=>require('./telemetry').withCarrier(frame.headers?.traceparent?{traceparent:frame.headers.traceparent}:null,()=>require('./tool-events').run(data=>send({id:frame.id,type:'progress',...data}),async()=>{
     try{const result=await require('./tools').call(frame.tool,frame.args||{},{source:'ui-websocket',signal:controller.signal});send({id:frame.id,type:'result',status:200,result,ms:Date.now()-started});}
     catch(e){send({id:frame.id,type:'error',status:e.statusCode||400,...errorPayload(e),ms:Date.now()-started});}
     finally{clearTimeout(timer);pending.delete(frame.id);}
    }))));
   }catch(e){send({id:frame?.id||'invalid',type:['cancel','unsubscribe'].includes(frame?.type)?'control-error':'error',status:e.statusCode||400,...errorPayload(e)});}
  });
  ws.on('error',()=>{});
  ws.on('close',()=>{clearInterval(heartbeat);for(const p of pending.values())p.controller.abort('UI connection closed; outcome may be unknown');for(const s of subscriptions.values())s.remove();subscriptions.clear();});
  send({type:'ready',protocol:'dt.tools/v1'});
 }
 const close=server.close.bind(server);server.close=(...args)=>{for(const ws of wss.clients)ws.terminate();return close(...args);};
 server.once('close',()=>wss.close());return wss;
}
module.exports={attach};
