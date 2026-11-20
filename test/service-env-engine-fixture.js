// Docker protocol fixture, not a Docker fidelity claim. Application containers run real Node processes.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const E=require('../lib/service-env-engine');
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
function create(root){const containers=new Map(),volumes=new Map(),networks=new Map(),calls=[];let missing=false,failCleanup=false;
  const notFound=()=>{throw Object.assign(Error('not found'),{statusCode:404});};
  const get=id=>containers.get(id)||[...containers.values()].find(c=>c.Id===id)||notFound();
  async function request(method,route,body){calls.push({method,route,body});const u=new URL(route,'http://engine'),parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if(parts[0]==='images'&&parts[2]==='json'){if(missing)notFound();return{Id:'sha256:'+crypto.createHash('sha256').update(parts[1]).digest('hex')};}
    if(parts[0]==='images'&&parts[1]==='create'){missing=false;return'{}\n';}
    if(parts[0]==='networks'){if(method==='POST'&&parts[1]==='create'){networks.set(body.Name,{Name:body.Name,Labels:body.Labels,Containers:{}});return{Id:body.Name};}const n=networks.get(parts[1])||notFound();if(method==='DELETE'){if(failCleanup)throw Error('Network cleanup denied');networks.delete(parts[1]);return'';}return n;}
    if(parts[0]==='volumes'){if(method==='POST'){const dir=path.join(root,body.Name);fs.mkdirSync(dir,{recursive:true});const v={Name:body.Name,Labels:body.Labels,dir};volumes.set(body.Name,v);return v;}const v=volumes.get(parts[1])||notFound();if(method==='DELETE'){volumes.delete(parts[1]);fs.rmSync(v.dir,{recursive:true,force:true});return'';}return v;}
    if(parts[0]==='containers'&&parts[1]==='create'){const name=u.searchParams.get('name'),m={Id:crypto.randomBytes(8).toString('hex'),name,Config:body,State:{Running:false,ExitCode:0},NetworkSettings:{Ports:{},Networks:{}},output:''};containers.set(name,m);return{Id:m.Id};}
    if(parts[0]==='containers'){const m=get(parts[1]);if(parts[2]==='json')return m;if(parts[2]==='archive'){const buffers=[];for await(const b of body)buffers.push(b);const bytes=Buffer.concat(buffers),volume=volumes.get(m.Config.HostConfig.Mounts[0].Source);for(let p=0;p+512<=bytes.length;){const head=bytes.subarray(p,p+512),name=head.subarray(0,100).toString().replace(/\0.*$/,''),size=parseInt(head.subarray(124,136).toString().replace(/\0.*$/,''),8)||0;if(!name)break;const target=path.join(volume.dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});if(head[156]===53)fs.mkdirSync(target,{recursive:true});else fs.writeFileSync(target,bytes.subarray(p+512,p+512+size));p+=512+Math.ceil(size/512)*512;}return'';}
      if(parts[2]==='start'){m.State.Running=true;if(m.Config.Entrypoint?.[0]==='node'&&m.Config.Cmd?.[0]?.startsWith('/app/')){const v=volumes.get(m.Config.HostConfig.Mounts[0].Source),original=Object.keys(m.Config.ExposedPorts)[0],port=await freePort();m.NetworkSettings.Ports[original]=[{HostIp:'127.0.0.1',HostPort:String(port)}];const env=Object.fromEntries(m.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));const child=spawn(process.execPath,[path.join(v.dir,m.Config.Cmd[0].slice(5))],{cwd:v.dir,env:{PATH:process.env.PATH,...env,PORT:String(port)},stdio:['ignore','pipe','pipe']});m.child=child;child.stdout.on('data',b=>m.output+=b.toString());child.stderr.on('data',b=>m.output+=b.toString());m.closed=new Promise(r=>child.once('close',code=>{m.State.Running=false;m.State.ExitCode=code;r();}));}return'';}
      if(parts[2]==='logs')return Buffer.from(m.output);
      if(method==='DELETE'){if(failCleanup)throw Error('Container cleanup denied');if(m.child){m.child.kill('SIGTERM');await m.closed;}containers.delete(m.name);return'';}
    }
    throw Error('Unimplemented fixture operation '+method+' '+route);
  }
  return{request,archive:E.archive,logs:E.logs,exec:async()=>'',containers,volumes,networks,calls,setMissing:v=>missing=v,setCleanupFailure:v=>failCleanup=v,async close(){for(const c of containers.values())if(c.child){c.child.kill();await c.closed;}containers.clear();}};
}
module.exports={create,freePort};
