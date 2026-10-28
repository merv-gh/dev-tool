// Disposable native dependency adapter v1. All writes target containers whose random ownership
// labels and durable lease agree. Sources are never used as replay destinations.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const postgres = require('postgres');
const { isDeepStrictEqual } = require('util');
const { CACHE, readJson } = require('./util');
const R = require('./reproduction');
const ROOT = path.join(CACHE, 'fixture-runs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const qi = value => `"${String(value).replace(/"/g, '""')}"`;
const qt = value => value.split('.').map(qi).join('.');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cancellation = session => { const reason = require('./trace').current()?.cancelled || (session && readJson(path.join(location(session.id),'session.json'))?.stopRequestedAt ? 'stop requested' : null); if (reason) throw new Error(`fixture runtime cancelled: ${reason}`); };
const exec = (...args) => require('./scenario-runtime').exec(...args);
const DEFAULT_IMAGES = { pg: 'postgres:16-alpine', es: 'docker.elastic.co/elasticsearch/elasticsearch:8.17.3', kafka: 'docker.redpanda.com/redpandadata/redpanda:v24.3.6' };
const bounded = (value, def, low, high, name) => { value ??= def; if (!Number.isInteger(value) || value < low || value > high) throw new Error(`${name} must be ${low}..${high}`); return value; };
function strict(value, keys, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); const extra = Object.keys(value).filter(k => !keys.includes(k)); if (extra.length) throw new Error(`unsupported ${name}: ${extra.join(', ')}`); }
function location(id) { if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('invalid fixture runtime id'); return path.join(ROOT, id); }
function save(session) { const dir = location(session.id); const prior=readJson(path.join(dir,'session.json')); if(prior?.stopRequestedAt) session.stopRequestedAt=prior.stopRequestedAt; fs.mkdirSync(dir, { recursive: true }); const temporary = path.join(dir, `${crypto.randomBytes(6).toString('hex')}.tmp`); fs.writeFileSync(temporary, JSON.stringify(session, null, 2), { mode: 0o600 }); fs.renameSync(temporary, path.join(dir, 'session.json')); }
function load(id, stopped = false) { const session = readJson(path.join(location(id), 'session.json')); if (!session) throw new Error('fixture runtime not found'); if (!stopped && session.status !== 'ready') throw new Error(`fixture runtime is ${session.status}`); if (!stopped && Date.now() > session.expiresAt) throw new Error('fixture runtime lease expired; stop it or call fixture_runtime_cleanup'); return session; }
async function locked(id, run) { const dir = path.join(location(id), 'operation.lock'); try { fs.mkdirSync(dir); } catch (e) { if (e.code === 'EEXIST') throw new Error('fixture runtime already has an active operation'); throw e; } try { return await run(); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }
function profile(workspace, file) {
  if (/(^|\/)src\/test\/resources\/dt-(scenarios|fixtures)\//.test(file || '')) throw new Error('reviewed runtime profile must be outside imported test resources');
  const full = require('./scenario-package').workspacePath(workspace, file).full, text = fs.readFileSync(full), value = JSON.parse(text);
  strict(value, ['version','adapter','images','ttlMs','readyTimeoutMs','observationLimit','kafka'], 'native fixture profile');
  if (value.version !== 1 || value.adapter !== 'native-containers') throw new Error('fixture profile must be version 1 adapter native-containers');
  if (value.images) strict(value.images, ['pg','es','kafka'], 'fixture images');
  if (value.kafka) strict(value.kafka, ['allowOffsetRemap'], 'Kafka profile');
  const images = { ...DEFAULT_IMAGES, ...value.images };
  for (const image of Object.values(images)) if (!/^[\w][\w./:@-]+$/.test(image)) throw new Error('fixture image must be an exact existing Docker image');
  return { value: { ...value, images, ttlMs: bounded(value.ttlMs, 600000, 1000, 3600000, 'ttlMs'), readyTimeoutMs: bounded(value.readyTimeoutMs, 180000, 1000, 300000, 'readyTimeoutMs'), observationLimit: bounded(value.observationLimit, 2000, 1, 10000, 'observationLimit') }, digest: hash(text.toString()) };
}
function publicSession(session) { return { version: 1, adapter: 'native-containers/v1', id: session.id, workspace: session.workspace, directory: session.directory, status: session.status, expiresAt: new Date(session.expiresAt).toISOString(), proof: session.proof, sources: session.sources, timings: session.timings, ...(session.expectations ? { expectations: { digest: session.expectations.digest, armedAt: session.expectations.armedAt } } : {}), ...(session.cleanupError ? { cleanupError: session.cleanupError } : {}) }; }
async function docker(args, options) { const result = await exec('docker', args, options); if (result.code !== 0) throw new Error(`Docker ${args.slice(0, 2).join(' ')}: ${result.error || result.out || result.code}`); return result.out.trim(); }
async function owned(session, container) {
  const result = await exec('docker', ['inspect', '--format', '{"labels":{{json .Config.Labels}},"image":{{json .Image}}}', container]);
  if (result.code !== 0) { if (/No such (?:object|container)/i.test(result.error + result.out)) return false; throw new Error(`cannot verify fixture container ownership: ${result.error || result.out}`); }
  const inspected = JSON.parse(result.out), labels=inspected.labels;
  const kind=Object.keys(session.names || {}).find(kind=>session.names[kind]===container),expectedImage=session.proof?.imageIds?.[kind];
  if(expectedImage && inspected.image!==expectedImage) throw new Error(`fixture container ${container} image identity differs from its pinned preflight image`);
  if (labels?.['dt.fixture.owner'] !== session.owner || labels?.['dt.fixture.id'] !== session.id) throw new Error(`fixture container ${container} has different ownership; refusing operation`);
  return true;
}
async function verify(session,{source}={}) {
  if (profile(session.workspace, session.profilePath).digest !== session.profileDigest) throw new Error('reviewed runtime profile changed');
  if (hash(R.loadFixture(session.workspace, session.directory).files) !== session.fixtureDigest) throw new Error('fixture changed since native replay');
  for (const container of session.containers.filter(name=>!source || session.names[source.split(':')[0]]===name)) if (!await owned(session, container)) throw new Error(`fixture container disappeared: ${container}`);
}
async function port() { return new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(error => error ? reject(error) : resolve(value)); }); }); }
async function waitFor(session, operation) { const deadline = Date.now() + session.profile.readyTimeoutMs; let error; while (Date.now() < deadline) { cancellation(session); try { return await operation(); } catch (e) { error = e; await sleep(200); } } throw new Error(`native dependency readiness deadline: ${error?.message || 'not ready'}`); }
async function esRequest(session, route, options = {}) {
  const controller = AbortSignal.timeout(15000), response = await fetch(session.endpoints.es + route, { ...options, headers: { 'content-type': 'application/json', ...options.headers }, body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body), signal: controller, redirect: 'error' });
  let chunks = [], size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('native ES observation exceeds 16 MiB'); chunks.push(Buffer.from(chunk)); }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!response.ok) throw new Error(`native ES ${response.status}: ${text.slice(0, 500)}`);
  return text ? require('./fixture-json').parse(text) : {};
}
async function pgConnection(session, database, fn) { const sql = postgres(session.endpoints.pg, { database, username: 'postgres', password: session.password, max: 1, connect_timeout: 3, onnotice: () => {} }); try { return await fn(sql); } finally { await sql.end({ timeout: 2 }); } }
async function rpk(session, args, options) { return docker(['exec', '-i', session.names.kafka, 'rpk', ...args, '-X', 'brokers=127.0.0.1:9092'], options); }
const wire = (value, codec) => value == null ? null : codec === 'auto' ? typeof value==='string'?value:JSON.stringify(value) : codec === 'string' ? typeof value === 'string' ? value : (() => { throw new Error('string codec needs explicit string values'); })() : JSON.stringify(value);
function headersOf(value) { if (value == null) return []; const headers = Array.isArray(value) ? value : Object.entries(value).map(([key, value]) => ({ key, value })); for (const h of headers) if (typeof h.key !== 'string' || typeof h.value !== 'string' || /[\r\n\0]/.test(h.key)) throw new Error('native Kafka headers need string key/value pairs'); return headers; }
async function publish(session, topic, message, codec = 'auto') {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,248}$/.test(topic) || !Number.isInteger(message.partition) || message.partition < 0 || message.partition > 1000) throw new Error('invalid native Kafka topic/partition');
  R.exactNumbers(message, 'native Kafka payload');
  const key = wire(message.key, codec), value = wire(message.value, codec);
  let input = '', format = '';
  if (key !== null) { input += `${Buffer.byteLength(key)}:${key}`; format += '%K:%k'; }
  input += `${Buffer.byteLength(value || '')}:${value || ''}`; format += '%V:%v';
  const args = ['topic','produce',topic,'--partition',String(message.partition),'--format',format,'--output-format','%p:%o\\n','--delivery-timeout','10s'];
  if (value === null) args.push('--tombstone');
  for (const h of headersOf(message.headers)) args.push('--header', `${h.key}:${h.value}`);
  const result = await rpk(session, args, { input, timeoutMs: 20000 });
  const parts = result.trim().split(':');
  return { partition: Number(parts[0]), offset: parts[1], sourceOffset: message.offset == null ? null : String(message.offset), sourceTimestamp: message.timestamp ?? null, timestampPreserved: false };
}
async function nativeStart(session, manifest) {
  const labels = ['--label',`dt.fixture.owner=${session.owner}`,'--label',`dt.fixture.id=${session.id}`];
  const run = async (kind, args) => {
    cancellation(session);
    const name = `dt-fixture-${session.id}-${kind}`; session.names[kind] = name; session.containers.push(name); save(session);
    await docker(['run','--detach','--pull=never','--name',name,...labels,'--network',session.network,'--cap-drop','ALL','--security-opt','no-new-privileges',...args]);
  };
  if (Object.keys(manifest.databases).length) {
    await run('pg', ['--user','postgres','--publish','127.0.0.1::5432','--memory','512m','--cpus','1','--env',`POSTGRES_PASSWORD=${session.password}`,'--env','PGDATA=/tmp/pgdata','--tmpfs','/tmp:rw,nosuid,size=384m',session.proof.imageIds.pg]);
    const mapping = JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Ports}}',session.names.pg]));
    session.endpoints.pg = `postgresql://127.0.0.1:${mapping['5432/tcp'][0].HostPort}/postgres`; save(session);
    await waitFor(session, () => pgConnection(session, 'postgres', sql => sql`select 1`));
    await pgConnection(session, 'postgres', sql => sql.unsafe(`create role dt_fixture_app login password '${session.applicationPassword}'`));
    for (const [logical, db] of Object.entries(manifest.databases)) {
      const name = `fixture_${Buffer.from(logical).toString('hex')}`; if (name.length > 63) throw new Error('native fixture database name exceeds PostgreSQL identifier limit');
      await pgConnection(session, 'postgres', sql => sql.unsafe(`create database ${qi(name)}`)); session.databases[logical] = name; save(session);
      const statements = [...db.statements.schema, ...db.statements.data, ...db.statements.constraints]; require('./testdb').checkStatements(statements);
      await pgConnection(session, name, async sql => {
        await sql.unsafe(`set statement_timeout='30s'`); for (const statement of statements) { cancellation(session); await sql.unsafe(statement); }
        await sql.unsafe(`create schema dt_fixture_observation; revoke all on schema dt_fixture_observation from public;
          create table dt_fixture_observation.writes (ordinal bigserial primary key, target text not null, operation text not null, before_row jsonb, after_row jsonb);
          create function dt_fixture_observation.record() returns trigger language plpgsql security definer set search_path=pg_catalog,dt_fixture_observation as $$
          begin
            insert into dt_fixture_observation.writes(target,operation,before_row,after_row) values (TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME,TG_OP,case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,case when TG_OP in ('UPDATE','INSERT') then to_jsonb(NEW) end);
            if TG_LEVEL='STATEMENT' then return NULL; end if; if TG_OP='DELETE' then return OLD; end if; return NEW;
          end $$`);
        for (const t of manifest.plan.tables.filter(t => t.db === logical)) {
          await sql.unsafe(`create trigger dt_fixture_audit after insert or update or delete on ${qt(t.table)} for each row execute function dt_fixture_observation.record()`);
          await sql.unsafe(`create trigger dt_fixture_truncate after truncate on ${qt(t.table)} for each statement execute function dt_fixture_observation.record()`);
          await sql.unsafe(`grant usage on schema ${qi(t.table.split('.')[0])} to dt_fixture_app; grant select,insert,update,delete,truncate on ${qt(t.table)} to dt_fixture_app`);
        }
        for (const schema of new Set(manifest.plan.tables.filter(t => t.db === logical).map(t => t.table.split('.')[0]))) await sql.unsafe(`grant usage,select on all sequences in schema ${qi(schema)} to dt_fixture_app`);
      });
    }
  }
  if (Object.keys(manifest.elasticsearch || {}).length) {
    await run('es', ['--publish','127.0.0.1::9200','--memory','1536m','--cpus','4','--env','xpack.ml.enabled=false','--env','ingest.geoip.downloader.enabled=false','--env','discovery.type=single-node','--env','xpack.security.enabled=false','--env','ES_JAVA_OPTS=-Xms512m -Xmx512m',session.proof.imageIds.es]);
    const mapping = JSON.parse(await docker(['inspect','--format','{{json .NetworkSettings.Ports}}',session.names.es])); session.endpoints.es = `http://127.0.0.1:${mapping['9200/tcp'][0].HostPort}`; save(session);
    await waitFor(session, () => esRequest(session, '/_cluster/health?wait_for_status=yellow&timeout=1s'));
    for (const [index, source] of Object.entries(manifest.elasticsearch)) {
      await esRequest(session, `/${encodeURIComponent(index)}`, { method: 'PUT', body: { mappings: source.mapping, settings: { ...source.settings, number_of_shards: 1, number_of_replicas: 0 } } });
      for (const document of source.documents) await esRequest(session, `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(document._id)}`, { method: 'PUT', body: document._source });
      await esRequest(session, `/${encodeURIComponent(index)}/_refresh`, { method: 'POST' });
    }
  }
  if (Object.keys(manifest.topics || {}).length) {
    const exposed = await port(); session.endpoints.kafka = `127.0.0.1:${exposed}`;
    await run('kafka', ['--publish',`127.0.0.1:${exposed}:19092`,'--memory','768m','--cpus','1',session.proof.imageIds.kafka,'redpanda','start','--overprovisioned','--smp','1','--memory','512M','--reserve-memory','0M','--node-id','0','--check=false','--kafka-addr','internal://0.0.0.0:9092,external://0.0.0.0:19092','--advertise-kafka-addr',`internal://dt-fixture-${session.id}-kafka:9092,external://127.0.0.1:${exposed}`]);
    save(session); await waitFor(session, () => rpk(session, ['cluster','info'], { timeoutMs: 3000 }));
    for (const [topic, source] of Object.entries(manifest.topics)) {
      const partitions = Math.max(1, ...source.envelopes.map(m => m.partition + 1));
      if (partitions > 1001) throw new Error('Kafka fixture has too many partitions');
      await rpk(session, ['topic','create',topic,'--partitions',String(partitions),'--replicas','1']);
      const codec = manifest.plan.topics.find(t => t.topic === topic)?.codec || 'auto';
      session.offsets[topic] = [];
      for (const message of source.envelopes) { const errors = require('./fixture-payload').validateEnvelope(message, source.schema, codec); if (errors.length) throw new Error(errors.join('; ')); session.offsets[topic].push(await publish(session, topic, message, codec)); }
    }
  }
}
async function preflight(workspace, directory, profilePath) {
  const manifest = R.loadFixture(workspace, directory), reviewed = profile(workspace, profilePath), gaps = [];
  if (!manifest.complete) gaps.push({ kind: 'incomplete-fixture', detail: 'A native replay requires a complete reviewed capture' });
  if (Object.keys(manifest.topics || {}).length && reviewed.value.kafka?.allowOffsetRemap !== true) gaps.push({ kind: 'kafka-offset-policy', detail: 'Explicitly set kafka.allowOffsetRemap:true; source offsets/timestamps remain metadata and broker offsets/timestamps are new' });
  const needed = [...Object.keys(manifest.databases).length ? ['pg'] : [], ...Object.keys(manifest.elasticsearch || {}).length ? ['es'] : [], ...Object.keys(manifest.topics || {}).length ? ['kafka'] : []];
  const images = {};
  for (const kind of needed) { const inspected = await exec('docker', ['image','inspect','--format','{{.Id}}',reviewed.value.images[kind]], { timeoutMs: 10000 }); if (inspected.code !== 0) gaps.push({ kind: 'docker-image', source: kind, detail: `Required existing image ${reviewed.value.images[kind]} is unavailable; no images are pulled` }); else images[kind] = inspected.out.trim(); }
  return { version: 1, ok: !gaps.length, gaps, images, profile: reviewed.digest, capabilities: { postgres: 'SQL/constraints, exact numeric strings', es: 'mappings/documents', kafka: 'decoded JSON/untouched UTF-8 string keys/values, headers, partitions; offsets/timestamps remapped', distributedSnapshot: false } };
}
function reserve(workspace,directory,profilePath,manifest,reviewed,report) {
  const id = crypto.randomBytes(12).toString('hex');
  fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
  const reservation = path.join(ROOT,'.reservation.lock');
  try { fs.mkdirSync(reservation); } catch (e) { if(e.code==='EEXIST') throw new Error('native fixture startup reservation busy; retry or recover a stale lock with cleanup'); throw e; }
  try {
  fs.writeFileSync(path.join(reservation,'owner.json'),JSON.stringify({pid:process.pid,startedAt:Date.now()}));
  const active = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter(id => /^[a-f0-9]{24}$/.test(id)).map(id => readJson(path.join(ROOT,id,'session.json'))).filter(s => s && s.status !== 'stopped') : [];
  if (active.length >= 2) throw new Error('native fixture capacity reached (2); stop or clean expired runtimes');
  const session = { version: 1, id, owner: crypto.randomUUID(), workspace, directory, fixtureDigest: hash(manifest.files), profilePath, profileDigest: reviewed.digest, profile: reviewed.value, expiresAt: Date.now() + reviewed.value.ttlMs, status: 'starting', network: `dt-fixture-${id}`, containers: [], names: {}, endpoints: {}, databases: {}, offsets: {}, password: crypto.randomBytes(24).toString('hex'), applicationPassword: crypto.randomBytes(24).toString('hex'), sources: { pg: Object.keys(manifest.databases), es: Object.keys(manifest.elasticsearch || {}), kafka: Object.keys(manifest.topics || {}) }, timings: {}, proof: { level: 'native-dependencies', applicationExecuted: false, runtimeReadsVerified: false, sourceWrites: false, network: 'owned Docker bridge with loopback publications; outbound network is not blocked', distributedSnapshot: false, sourceKafkaOffsetsPreserved: false, sourceKafkaTimestampsPreserved: false, imageIds: report.images } };
  fs.mkdirSync(location(session.id),{recursive:true,mode:0o700}); save(session);
  return session;
  } finally { fs.rmSync(reservation,{recursive:true,force:true}); }
}
async function start(workspace,directory,profilePath) {
  const report = await preflight(workspace,directory,profilePath); if(!report.ok) return {ok:false,preflight:report};
  const manifest = R.loadFixture(workspace,directory), session = reserve(workspace,directory,profilePath,manifest,profile(workspace,profilePath),report), id = session.id;
  const started = Date.now();
  fs.writeFileSync(path.join(location(id),'starting.json'),JSON.stringify({pid:process.pid}),{mode:0o600});
  try {
    await docker(['network','create','--label',`dt.fixture.owner=${session.owner}`,'--label',`dt.fixture.id=${id}`,session.network]);
    await nativeStart(session, manifest); cancellation(session); session.status = 'ready'; session.timings.startMs = Date.now() - started; save(session);
    session.baseline = await observeSources(session, manifest); session.baselineDigest = hash(session.baseline); save(session);
    return { ok: true, session: publicSession(session), baselineDigest: session.baselineDigest };
  } catch (error) { session.error = error.message; session.failureEvidence={}; for(const name of session.containers) { const inspected=await exec('docker',['inspect','--format','{{json .State}}',name]); const logs=await exec('docker',['logs','--tail','10',name]); session.failureEvidence[name]={state:inspected.out.slice(0,1000),logs:(logs.out+logs.error).slice(-4000)}; } error.nativeEvidence=session.failureEvidence; save(session); try { await stop(id,{startupOwner:true}); } catch (cleanup) { error.cleanupError = cleanup.message; } throw error; } finally { fs.rmSync(path.join(location(id),'starting.json'),{force:true}); }
}
async function bindings(id) { const session = load(id); await verify(session); return { id, workspace:session.workspace,directory:session.directory, databases: Object.fromEntries(Object.entries(session.databases).map(([logical, db]) => [logical, { database:db, url: `${session.endpoints.pg.replace(/\/postgres$/, '')}/${db}`, user: 'dt_fixture_app', password: session.applicationPassword, jdbcUrl: `jdbc:${session.endpoints.pg.replace(/\/postgres$/, '')}/${db}` }])), es: session.endpoints.es, kafka: session.endpoints.kafka, offsetMappings: session.offsets, fixtureDigest:session.fixtureDigest,profileDigest:session.profileDigest,runnerHost:'local',environment:'owned-local-fixture', proof: session.proof }; }
async function observeSources(session, manifest,{source}={}) {
  const selected=id=>!source||source===id;
  const sources = {}, writeEvidence = {}, limit = session.profile.observationLimit;
  for (const [logical,name] of Object.entries(session.databases)) {
    if(source && (!source.startsWith('pg:') || source.split(':')[1]!==logical)) continue;
    writeEvidence[logical] = [...await pgConnection(session,name,sql => sql.unsafe(`select ordinal::text,target,operation,before_row::text as before_json,after_row::text as after_json from dt_fixture_observation.writes order by ordinal limit ${limit + 1}`))].map(row => R.jsonValue({...row}));
    if (writeEvidence[logical].length > limit) throw new Error(`PG write observer exceeded ${limit} events: ${logical}; cannot prove effects`);
  }
  for (const table of manifest.plan.tables || []) {
    if (!session.databases[table.db] || !selected(`pg:${table.id}`)) continue;
    const rows = await pgConnection(session, session.databases[table.db], sql => sql.begin('read only', tx => tx.unsafe(`select * from ${qt(table.table)} limit ${limit + 1}`)));
    if (rows.length > limit) throw new Error(`PG observer exceeded ${limit} rows: ${table.id}; cannot prove effects`);
    R.exactNumbers(rows, `PG observation ${table.id}`);
    sources[`pg:${table.id}`] = [...rows].map(row => R.jsonValue({ ...row })).sort((a,b) => require('./scenario-package').json(a).localeCompare(require('./scenario-package').json(b)));
  }
  for (const index of Object.keys(manifest.elasticsearch || {})) {
    if(!selected(`es:${index}`))continue;
    await esRequest(session, `/${encodeURIComponent(index)}/_refresh`, { method: 'POST' });
    const response = await esRequest(session, `/${encodeURIComponent(index)}/_search`, { method: 'POST', body: { size: limit + 1, track_total_hits: true, seq_no_primary_term: true, query: { match_all: {} } } });
    if ((response.hits.total?.value ?? response.hits.total) > limit) throw new Error(`ES observer exceeded ${limit} documents: ${index}; cannot prove effects`);
    sources[`es:${index}`] = response.hits.hits.map(doc => ({ _id: doc._id, _source: doc._source })).sort((a,b) => a._id.localeCompare(b._id));
    const stats=await esRequest(session,`/${encodeURIComponent(index)}/_stats/indexing?filter_path=indices.*.uuid,indices.*.primaries.indexing`),indexStats=stats.indices?.[index],counters=indexStats?.primaries?.indexing;
    if(typeof indexStats?.uuid!=='string' || !Number.isSafeInteger(counters?.index_total) || !Number.isSafeInteger(counters?.delete_total))throw new Error(`ES observer lacks index identity/write counters for ${index}`);
    writeEvidence[`es:${index}`] = {uuid:indexStats.uuid,indexed:counters.index_total,deleted:counters.delete_total,documents:response.hits.hits.map(doc => ({ id: doc._id, seqNo: doc._seq_no, primaryTerm: doc._primary_term })).sort((a,b) => a.id.localeCompare(b.id))};
    R.exactNumbers(sources[`es:${index}`], `ES observation ${index}`);
  }
  for (const topic of Object.keys(manifest.topics || {})) {
    if(!selected(`kafka:${topic}`))continue;
    const response = await rpk(session, ['topic','consume',topic,'--offset',':end','--num',String(limit + 1),'--format','json','--pretty-print=false'], { timeoutMs: 10000 });
    const envelopes = response.split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (envelopes.length > limit) throw new Error(`Kafka observer exceeded ${limit} messages: ${topic}; cannot prove effects`);
    const codec = manifest.plan.topics.find(t => t.topic === topic)?.codec || 'auto';
    const decode = value => { if (value == null) return null; if (codec === 'string') return value; if(codec==='auto') return require('./fixture-json').object(value); try { return require('./fixture-json').parse(value); } catch { throw new Error(`Kafka ${topic}: observed invalid JSON codec payload`); } };
    sources[`kafka:${topic}`] = envelopes.map(e => ({ partition: e.partition, offset: String(e.offset), key: decode(e.key), value: decode(e.value), headers: headersOf(e.headers || []) })).sort((a,b) => a.partition - b.partition || (BigInt(a.offset) < BigInt(b.offset) ? -1 : 1));
    R.exactNumbers(sources[`kafka:${topic}`], `Kafka observation ${topic}`);
  }
  const records=Object.values(sources).reduce((n,rows)=>n+rows.length,0)+Object.values(writeEvidence).reduce((n,rows)=>n+(Array.isArray(rows)?rows.length:1),0); if(records>20000 || Buffer.byteLength(JSON.stringify({sources,writeEvidence}))>16*1024*1024) throw new Error('Native observation exceeds 20000 records or 16 MiB; narrow the capture before claiming effects');
  return { version: 1, adapter: 'native-observer/v1', scope:source || 'all', sources, writeEvidence, observedAt: new Date().toISOString(), complete: true, proof: { independentOfApplicationReport: true, snapshotOnly: false, transientWritesVerified: { pg: 'committed row/statement audit in protected schema', es: 'index identity, operation counters and document sequence metadata during the owned instance lifetime', kafka: 'append-only envelopes within observed topic windows' }, kafkaProducerTransactionsVerified: false } };
}
function delta(before, after) {
  const key = value => require('./scenario-package').json(value), old = new Map(), next = new Map();
  for (const row of before) { const k = key(row); old.set(k, (old.get(k) || 0) + 1); }
  for (const row of after) { const k = key(row); next.set(k, (next.get(k) || 0) + 1); }
  const added = [], removed = [];
  for (const [k, n] of next) for (let i = old.get(k) || 0; i < n; i++) added.push(JSON.parse(k));
  for (const [k, n] of old) for (let i = next.get(k) || 0; i < n; i++) removed.push(JSON.parse(k));
  return { added, removed };
}
function changes(before, after) { return Object.fromEntries([...new Set([...Object.keys(before.sources),...Object.keys(after.sources)])].sort().map(id => [id, delta(before.sources[id] || [], after.sources[id] || [])])); }
function validateExpectations(session, contract) {
  strict(contract, ['version','sources','allowUnlistedEffects','quietMs'], 'effect contract');
  if (contract.version !== 1 || !Array.isArray(contract.sources) || !contract.sources.length) throw new Error('effect contract v1 needs at least one source assertion');
  const seen = new Set();
  for (const assertion of contract.sources) {
    strict(assertion, ['id','noWrites','rows','added','removed'], 'source effect assertion');
    if (!Object.hasOwn(session.baseline.sources, assertion.id) || seen.has(assertion.id)) throw new Error(`unknown or duplicate effect source ${assertion.id}`);
    seen.add(assertion.id);
    if (assertion.noWrites !== true && !['rows','added','removed'].some(k => Object.hasOwn(assertion,k))) throw new Error('effect assertion needs noWrites:true or exact rows/added/removed');
    for (const key of ['rows','added','removed']) if (Object.hasOwn(assertion,key) && !Array.isArray(assertion[key])) throw new Error(`effect ${key} must be an exact array`);
  }
  R.exactNumbers(contract, 'effect contract');
  return { ...contract, quietMs: bounded(contract.quietMs, 100, 0, 5000, 'quietMs') };
}
async function arm(id, contract) { return locked(id, async () => { const session = load(id); await verify(session); if (session.expectations) throw new Error('effects already armed; create a new runtime to change expectations'); const value = validateExpectations(session, contract); const observed = await observeSources(session,R.loadFixture(session.workspace,session.directory)); if (Object.values(changes(session.baseline,observed)).some(d => d.added.length || d.removed.length) || !isDeepStrictEqual(session.baseline.writeEvidence,observed.writeEvidence)) throw new Error('dependency state changed before arming expectations; create a new runtime'); session.expectations = { value, digest: hash(value), armedAt: new Date().toISOString() }; save(session); return { id, armed: true, digest: session.expectations.digest, proof: 'expectations frozen before observed effects' }; }); }
async function observe(id,{source}={}) { return locked(id, async () => { const session = load(id); if(source && !Object.hasOwn(session.baseline.sources,source))throw new Error(`unknown runtime observation source ${source}`); await verify(session,{source}); const observed = await observeSources(session,R.loadFixture(session.workspace,session.directory),{source}); const baseline=source?{sources:{[source]:session.baseline.sources[source]}}:session.baseline; return { id, ...observed, changes: changes(baseline,observed) }; }); }
async function check(id) { return locked(id, async () => {
  const session = load(id); await verify(session); if (!session.expectations) throw new Error('arm independently reviewed expectations before running the application');
  const contract = session.expectations.value, manifest = R.loadFixture(session.workspace,session.directory), initial = await observeSources(session,manifest);
  await sleep(contract.quietMs); const observed = await observeSources(session,manifest), diff = changes(session.baseline,observed), checks = [];
  const ordered = rows => [...rows].sort((a,b) => require('./scenario-package').json(a).localeCompare(require('./scenario-package').json(b)));
  for (const expected of contract.sources) {
    const actual = observed.sources[expected.id], d = diff[expected.id];
    if (expected.noWrites === true) {
      let noObservedWrites = !d.added.length && !d.removed.length;
      if (expected.id.startsWith('pg:')) { const logical = expected.id.split(':')[1], target = expected.id.split(':').slice(2).join(':'); noObservedWrites &&= !(observed.writeEvidence[logical] || []).some(event => event.target === target); }
      if (expected.id.startsWith('es:')) noObservedWrites &&= isDeepStrictEqual(session.baseline.writeEvidence[expected.id],observed.writeEvidence[expected.id]);
      checks.push({ id: expected.id, assertion: 'no-observed-writes', ok: noObservedWrites });
    }
    for (const key of ['rows','added','removed']) if (Object.hasOwn(expected,key)) { const value = key === 'rows' ? actual : d[key]; checks.push({ id: expected.id, assertion: key, ok: isDeepStrictEqual(ordered(expected[key]),ordered(value)), ...(isDeepStrictEqual(ordered(expected[key]),ordered(value)) ? {} : { expected: expected[key], actual: value }) }); }
  }
  if (contract.allowUnlistedEffects !== true) for (const [id,d] of Object.entries(diff)) if (!contract.sources.some(e => e.id === id)) {
    let clean = !d.added.length && !d.removed.length;
    if (id.startsWith('pg:')) clean &&= !(observed.writeEvidence[id.split(':')[1]] || []).some(event => event.target === id.split(':').slice(2).join(':'));
    if (id.startsWith('es:')) clean &&= isDeepStrictEqual(session.baseline.writeEvidence[id],observed.writeEvidence[id]);
    checks.push({ id, assertion: 'no-unlisted-observed-effects', ok: clean });
  }
  checks.push({ assertion: 'quiet-window-stable', ok: isDeepStrictEqual(initial.sources,observed.sources) && isDeepStrictEqual(initial.writeEvidence,observed.writeEvidence) });
  const result = { version: 1, id, ok: checks.every(c => c.ok), checks, expectationDigest: session.expectations.digest, baselineDigest: session.baselineDigest, observationDigest: hash(observed), changes: diff, proof: { ...observed.proof, level: 'native-observed-effects', applicationExecuted: 'caller-owned; not inferred', quietMs: contract.quietMs } };
  session.result = result; save(session); return result;
}); }
async function publishAction(id,topic,message) { return locked(id,async()=>{
  const session=load(id);await verify(session,{source:`kafka:${topic}`});if(!session.expectations)throw new Error('arm independent expectations before publishing an action');
  const manifest=R.loadFixture(session.workspace,session.directory);if(!Object.hasOwn(manifest.topics || {},topic))throw new Error('Kafka action topic must be declared in the reviewed fixture');
  strict(message,['partition','key','value','headers'],'Kafka action envelope');if(!Object.hasOwn(message,'value'))throw new Error('Kafka action must explicitly provide value, including null for a tombstone');
  const plan=manifest.plan.topics.find(t=>t.topic===topic),errors=require('./fixture-payload').validateEnvelope({...message,offset:'0'},manifest.topics[topic].schema,plan?.codec || 'auto');if(errors.length)throw new Error(errors.join('; '));
  const produced=await publish(session,topic,message,plan?.codec || 'auto');session.actions ||= [];session.actions.push({kind:'kafka',topic,partition:produced.partition,offset:produced.offset,at:new Date().toISOString()});save(session);
  return{id,ok:true,topic,...produced,proof:{level:'owned-broker-action',applicationExecuted:false,consumerEffectsVerified:false}};
}); }
async function stop(id,{startupOwner=false}={}) {
  const session = load(id,true); if (session.status === 'stopped') return { id, stopped: true, alreadyStopped: true };
  const startup = readJson(path.join(location(id),'starting.json'));
  if(startup?.pid && !startupOwner) {
    let alive=true;try{process.kill(startup.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
    if(alive){session.stopRequestedAt=new Date().toISOString();save(session);return{id,stopped:false,state:'stopping',next:'Startup will compensate owned resources; poll fixture_runtime_stop'};}
  }
  const errors = [];
  for (const name of [...session.containers].reverse()) try { if (await owned(session,name)) await docker(['rm','--force',name]); } catch (e) { errors.push(e.message); }
  try { const result = await exec('docker',['network','inspect','--format','{{json .Labels}}',session.network]); if (result.code === 0) { const labels = JSON.parse(result.out); if (labels?.['dt.fixture.owner'] !== session.owner || labels?.['dt.fixture.id'] !== session.id) throw new Error('fixture network ownership mismatch'); await docker(['network','rm',session.network]); } else if (!/not found|No such network/i.test(result.error + result.out)) throw new Error(`cannot inspect fixture network: ${result.error || result.out}`); } catch (e) { errors.push(e.message); }
  if (errors.length) { session.cleanupError = errors; session.status = 'cleanup-failed'; save(session); throw new Error(`fixture cleanup failed: ${errors.join('; ')}`); }
  session.status = 'stopped'; session.stoppedAt = new Date().toISOString(); delete session.password; delete session.applicationPassword; save(session); return { id, stopped: true };
}
async function cleanup() { const results = []; if (!fs.existsSync(ROOT)) return { results }; const reservation=path.join(ROOT,'.reservation.lock'),owner=readJson(path.join(reservation,'owner.json')); if(owner?.pid) { try { process.kill(owner.pid,0); } catch(e) { if(e.code==='ESRCH') {fs.rmSync(reservation,{recursive:true,force:true});results.push({reservationRecovered:true});} } } for (const id of fs.readdirSync(ROOT)) { if (!/^[a-f0-9]{24}$/.test(id)) continue; const session = load(id,true); if (session.status !== 'stopped' && session.expiresAt <= Date.now()) { try { results.push(await stop(id)); } catch (e) { results.push({ id,error:e.message }); } } } return { results, ok: results.every(r => !r.error) }; }
module.exports = { preflight,start,bindings,arm,observe,check,stop,cleanup,delta,changes,validateExpectations,DEFAULT_IMAGES,publish,publishAction,load };
