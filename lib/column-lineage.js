// Conservative SQL column lineage. Evidence is syntax-classified; unsupported constructs remain gaps.
// Positions are retained for exact function/view/source line evidence. No database access is required.
const ID = require('./semantic-identity'), norm = ID.norm;
const RESERVED = new Set('select from join inner left right full outer cross on where group order having limit offset returning set values into update insert delete using as and or not null true false case when then else end begin return perform distinct all union intersect except exists for each row language create function procedure replace view materialized table with recursive over partition by asc desc conflict do only lateral'.split(' '));
const tableIndexes = new WeakMap();
function tokens(sql) {
  const out = [], re = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][\w$]*|:=|::|<=|>=|<>|!=|\S/g;
  let line = 1, last = 0;
  for (const m of String(sql || '').matchAll(re)) { line += sql.slice(last, m.index).split('\n').length - 1; last = m.index; const text = m[0]; if (/^(--|\/\*)/.test(text)) continue; if (out.length >= 20000) { out.truncated = true; break; } out.push({ text, word: /^"/.test(text) ? text.slice(1,-1).replace(/""/g,'"').toLowerCase() : text.toLowerCase(), literal: /^'/.test(text), quoted: /^"/.test(text), line, at: m.index }); }
  return out;
}
function analyze(sql, catalog, { schema, triggerTables = [] } = {}) {
  sql = String(sql || ''); const clipped = sql.length > 256 * 1024;
  if (clipped) sql = sql.slice(0, 256 * 1024);
  const all = tokens(sql), hits = [], gaps = [];
  if (clipped || all.truncated) gaps.push({ kind: 'sql-analysis-limit', line: 1, detail: 'Column analysis is limited to 256 Ki characters and 20000 tokens; remaining SQL was not analyzed.' });
  let tables = catalog._revision ? tableIndexes.get(catalog) : null;
  if (!tables) { tables = new Map((catalog.tables || []).map(t => [ID.qualified(t.schema,t.name), t])); tableIndexes.set(catalog, tables); }
  const resolve = name => { name = norm(name); if (tables.has(name)) return [name]; if (name.includes('.')) return []; const preferred = [schema, 'public'].filter(Boolean).map(s => `${s.toLowerCase()}.${name}`).find(k=>tables.has(k)); return preferred ? [preferred] : [...tables.keys()].filter(k=>k.endsWith(`.${name}`)); };
  let parts = [], cur = [];
  for (const t of all) { if (t.word === ';') { if(cur.length) parts.push(cur); cur=[]; } else cur.push(t); } if(cur.length)parts.push(cur);
  const addGap = (kind, line, detail) => { if(!gaps.some(g=>g.kind===kind&&g.line===line&&g.detail===detail))gaps.push({ kind, line, detail }); };
  for (const ts of parts) {
    if(ts.some(t=>t.quoted && /[A-Z]|[^A-Za-z0-9_$]/.test(t.text.slice(1,-1)))){addGap('quoted-identifier-lineage-unsupported',ts.find(t=>t.quoted).line,'Case-sensitive or special quoted identifiers retain canonical identity; column parsing requires a SQL parser adapter.');continue;}
    const refs = [], declarations = new Set(); let update = null, insert = null;
    for(let i=0;i<ts.length;i++) {
      const w=ts[i].word;
      if(w==='execute') addGap('dynamic-sql', ts[i].line, 'Runtime SQL requires observed queries or a reviewed resolver; string construction is not complete static lineage.');
      if(w==='merge')addGap('unsupported-sql-merge',ts[i].line,'MERGE column effects require a parser/runtime adapter.');
      if(!['from','join','update','into','using'].includes(w))continue;
      let j=i+1;if(ts[j]?.word==='only')j++;
      if(!ts[j]||ts[j].literal||!/^\w+$/.test(ts[j].word))continue;
      let name=ts[j].word;declarations.add(j);if(ts[j+1]?.word==='.'&&ts[j+2]){name+='.'+ts[j+2].word;declarations.add(j+2);j+=2;}
      if(ts[j+1]?.word==='(' && w!=='into')continue; // a FROM function/subquery is not a table
      const found=resolve(name);if(!found.length){addGap('unresolved-relation',ts[i].line,name);continue;}
      if(found.length>1)addGap('ambiguous-relation',ts[i].line,name);
      let a=j+1;if(ts[a]?.word==='as')a++;
      const alias=ts[a]&&!RESERVED.has(ts[a].word)&&/^[\w$]+$/.test(ts[a].word)&&!ts[a].literal?ts[a].word:name.split('.').pop();
      if(alias!==name.split('.').pop())declarations.add(a);
      for(const table of found)refs.push({table,alias,word:w,index:i, name});
      if(w==='update') update=found; if(w==='into')insert={tables:found,at:j+1};
    }
    for (const table of triggerTables) for(const alias of ['old','new'])refs.push({table:norm(table),alias,word:'trigger',index:-1});
    const hasCol=(table,col)=>tables.get(table)?.columns?.some(c=>norm(c.name)===col);
    const emit=(table,column,access,t,extra={})=>{const k=`${table}|${column}|${access}|${t.line}|${t.at}`;if(!hits.some(x=>x.key===k))hits.push({key:k,table,column,access,line:t.line,offset:t.at,...extra});};
    const insertCols=new Set(), setTargets=new Set();
    const setStart=ts.findIndex(t=>t.word==='set');
    if(setStart>=0){let start=setStart+1,paren=0,cases=0,assigned=false;for(let j=start;j<ts.length;j++){const w=ts[j].word;if(paren===0&&cases===0&&['where','returning','from'].includes(w))break;if(w==='(')paren++;if(w===')')paren--;if(w==='case')cases++;if(w==='end'&&cases)cases--;if(w==='='&&paren===0&&cases===0&&!assigned){assigned=true;const left=ts.slice(start,j);if(left.length===1||left.length===3&&left[1].word==='.')setTargets.add(j-1);else addGap('complex-set-target',ts[j].line,'Tuple/generated SET target requires a parser adapter.');}if(w===','&&paren===0&&cases===0){start=j+1;assigned=false;}}}
    if(insert&&ts[insert.at]?.word!=='('){for(const table of insert.tables)for(const col of tables.get(table)?.columns||[])emit(table,norm(col.name),'write',ts[insert.at]||ts[0],{syntax:'implicit-insert-target'});addGap('implicit-insert-columns',ts[0].line,'All relation columns are candidates; generated/default column effects require runtime verification.');}
    if(ts.some(t=>t.word==='delete'))for(const r of refs.filter(r=>r.word==='from').slice(0,1))for(const col of tables.get(r.table)?.columns||[])emit(r.table,norm(col.name),'write',ts[0],{syntax:'delete-row'});
    if(insert&&ts[insert.at]?.word==='('){let i=insert.at+1;for(;i<ts.length&&ts[i].word!==')';i++)if(/^[\w$]+$/.test(ts[i].word)){insertCols.add(i);for(const table of insert.tables)if(hasCol(table,ts[i].word))emit(table,ts[i].word,'write',ts[i],{syntax:'insert-target'});}}
    for(let i=0;i<ts.length;i++) {
      const t=ts[i],w=t.word;
      if(w==='*'&&ts[i-1]?.word!=='('&&((ts[i-1]?.word==='.'&&ts[i-2]&&['select','returning',','].includes(ts[i-3]?.word))||['select','returning',',','distinct','all'].includes(ts[i-1]?.word))&&['from','into',',',';'].includes(ts[i+1]?.word||';')){
        const qual=ts[i-1]?.word==='.'?ts[i-2]?.word:null;
        const before=ts.slice(0,i).map(x=>x.word);if(!before.includes('select')&&!before.includes('returning'))continue;
        const rr=qual?refs.filter(r=>r.alias===qual||r.table===qual):refs.filter(r=>r.word!=='trigger');
        for(const r of rr)for(const col of tables.get(r.table)?.columns||[])emit(r.table,norm(col.name),'read',t,{syntax:'star-expansion'});continue;
      }
      if(t.literal||declarations.has(i)||insertCols.has(i)||RESERVED.has(w)||(!t.quoted&&!/^[A-Za-z_][\w$]*$/.test(t.text)))continue;
      if(ts[i+1]?.word==='.'||ts[i+1]?.word==='('||ts[i-1]?.word==='as'||ts[i-1]?.word==='::')continue;
      const qual=ts[i-1]?.word==='.'?ts[i-2]?.word:null;
      let rr=refs.filter(r=>hasCol(r.table,w)&&(qual?(r.alias===qual||r.table===qual):r.word!=='trigger'));
      rr=[...new Map(rr.map(r=>[r.table+'|'+(qual||''),r])).values()];
      if(!rr.length)continue;
      const assignment=['=',':='].includes(ts[i+1]?.word), setAt=ts.findIndex(x=>x.word==='set');
      const before=ts.slice(0,i).map(x=>x.word), lastClause=[...before].reverse().find(x=>['where','on','having','select','returning','set','values','join','from'].includes(x));
      let access=lastClause==='where'||lastClause==='on'||lastClause==='having'?'predicate':'read';
      if(qual==='new'&&assignment)access='write';
      else if(assignment&&setTargets.has(i)){
        rr=rr.filter(r=>update?.includes(r.table));access='write';
      }
      if(!qual&&rr.length>1){addGap('ambiguous-column',t.line,w);access='unknown';}
      for(const r of rr)emit(r.table,w,access,t,{syntax:qual==='old'||qual==='new'?`trigger-${qual}`:access==='write'?'set-target':lastClause||'expression',ambiguous:!qual&&rr.length>1||undefined});
    }
    if(ts.some(t=>t.word==='with'))addGap('cte-or-nested-scope',ts.find(t=>t.word==='with').line,'Nested alias scopes require a SQL parser adapter; results are candidates.');
    if(ts.filter(t=>t.word==='select').length>1)addGap('nested-query-scope',ts.find(t=>t.word==='select').line,'Nested query scopes may shadow aliases.');
  }
  return { protocol:'dt.column-lineage/v1',hits:hits.map(({key,...h})=>h),gaps,coverage:{parser:'bounded-sql-lexer/v1', exhaustive:false, supported:['select','star','update-set','insert-columns','where','join-on','returning','trigger-old-new'], unsupported:['dynamic-sql','nested-alias-scopes','merge','runtime-generated-queries']} };
}
function catalog(catalog, env, emit = {}) {
  const edges=[],gaps=[];
  const edge = e => emit.edge ? emit.edge(e) : edges.push(e);
  const gap = g => emit.gap ? emit.gap(g) : gaps.push(g);
  for(const f of catalog.functions||[]) {
    const user=ID.qualified(f.schema,f.name);
    if(!/^(sql|plpgsql)$/.test(f.lang||'')){gap({kind:'unsupported-function-language',db:catalog.db,user,language:f.lang});continue;}
    const r=analyze(f.body,catalog,{schema:f.schema,triggerTables:(catalog.triggers||[]).filter(t=>norm(t.function)===user).map(t=>t.table)});
    for(const h of r.hits)edge({env,db:catalog.db,revision:catalog.syncedAt||null,target:`${h.table}.${h.column}`,targetKind:'column',user,userKind:f.kind||'function',role:h.access,access:h.access,where:`${user}:${h.line}`,line:h.line,source:'db',detail:h.syntax,syntax:h.syntax,...(h.ambiguous?{ambiguous:true}:{})});
    for (const g of r.gaps) gap({...g,db:catalog.db,user,source:'db'});
  }
  for(const v of catalog.tables||[]) if(v.definition){
    const user=ID.qualified(v.schema,v.name),r=analyze(v.definition,catalog,{schema:v.schema});
    for(const h of r.hits)edge({env,db:catalog.db,revision:catalog.syncedAt||null,target:`${h.table}.${h.column}`,targetKind:'column',user,userKind:v.kind,role:h.access,access:h.access,where:`${user}:${h.line}`,line:h.line,source:'db',detail:h.syntax});
    for (const g of r.gaps) gap({...g,db:catalog.db,user,source:'db'});
  }
  return {edges,gaps};
}
module.exports={tokens,analyze,catalog};
