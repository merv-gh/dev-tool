// Synthetic estate built from actual source extraction, for UI/model/regression experiments.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function fixture(home,{services=120,classes=12}={}){
 const put=(name,value)=>{const f=path.join(home,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof value==='string'?value:JSON.stringify(value));};
 put('config.json',{envs:{test:{}},browser:{mcp:'http://127.0.0.1:4498/mcp',sites:{'shop-ui':{url:'http://127.0.0.1:4498/shop',env:'test'}}}});
 const catalog=[],summaries=[];
 for(let i=0;i<services;i++){
  const name=i===0?'orders':i===1?'shipping':`service-${String(i).padStart(3,'0')}`,topic=i===0?'orders.created':`event.${i}`,consumes=i===1?'orders.created':`event.${Math.max(0,i-1)}`,database='db'+(i%12),table='sales.records_'+i;
  const repo=path.join(home,'fixture-repos',name);
  put(`fixture-repos/${name}/pom.xml`,'<project><groupId>demo</groupId><artifactId>'+name+'</artifactId><version>1</version></project>');
  put(`fixture-repos/${name}/src/main/resources/application.properties`,`spring.datasource.url=jdbc:postgresql://localhost/${database}\n`);
  put(`fixture-repos/${name}/src/main/java/demo/Controller.java`,`package demo;\n@RestController\nclass Controller {\n @GetMapping("/api/${name}/{id}")\n public Object get() { return null; }\n}\n`);
  put(`fixture-repos/${name}/src/main/java/demo/Events.java`,`package demo;\nclass Events {\n @KafkaListener(topics = "${consumes}")\n void receive(String body) {}\n void publish() { kafkaTemplate.send("${topic}", "event"); }\n}\n`);
  put(`fixture-repos/${name}/src/main/java/demo/Repository.java`,`package demo;\nclass Repository {\n void save() { jdbcTemplate.update("insert into ${table} (id) values (?)", 42); }\n}\n`);
  for(let c=0;c<classes;c++)put(`fixture-repos/${name}/src/main/java/demo/Part${c}.java`,`package demo;\nclass Part${c} {\n ${Array.from({length:20},(_,m)=>`int value${m}() { return ${m}; }`).join('\n')}\n}\n`);
  const ex=require('../lib/passport/extract').extract(repo),effective={endpoints:ex.endpoints,consumes:ex.kafka.consumes,produces:ex.kafka.produces,tables:ex.db.tables,calls:ex.feign,dbCalls:ex.db.calls||[]};
  const p={...ex,service:name,env:'test',builtAt:new Date().toISOString(),repo:{project:'DOMAIN'+(i%8),repo:name,ref:'main',sha:crypto.createHash('sha1').update(name).digest('hex')},effective,libraries:[{repo:'LIB/common',artifactId:'common',version:'1'}],summary:{endpoints:effective.endpoints.length,consumes:effective.consumes.map(x=>x.topic),produces:effective.produces.map(x=>x.topic),tables:Object.fromEntries(effective.tables.map(t=>[t.table,[t.access]])),calls:[],libraries:['common']}};
  put(`passports/${name}/passport.json`,p);summaries.push({name,endpoints:p.effective.endpoints.length,consumes:p.effective.consumes.length,produces:p.effective.produces.length,tables:p.effective.tables.length});
  catalog.push(`pg ${database} ${table} table ~100: id bigint, total numeric`,`kafka ${topic} 100 schema:jsonv1:id bigint`);
 }
 put('cache/test/catalog.txt',catalog.join('\n')+'\n');
 put('cache/routes.json',{routes:{shop:{host:'127.0.0.1:4498',method:'GET',path:'/api/orders/<id>',count:3,query:[],statuses:{200:3},sources:['ui flow']}}});
 return {services,repositories:services,classes:services*(classes+3),methods:services*(classes*20+4),summaries};
}
module.exports={fixture};
if(require.main===module){const home=process.argv[2];if(!home)throw Error('Output folder required');console.log(JSON.stringify(fixture(home,{services:Number(process.argv[3]||120),classes:Number(process.argv[4]||12)})));}
