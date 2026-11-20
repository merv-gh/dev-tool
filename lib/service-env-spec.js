// Versioned, data-only service definitions. No shell, host paths or owner selectors.
const { invalid, hash } = require('./durable-private-store');
const fail = message => { throw invalid(message); };
function object(v, keys, name) { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${name} must be an object`); for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`Unsupported ${name} field: ${k}`); }
function name(v) { if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(v)) fail('Names use lowercase letters, numbers and hyphens (1..40 characters)'); return v; }
function relative(v, fallback) { v ??= fallback; if (typeof v !== 'string' || !v || v.length > 240 || v.includes('\\') || v.startsWith('/') || /[\x00-\x1f]/.test(v) || v.split('/').some(p => p === '..' || !p || p === '.git')) fail('Use a relative workspace path without traversal'); return v; }
function integer(v, fallback, low, high, label) { v ??= fallback; if (!Number.isSafeInteger(v) || v < low || v > high) fail(`${label} must be ${low}..${high}`); return v; }
function image(v) { if (typeof v !== 'string' || !/^[a-zA-Z0-9][\w./:@-]{0,240}$/.test(v)) fail('Invalid Docker image reference'); return v; }
function entries(v, label, pattern) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 100) fail(`${label} must be an object with at most 100 keys`); for (const [k,x] of Object.entries(v)) if (!pattern.test(k) || !['string','number','boolean'].includes(typeof x) || String(x).length > 8000 || /[\0]/.test(String(x))) fail(`Invalid ${label} entry ${k}`); return v; }
function spec(input) {
  object(input, ['version','name','context','continuation','ttl_ms','services','dependencies','assumptions'], 'definition');
  if (input.version !== 1) fail('Service definition version must be 1');
  if (!Array.isArray(input.services) || !input.services.length || input.services.length > 8) fail('Select 1..8 services');
  const names = new Set();
  const services = input.services.map(raw => {
    object(raw, ['name','workspace','module','adapter','artifact','entry','build','image','port','health_path','ready_timeout_ms','memory_mb','properties','env','datasources','debug'], 'service');
    const id = name(raw.name); if (names.has(id)) fail('Service names must be unique'); names.add(id);
    if (!/^[\w.-]{1,100}$/.test(raw.workspace || '')) fail('A workspace id is required for each service');
    const adapter = raw.adapter || 'spring-boot'; if (!['spring-boot','node'].includes(adapter)) fail('Adapter must be spring-boot or node');
    if(raw.debug&&adapter!=='spring-boot')fail('Debug attachment is supported for Spring JVM services');
    const build = raw.build || (adapter === 'node' ? 'none' : 'auto'); if (!['auto','maven','gradle','none'].includes(build)) fail('Build must be auto, maven, gradle or none');
    const health = raw.health_path || '/actuator/health'; if (typeof health !== 'string' || !health.startsWith('/') || health.startsWith('//') || /[\r\n\0#]/.test(health) || health.length > 500) fail('health_path must be an HTTP path');
    const datasources = entries(raw.datasources || {}, 'datasources', /^[a-z][a-z0-9-]{0,39}$/);
    for (const prefix of Object.values(datasources)) if (!/^[a-z][a-z0-9_.-]{0,150}$/.test(prefix)) fail('Datasource values must be property prefixes, such as spring.datasource');
    const env = entries(raw.env || {}, 'environment', /^[A-Z][A-Z0-9_]{0,119}$/);
    if (Object.keys(env).some(k => /^(DT_ENV_|SPRING_APPLICATION_JSON$|JAVA_TOOL_OPTIONS$|JAVA_OPTIONS$|JDK_JAVA_OPTIONS$|NODE_OPTIONS$|LD_|DOCKER_|DT_RUNNER_)/.test(k))) fail('Runtime-owned environment variables cannot be overridden');
    return { name:id, workspace:raw.workspace, adapter, module:relative(raw.module,'.'), build, ...(raw.artifact ? {artifact:relative(raw.artifact)} : {}), ...(adapter === 'node' ? {entry:relative(raw.entry,'server.js')} : {}), ...(raw.image ? {image:image(raw.image)} : {}), port:integer(raw.port,8080,1024,65535,'port'), health_path:health, ready_timeout_ms:integer(raw.ready_timeout_ms,90000,1000,300000,'ready_timeout_ms'), memory_mb:integer(raw.memory_mb,768,128,8192,'memory_mb'), properties:entries(raw.properties || {},'properties',/^[a-zA-Z][\w.-]{0,180}$/), env, datasources, debug:raw.debug === true };
  });
  const d = input.dependencies || {}; object(d,['postgres','kafka','elasticsearch'],'dependencies');
  const dependencies = {};
  if (d.postgres) { object(d.postgres,['template'],'postgres'); if (!/^[a-f0-9]{64}$/.test(d.postgres.template || '')) fail('postgres.template must be an immutable testdb template key'); dependencies.postgres = {template:d.postgres.template}; }
  if (d.kafka) {
    object(d.kafka,['image','topics'],'kafka'); if (!Array.isArray(d.kafka.topics) || d.kafka.topics.length > 100) fail('kafka.topics must be an array of at most 100 topics');
    const seen = new Set(); dependencies.kafka = {...(d.kafka.image?{image:image(d.kafka.image)}:{}),topics:d.kafka.topics.map(t=>{object(t,['name','partitions'],'topic');if(!/^[a-zA-Z0-9][\w.-]{0,199}$/.test(t.name||'')||seen.has(t.name))fail('Topic names must be valid and unique');seen.add(t.name);return{name:t.name,partitions:integer(t.partitions,1,1,32,'partitions')};})};
  }
  if (d.elasticsearch) {
    object(d.elasticsearch,['image','indices'],'elasticsearch'); if (!Array.isArray(d.elasticsearch.indices) || d.elasticsearch.indices.length > 50) fail('elasticsearch.indices must contain at most 50 indices');
    const seen=new Set(); dependencies.elasticsearch={...(d.elasticsearch.image?{image:image(d.elasticsearch.image)}:{}),indices:d.elasticsearch.indices.map(i=>{object(i,['name','mappings','documents'],'index');if(!/^[a-z0-9][a-z0-9_.-]{0,199}$/.test(i.name||'')||seen.has(i.name))fail('Index names must be valid and unique');seen.add(i.name);if(i.mappings&&(!i.mappings.properties||typeof i.mappings.properties!=='object'))fail('Mappings need properties');if(i.documents&&(!Array.isArray(i.documents)||i.documents.length>2000))fail('At most 2000 seed documents per index');return{name:i.name,mappings:i.mappings||{properties:{}},documents:i.documents||[]};})};
  }
  for (const service of services) if (Object.keys(service.datasources).length && !dependencies.postgres) fail('Datasource bindings require dependencies.postgres.template');
  for (const k of ['context','continuation']) if (input[k] !== undefined && (typeof input[k]!=='string'||input[k].length>100)) fail(`Invalid ${k}`);
  if (input.assumptions && (!Array.isArray(input.assumptions)||input.assumptions.length>50||input.assumptions.some(x=>typeof x!=='string'||x.length>1000))) fail('assumptions must contain at most 50 short strings');
  const out={version:1,name:name(input.name),services,dependencies,ttl_ms:integer(input.ttl_ms,1800000,60000,86400000,'ttl_ms'),assumptions:input.assumptions||[],...(input.context?{context:input.context}:{}),...(input.continuation?{continuation:input.continuation}:{})};
  if(Buffer.byteLength(JSON.stringify(out))>2*1048576)fail('Definition exceeds 2 MiB'); return out;
}
const fingerprint = v => hash(JSON.stringify(v));
const variable = v => v.toUpperCase().replace(/[^A-Z0-9]/g,'_');
// Return placeholders for source files, and separate live values for the launcher.
function bindings(service, databases, endpoints, peers) {
  const properties={...service.properties,'server.port':String(service.port),'spring.cloud.consul.enabled':'false','spring.cloud.consul.discovery.enabled':'false','spring.cloud.consul.config.enabled':'false','spring.flyway.enabled':'false','spring.liquibase.enabled':'false','spring.jpa.hibernate.ddl-auto':'none','spring.sql.init.mode':'never'}, env={...service.env}, live={};
  const put=(property,key,value)=>{properties[property]='${'+key+'}';env[key]=String(value);live[property]=String(value);};
  for(const [logical,prefix] of Object.entries(service.datasources)) {
    const db=databases?.[logical];if(!db)fail(`Datasource ${logical} was not supplied by the template`);
    const base='DT_ENV_PG_'+variable(logical);put(prefix+'.url',base+'_JDBC_URL',db.jdbcUrl);put(prefix+'.username',base+'_USERNAME',db.user);put(prefix+'.password',base+'_PASSWORD',db.password);
  }
  if(endpoints.kafka)put('spring.kafka.bootstrap-servers','DT_ENV_KAFKA_BOOTSTRAP_SERVERS',endpoints.kafka);
  if(endpoints.es)put('spring.elasticsearch.uris','DT_ENV_ELASTICSEARCH_URIS',endpoints.es);
  for(const [name,url]of Object.entries(peers||{}))env['DT_ENV_SERVICE_'+variable(name)+'_URL']=url;
  // User properties can refer to peer/dependency variables; leave placeholders for Spring.
  return {properties,env,applicationProperties:{...properties,...live}};
}
function propertiesText(properties) { const escape=v=>String(v).replace(/\\/g,'\\\\').replace(/\r/g,'\\r').replace(/\n/g,'\\n');return Object.entries(properties).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>escape(k)+'='+escape(v)).join('\n')+'\n'; }
module.exports={spec,name,relative,integer,object,bindings,propertiesText,fingerprint,variable};
