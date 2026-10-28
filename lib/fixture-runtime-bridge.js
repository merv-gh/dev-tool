// Bind an already-owned native dependency lease to a project test run. This does not start,
// stop, claim an action, or certify effects; arm/check/stop remain separate caller operations.
const HASH = /^[a-f0-9]{64}$/;
function loopback(value, protocols, name) {
  let url; try { url = new URL(value); } catch { throw new Error(`invalid owned fixture ${name}`); }
  if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash) throw new Error(`owned fixture ${name} must be a loopback endpoint without embedded credentials`);
  return url;
}
async function bindings(id) { return require('./reproduction-runtime').bindings(id); }
async function resolve(id, { workspace, executionTarget, fixtureBindings } = {}) {
  if (!/^[a-f0-9]{24}$/.test(id || '')) throw new Error('invalid fixture_runtime lease id');
  if (!['local', 'captured-dev'].includes(executionTarget.metadata.kind) || executionTarget.runnerUrl || executionTarget.requireRunner || executionTarget.metadata.host.placement !== 'local') throw new Error('fixture_runtime requires a local or captured-dev target executing on this host');
  const b = await module.exports.bindings(id);
  if (b.id !== id || b.workspace !== workspace || b.runnerHost !== 'local' || b.environment !== 'owned-local-fixture' || !HASH.test(b.fixtureDigest || '') || !HASH.test(b.profileDigest || '')) throw new Error('native fixture binding identity, workspace or proof digest mismatch');
  if (!b.databases || typeof b.databases !== 'object' || Array.isArray(b.databases)) throw new Error('invalid native fixture database bindings');
  const kinds = [];
  for (const [logical, db] of Object.entries(b.databases)) {
    if (!logical || !db || typeof db.database !== 'string' || typeof db.user !== 'string' || typeof db.password !== 'string' || !db.password) throw new Error('invalid native fixture datasource');
    const endpoint = loopback(db.url, ['postgresql:', 'postgres:'], 'Postgres');
    if (decodeURIComponent(endpoint.pathname) !== `/${db.database}` || db.jdbcUrl !== `jdbc:${db.url}`) throw new Error('native fixture JDBC/URL database identity mismatch');
  }
  if (Object.keys(b.databases).length) kinds.push('pg');
  if (b.es) { loopback(b.es, ['http:', 'https:'], 'Elasticsearch'); kinds.push('es'); }
  if (b.kafka) { const endpoint = loopback(`kafka://${b.kafka}`, ['kafka:'], 'Kafka'); if (endpoint.pathname && endpoint.pathname !== '/') throw new Error('invalid native Kafka bootstrap endpoint'); kinds.push('kafka'); }
  if (b.proof?.level !== 'native-dependencies' || kinds.some(k => !/^sha256:[a-f0-9]{64}$/.test(b.proof.imageIds?.[k] || ''))) throw new Error('native fixture image ownership proof is incomplete');
  if (Object.keys(b.databases).length && !fixtureBindings) throw new Error('native PostgreSQL datasources require explicit fixture_bindings for every captured database');
  const env = Object.keys(b.databases).length ? require('./testrun').fixtureEnvironment(b.databases, fixtureBindings) : {};
  if (!Object.keys(b.databases).length && fixtureBindings && Object.keys(fixtureBindings).length) throw new Error('fixture_bindings names databases absent from native runtime');
  if (b.es) env.SPRING_ELASTICSEARCH_URIS = b.es;
  if (b.kafka) env.SPRING_KAFKA_BOOTSTRAP_SERVERS = b.kafka;
  env.DT_NATIVE_FIXTURE_BINDINGS = JSON.stringify({ version: 1, id, databases: b.databases, es: b.es, kafka: b.kafka, offsetMappings: b.offsetMappings, fixtureDigest: b.fixtureDigest, profileDigest: b.profileDigest, environment: b.environment });
  const metadata = { id, workspace, directory: b.directory, environment: b.environment, runnerHost: b.runnerHost, fixtureDigest: b.fixtureDigest, profileDigest: b.profileDigest, databases: Object.keys(b.databases), systems: kinds, offsetMappings: b.offsetMappings, ownership: 'caller-retained lease; use arm, independent check, then stop', proof: Object.fromEntries(['level','applicationExecuted','runtimeReadsVerified','sourceWrites','network','distributedSnapshot','sourceKafkaOffsetsPreserved','sourceKafkaTimestampsPreserved','imageIds'].filter(k => b.proof[k] !== undefined).map(k => [k,b.proof[k]])), effectsVerified: false, runtimeReadsVerified: false };
  return { env, metadata, secrets: [...Object.values(env), ...Object.values(b.databases).flatMap(db => [db.password, db.url, db.jdbcUrl])].map(String) };
}
module.exports = { resolve, bindings };
