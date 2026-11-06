// DTMAP1: shared UTF-8 string table + fixed uint32 node/edge columns. No graph JSON.
// Browser and Node read the same bytes; objects are materialized only for selected rows.
(function(root) {
  const NC = 8, EC = 7, META = 8, MAGIC = 'DTMAP1\0\0';
  const S = typeof module === 'object' && module.exports ? require('./state-machine') : root.DTState;
  const decoding = S.define('P02.binary', 'header', { header: ['tables', 'failed'], tables: ['ready', 'failed'], ready: [], failed: [] }, ['ready','failed']);
  function decode(input) {
    const lifecycle=S.create(decoding);
    try {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), utf = new TextDecoder();
    if (b.length < 24 || utf.decode(b.subarray(0,8)) !== MAGIC) throw new Error('Invalid map binary');
    const count = dv.getUint32(8,true), edgeCount = dv.getUint32(12,true), strings = dv.getUint32(16,true), bytes = dv.getUint32(20,true);
    const stringStart = 24 + (strings + 1) * 4, rowsStart = (stringStart + bytes + 3) & ~3;
    if (strings < META || count > 2000000 || edgeCount > 10000000 || rowsStart < 0 || rowsStart + (count * NC + edgeCount * EC) * 4 !== b.length) throw new Error('Invalid map lengths');
    lifecycle.to('tables');
    const cached = new Map();
    function str(i) {
      if (i >= strings) throw new Error('Invalid map string reference');
      if (cached.has(i)) return cached.get(i);
      const a = dv.getUint32(24+i*4,true), z = dv.getUint32(28+i*4,true);
      if (a > z || z > bytes) throw new Error('Invalid map string offsets');
      const s = utf.decode(b.subarray(stringStart+a,stringStart+z)); cached.set(i,s); return s;
    }
    const value = (row,col,edge=false) => dv.getUint32(rowsStart + (edge ? count*NC+row*EC+col : row*NC+col)*4,true);
    const node = i => { if(i<0||i>=count) throw new Error('Unknown map row'); const v = Array.from({length:NC},(_,k)=>str(value(i,k))); return {id:v[0],kind:v[1],label:v[2],scope:v[3],detail:v[4],repo:v[5],revision:v[6],source:v[7]}; };
    const edge = i => { if(i<0||i>=edgeCount) throw new Error('Unknown map edge'); const from=value(i,0,true),to=value(i,1,true); if(from>=count||to>=count) throw new Error('Invalid map endpoints'); return {from,to,kind:str(value(i,2,true)),where:str(value(i,3,true)),layer:str(value(i,4,true)),evidence:str(value(i,5,true)),certainty:str(value(i,6,true))}; };
    const result={ count, edgeCount, node, edge, value, str, bytes:b, meta:Array.from({length:META},(_,i)=>str(i)) };
    lifecycle.to('ready'); return result;
    } catch(error){if(!lifecycle.terminal)lifecycle.to('failed');throw error;}
  }
  function encode(nodes, edges, meta=[]) {
    const utf = new TextEncoder(), strings = Array.from({length:META},(_,i)=>String(meta[i]??'')), ids = new Map();
    strings.forEach((s,i)=>{if(!ids.has(s))ids.set(s,i);});
    const intern = s => {s=String(s??'');if(!ids.has(s)){ids.set(s,strings.length);strings.push(s);}return ids.get(s);};
    const index = new Map(nodes.map((n,i)=>[n.id,i]));
    const nrows = nodes.map(n=>['id','kind','label','scope','detail','repo','revision','source'].map(k=>intern(n[k])));
    const erows = edges.map(e=>{const a=index.get(e.from),b=index.get(e.to);if(a===undefined||b===undefined)throw new Error('Dangling map edge');return [a,b,...['kind','where','layer','evidence','certainty'].map(k=>intern(e[k]))];});
    const chunks=strings.map(s=>utf.encode(s)), bytes=chunks.reduce((n,b)=>n+b.length,0), start=24+(strings.length+1)*4, rows=(start+bytes+3)&~3;
    const out = new Uint8Array(rows+(nodes.length*NC+edges.length*EC)*4), dv=new DataView(out.buffer);
    out.set(utf.encode(MAGIC));[nodes.length,edges.length,strings.length,bytes].forEach((n,i)=>dv.setUint32(8+i*4,n,true));
    let offset=0;chunks.forEach((b,i)=>{dv.setUint32(24+i*4,offset,true);out.set(b,start+offset);offset+=b.length;});dv.setUint32(24+strings.length*4,offset,true);
    let at=rows;for(const row of [...nrows,...erows])for(const n of row){dv.setUint32(at,n,true);at+=4;}return out;
  }
  const api={decode,encode,NC,EC,decoding}; if(typeof module==='object'&&module.exports)module.exports=api;else root.dtMapFormat=api;
})(globalThis);
