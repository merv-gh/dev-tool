// User corrections are independent, environment-scoped binary documents.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),F=require('../web/map-format');
const ROOT=path.join(require('./config').HOME,'maps','adjustments');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const safe=s=>{if(typeof s!=='string'||!/^[\w.-]{1,160}$/.test(s)||s==='.'||s==='..')throw Error('Invalid adjustment id/environment');return s;};
const directory=env=>path.join(require('./access').scopedDirectory(ROOT),safe(env));
function files(env){try{return fs.readdirSync(directory(env)).filter(f=>f.endsWith('.dtm')).sort().map(f=>path.join(directory(env),f));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
function list(env){const adjustments=[],errors=[];for(const file of files(env))try{const bytes=fs.readFileSync(file),g=F.decode(bytes);if(g.meta[0]!==env)throw Error('Environment mismatch');adjustments.push({id:g.meta[2],title:g.meta[3],evidence:g.meta[4],revision:hash(bytes),nodes:Array.from({length:g.count},(_,i)=>g.node(i)),edges:Array.from({length:g.edgeCount},(_,i)=>{const e=g.edge(i);return {...e,from:g.node(e.from).id,to:g.node(e.to).id};})});}catch(e){errors.push({file:path.basename(file),error:e.message});}return {adjustments,errors};}
function save(a,known){
 const lifecycle=require('./state-machine').create(require('./lifecycles').mapEdit);
 try{
 const id=safe(a.id),env=safe(a.env),file=path.join(directory(env),id+'.dtm');
 const previous=fs.existsSync(file)?hash(fs.readFileSync(file)):null;
 if(previous!==null&&a.expected_revision!==previous||previous===null&&a.expected_revision!==undefined&&a.expected_revision!==null)throw Error('Adjustment changed; read map_adjustments and supply expected_revision');
 if(typeof a.evidence!=='string'||!a.evidence.trim()||a.evidence.length>2000)throw Error('A user request or source citation is required as evidence');
 if(!Array.isArray(a.nodes)||a.nodes.length>100||!Array.isArray(a.edges||[])||(a.edges||[]).length>200)throw Error('Adjustment limit: 100 nodes / 200 edges');
 for(const n of a.nodes)for(const field of ['scope','repo','detail'])if(n[field]!==undefined&&(typeof n[field]!=='string'||n[field].length>2000))throw Error('Manual node fields are limited to 2000 characters');
 for(const n of a.nodes)if(n.repo&&!/^[\w.-]+\/[\w.-]+$/.test(n.repo))throw Error('UI repository must be PROJECT/repo');
 if(a.title!==undefined&&(typeof a.title!=='string'||a.title.length>300))throw Error('Correction title is limited to 300 characters');
 const nodes=new Map(),kinds=['service','ui','ui-repository','library','external','prefix'];
 for(const n of a.nodes){if(typeof n.id!=='string'||!n.id||n.id.length>200||!kinds.includes(n.kind)||typeof n.label!=='string'||!n.label.trim()||n.label.length>200)throw Error('Each manual node needs id, kind and label');if(n.kind==='ui'&&!String(n.id).startsWith('ui:')||n.kind==='ui-repository'&&!String(n.id).startsWith('uirepo:'))throw Error('UI deployments and repositories require separate ui:/uirepo: identities');if(known.has(n.id)&&known.get(n.id).kind!==n.kind)throw Error('Cannot change an existing node kind; create a separate UI/repository identity');nodes.set(n.id,{...n,scope:n.scope||env,detail:n.detail||a.evidence,source:'manual:'+id});}
 const edges=[];for(const e of a.edges||[]){for(const ref of [e.from,e.to]){const n=nodes.get(ref)||known.get(ref);if(!n)throw Error('Unknown adjustment endpoint: '+ref);nodes.set(ref,n);}if(e.evidence!==undefined&&(typeof e.evidence!=='string'||e.evidence.length>2000))throw Error('Edge evidence is limited to 2000 characters');if(typeof e.relation!=='string'||!e.relation.trim()||e.relation.length>80)throw Error('Edge relation is required');const ui=n=>['ui','ui-repository'].includes(nodes.get(n).kind);if(!e.suppress&&(ui(e.from)||ui(e.to))&&[e.from,e.to].some(ref=>['kafka','postgres','table','elasticsearch','elk'].includes(nodes.get(ref).kind)))throw Error('UI nodes cannot acquire backend infrastructure edges');edges.push({from:e.from,to:e.to,kind:e.relation,layer:'adjustment:'+id,certainty:e.suppress?'suppressed':'manual',where:a.evidence,evidence:e.evidence||a.evidence});}
 lifecycle.to('checked');
 const bytes=F.encode([...nodes.values()],edges,[env,new Date().toISOString(),id,a.title||id,a.evidence]);fs.mkdirSync(directory(env),{recursive:true});require('./atomic-file').atomicFile(file,bytes,{mode:0o600});lifecycle.to('head-written');lifecycle.to('completed');return {id,env,saved:true,revision:hash(bytes),nodes:nodes.size,edges:edges.length};
 }catch(error){if(!lifecycle.terminal)lifecycle.to('failed');throw error;}
}
function apply(B,env,gaps){const {adjustments,errors}=list(env);for(const e of errors)gaps.push(`Invalid adjustment ${e.file}: ${e.error}`);for(const a of adjustments)for(const n of a.nodes){if(n.source==='manual:'+a.id)B.nodes.set(n.id,n);else if(!B.nodes.has(n.id))gaps.push(`Adjustment ${a.id}: missing ${n.id}`);}
for(const a of adjustments){for(const e of a.edges){if(e.certainty==='suppressed'){for(const [key,existing]of B.edges)if(existing.from===e.from&&existing.to===e.to&&existing.kind===e.kind)B.edges.delete(key);}else if(B.nodes.has(e.from)&&B.nodes.has(e.to))B.edge(e.from,e.to,e.kind,e);}}
}
module.exports={ROOT,files,list,save,apply};
