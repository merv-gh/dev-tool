// Ephemeral transport-neutral events. Ownership is always inherited from access context.
const crypto=require('node:crypto'),A=require('./access');
const MAX_EVENTS=100,MAX_BYTES=262144,MAX_PAYLOAD=16384,MAX_CHANNELS=500,TTL=15*60*1000,MAX_LISTENERS=20;
const channels=new Map(),invalid=message=>Object.assign(Error(message),{code:'DT_ARGUMENT_INVALID',statusCode:400});
function channel(value){if(typeof value!=='string'||value.length>240||!/^[a-z][a-z0-9_.:-]*$/.test(value))throw invalid('Invalid event channel');return value;}
function type(value){if(typeof value!=='string'||value.length>100||!/^[a-z][a-z0-9_.:-]*$/.test(value))throw invalid('Invalid event type');return value;}
function authorize(name){channel(name);if(name.startsWith('page:')){const parts=name.split(':');if(parts.length!==4||!['shared','private'].includes(parts[1]))throw invalid('Invalid page event channel');A.checkTool('ui_page');require('./ui-pages').get(parts[2],parts[1],parts[3]);}return name;}
async function access(name){authorize(name);const tool=name.startsWith('page:')?'ui_page':'ui_event';A.checkTool(tool);if(!(await require('./tools').schemas()).some(t=>t.name===tool))throw Object.assign(Error('UI events are unavailable for this credential'),{code:'DT_ACCESS_DENIED',statusCode:403});return name;}
function state(name){authorize(name);const now=Date.now(),key=A.current().scopeKey+'\0'+name;for(const [k,s]of channels)if(!s.listeners.size&&now-s.used>TTL)channels.delete(k);let s=channels.get(key);if(!s){if(channels.size>=MAX_CHANNELS){const old=[...channels].filter(([,v])=>!v.listeners.size).sort((a,b)=>a[1].used-b[1].used)[0];if(old)channels.delete(old[0]);else throw Object.assign(Error('UI event channel budget reached'),{code:'DT_BUSY',statusCode:429});}s={name,epoch:crypto.randomBytes(12).toString('hex'),seq:0,bytes:0,events:[],listeners:new Set(),used:now};channels.set(key,s);}s.used=now;return s;}
const cursor=s=>s.epoch+'.'+s.seq;
function publish(name,eventType,data={}){
 type(eventType);if(!data||typeof data!=='object'||Array.isArray(data))throw invalid('Event data must be an object');let clean;try{clean=require('./redact').clean(JSON.parse(JSON.stringify(data)));}catch{throw invalid('Event data must be JSON');}const size=Buffer.byteLength(JSON.stringify(clean));if(size>MAX_PAYLOAD)throw invalid('Event payload exceeds 16 KiB');
 const s=state(name),event={id:s.epoch+'.'+(++s.seq),type:eventType,data:clean,at:new Date().toISOString()},bytes=Buffer.byteLength(JSON.stringify(event));s.events.push(event);s.bytes+=bytes;
 while(s.events.length>MAX_EVENTS||s.bytes>MAX_BYTES){s.bytes-=Buffer.byteLength(JSON.stringify(s.events.shift()));}for(const listener of [...s.listeners])try{listener(event);}catch{}return event;
}
function replay(name,after){const s=state(name);if(after===undefined||after==='')return {cursor:cursor(s),reset:false,events:[]};if(typeof after!=='string'||after.length>80)throw invalid('Invalid reconnect cursor');const match=after.match(/^([a-f0-9]{24})\.(\d+)$/),seq=Number(match?.[2]);if(!match||match[1]!==s.epoch||!Number.isSafeInteger(seq)||seq>s.seq||seq<(s.events[0]?Number(s.events[0].id.split('.')[1])-1:s.seq))return {cursor:cursor(s),reset:true,events:[]};return {cursor:cursor(s),reset:false,events:s.events.filter(e=>Number(e.id.split('.')[1])>seq)};}
function subscribe(name,listener){if(typeof listener!=='function')throw invalid('An event listener is required');const s=state(name);if(s.listeners.size>=MAX_LISTENERS)throw Object.assign(Error('Too many event subscribers in this chat'),{code:'DT_BUSY',statusCode:429});s.listeners.add(listener);return()=>{s.listeners.delete(listener);s.used=Date.now();};}
// Fetch SSE supports authenticated headers and Last-Event-ID without exposing bearer tokens in URLs.
function sse(req,res,{channel:name,after}={}){
 const requested=after??req.headers?.['last-event-id'],backlog=replay(name,requested);let closed=false,heartbeat,remove=()=>{},buffered=0;
 const close=()=>{if(closed)return;closed=true;clearInterval(heartbeat);remove();req.off?.('aborted',close);res.off?.('close',close);res.end();};
 const write=text=>{if(closed)return;buffered=Number(res.writableLength)||0;if(buffered+Buffer.byteLength(text)>MAX_BYTES){close();return;}try{res.write(text);}catch{close();}};
 remove=subscribe(name,event=>write('id: '+event.id+'\nevent: ui\ndata: '+JSON.stringify(event)+'\n\n'));
 res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-store','connection':'keep-alive','x-accel-buffering':'no','x-content-type-options':'nosniff'});
 // Replay is computed before registration, synchronously: there is no async gap to lose a signal.
 write('event: ready\ndata: '+JSON.stringify({cursor:backlog.events.length?requested:backlog.cursor,reset:backlog.reset})+'\n\n');for(const e of backlog.events)write('id: '+e.id+'\nevent: ui\ndata: '+JSON.stringify(e)+'\n\n');
 if(!closed){heartbeat=setInterval(()=>write(': heartbeat\n\n'),20000);heartbeat.unref?.();req.once?.('aborted',close);res.once?.('close',close);}return close;
}
function tool(a){switch(a.action){case 'read':return replay(a.channel,a.after);case 'publish':if(String(a.type).startsWith('ui.'))throw invalid('ui.* event names are reserved for backend lifecycle signals');return publish(a.channel,a.type,a.data);default:throw invalid('Choose publish or read');}}
module.exports={publish,replay,subscribe,sse,tool,authorize,access,channel,type,MAX_EVENTS,MAX_BYTES,MAX_PAYLOAD};
