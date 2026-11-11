// Content-free OpenTelemetry. Opt in per authenticated chat; diagnostics never
// authorize work, retain payloads, or become a dependency of successful work.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const api = require('@opentelemetry/api');
const scopeContext = api.createContextKey('dev-tool.scope');
const { isMainThread, parentPort } = require('node:worker_threads');
const A = require('./access');
const transport = new (require('node:async_hooks').AsyncLocalStorage)();
const scopeKey = () => transport.getStore()?.scope || A.current().scopeKey;
const instance = crypto.randomUUID();
const preferences = new Map(), active = new Map(), recent = new Map();
let propagator, provider, tracer, meterProvider, duration, completed, exporter, resource, store, configured, observation;
let exportFailures = 0, exported = 0, exportDropped = 0, dropped = 0;
const exporting = new Set();
const version = require('../package.json').version;
const home = () => path.join(require('./config').PATHS.cache, 'telemetry');
function settings() {
  const config = require('./config').resolved ? require('./config').resolved('telemetry') : require('./config').load().raw.telemetry || {};
  const value = key => typeof config[key] === 'string' ? require('./config').interpolate(config[key], name => require('./config').load().lookup()(name)) : config[key];
  const env = process.env;
  return { available: env.DT_TELEMETRY_ENABLED !== '0' && value('enabled') !== false && value('enabled') !== 'false' && env.DT_TELEMETRY_ENABLED !== 'false' && env.OTEL_SDK_DISABLED !== 'true',
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT || value('endpoint') || '',
    tracesEndpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || value('tracesEndpoint') || '',
    metricsEndpoint: env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || value('metricsEndpoint') || '',
    serviceName: env.OTEL_SERVICE_NAME || value('serviceName') || 'dev-tool',
    sampleRatio: Number.isFinite(Number(value('sampleRatio'))) ? Math.max(0,Math.min(1,Number(value('sampleRatio')))) : 1 };
}
function scopeFile() { return path.join(home(), 'preferences', A.current().scopeKey + '.json'); }
function preference() {
  const key = A.current().scopeKey, previous = preferences.get(key);
  if (previous && Date.now() - previous.checked < 1000) return previous.enabled;
  let enabled = false; try { enabled = JSON.parse(fs.readFileSync(scopeFile(), 'utf8')).enabled === true; } catch {}
  if (preferences.size > 1000) preferences.delete(preferences.keys().next().value);
  preferences.set(key, { checked: Date.now(), enabled }); return enabled;
}
function enabled() { try { return settings().available && (transport.getStore()?.enabled || preference()); } catch { return false; } }
function setEnabled(value) {
  if (typeof value !== 'boolean') throw Object.assign(Error('enabled must be boolean'), { statusCode: 400 });
  if (!settings().available && value) throw Object.assign(Error('Tracing is disabled by the operator'), { statusCode: 403 });
  require('./atomic-file').atomicFile(scopeFile(), JSON.stringify({ enabled: value }) + '\n', { mode: 0o600 });
  preferences.set(A.current().scopeKey, { enabled: value, checked: Date.now() }); return { enabled: value };
}
const safeName = value => /^[a-zA-Z0-9_.:/ -]{1,100}$/.test(String(value || '')) ? String(value) : 'operation';
const allowed = new Set(['dt.scope_key','dt.execution.id','dt.parent_execution.id','dt.call.id','dt.tool.name','dt.kind','dt.state','dt.runtime','dt.cleanup.incomplete','dt.cancelled','dt.source','dt.registry.revision','http.request.method','http.route','http.response.status_code','error.type','dt.machine','dt.from','dt.to','dt.accepted','gen_ai.operation.name','gen_ai.request.model','gen_ai.usage.input_tokens','gen_ai.usage.output_tokens','dt.model.purpose']);
function attributes(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^[a-zA-Z0-9_./: {}*-]{1,160}$/.test(value))).slice(0, 24));
}
const timeMs = value => value[0] * 1000 + value[1] / 1e6;
function record(span, running = false) {
  const context = span.spanContext();
  return { traceId: context.traceId, spanId: context.spanId, traceFlags: context.traceFlags, parentSpanId: span.parentSpanContext?.spanId || null,
    observerInstance: instance, name: span.name, kind: span.kind, scope: span.attributes['dt.scope_key'], startTime: span.startTime, startMs: timeMs(span.startTime),
    ...(running ? { running: true } : { endTime: span.endTime, duration: span.duration, durationMs: timeMs(span.duration), status: span.status.code === api.SpanStatusCode.ERROR ? 'error' : span.attributes['dt.cancelled'] ? 'cancelled' : 'ok' }),
    attributes: attributes(span.attributes), droppedEvents: span.droppedEventsCount || 0, events: span.events.slice(0, 32).map(event => ({ name: safeName(event.name), time: event.time, attributes: attributes(event.attributes) })) };
}
function remember(row, running) {
  if (!row || !/^[a-f0-9]{32}$/.test(row.traceId) || !/^[a-f0-9]{16}$/.test(row.spanId) || !/^(legacy|[a-f0-9]{32})$/.test(row.scope)) return;
  const key = row.traceId + ':' + row.spanId;
  if (running) {
    if (active.size >= 1024) { dropped++; return; } active.set(key, row);
  } else {
    active.delete(key); recent.set(key, row); if (recent.size > 2000) recent.delete(recent.keys().next().value);
  }
  if (!store) store = new (require('./telemetry-store').TraceStore)(path.join(home(), 'traces.sqlite'));
  store.put(row);
}
function ingest(message, scope = A.current().scopeKey, producer) {
  try {
    if (!message?.row || message.row.scope !== scope) return;
    message.row.observerInstance = instance;
    if (producer) message.row.producer = producer;
    remember(message.row, message.running);
    if (!message.running) {
      exporter?.onEnd(readable(message.row));
      if(Number.isFinite(message.row.durationMs)){duration?.record(message.row.durationMs,{'dt.kind':message.row.attributes?.['dt.kind']||'operation',outcome:message.row.status});completed?.add(1,{'dt.kind':message.row.attributes?.['dt.kind']||'operation',outcome:message.row.status});}
    }
  } catch { dropped++; }
}
function interruptProducer(producer) {
  for (const [key,row] of active) if (row.producer === producer) { row.orphaned = true; row.observedUntil = Date.now(); active.delete(key); recent.set(key,row); if(recent.size>2000)recent.delete(recent.keys().next().value); store?.put(row); }
}
function readable(row) {
  return { ...row, name: safeName(row.name), spanContext: () => ({ traceId: row.traceId, spanId: row.spanId, traceFlags: row.traceFlags }), parentSpanContext: row.parentSpanId ? { traceId: row.traceId, spanId: row.parentSpanId, traceFlags: row.traceFlags } : undefined,
    status: { code: row.status === 'error' ? api.SpanStatusCode.ERROR : api.SpanStatusCode.OK }, ended: true, links: [], resource, instrumentationScope: { name: 'dev-tool.worker', version }, droppedAttributesCount: 0, droppedEventsCount: 0, droppedLinksCount: 0 };
}
function init() {
  if (provider) return;
  configured = settings();
  const { TracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace');
  resource = require('@opentelemetry/resources').resourceFromAttributes({ 'service.name': safeName(configured.serviceName), 'service.version': version, 'service.instance.id': instance });
  const local = { onStart(span) { const row = record(span, true); if(transport.getStore()?.sink)transport.getStore().sink({row,running:true});else if (isMainThread) remember(row, true); else parentPort?.postMessage({ dtTelemetry: { row, running: true } }); },
    onEnd(span) { const row = record(span); if(transport.getStore()?.sink)transport.getStore().sink({row,running:false});else if (isMainThread) remember(row, false); else parentPort?.postMessage({ dtTelemetry: { row, running: false } });
      duration?.record(row.durationMs, { 'dt.kind': row.attributes['dt.kind'] || 'operation', outcome: row.status }); completed?.add(1, { 'dt.kind': row.attributes['dt.kind'] || 'operation', outcome: row.status }); },
    forceFlush: async () => { await store?.flush(); }, shutdown: async () => { await store?.close(); } };
  const processors = [local];
  if (isMainThread && (configured.endpoint || configured.tracesEndpoint)) {
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const remote = new OTLPTraceExporter({ ...(configured.tracesEndpoint || configured.endpoint ? { url: configured.tracesEndpoint || configured.endpoint.replace(/\/$/, '') + '/v1/traces' } : {}), timeoutMillis: 2000 });
    const send = remote.export.bind(remote);
    remote.export = (batch, callback) => {
      const done = result => { for (const span of batch) { const c = span.spanContext(); exporting.delete(c.traceId + ':' + c.spanId); } if (result.code) exportFailures++; else exported += batch.length; callback(result); };
      try { send(batch, done); } catch { done({ code: 1 }); }
    };
    const batch = new BatchSpanProcessor({ exporter: remote, maxQueueSize: 2048, maxExportBatchSize: 128, scheduledDelayMillis: 1000, exportTimeoutMillis: 2500 });
    exporter = { onStart() {}, onEnd(span) {
      if (!(span.spanContext().traceFlags & api.TraceFlags.SAMPLED)) return;
      if (exporting.size >= 2048) { exportDropped++; return; }
      const c = span.spanContext(); exporting.add(c.traceId + ':' + c.spanId); batch.onEnd(span);
    }, forceFlush: () => batch.forceFlush(), shutdown: () => batch.shutdown() }; processors.push(exporter);
  }
  provider = new TracerProvider({ resource, sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(configured.sampleRatio) }), spanProcessors: processors, spanLimits: { attributeCountLimit: 24, eventCountLimit: 32, attributeValueLengthLimit: 160 } });
  api.context.setGlobalContextManager(new (require('@opentelemetry/context-async-hooks').AsyncLocalStorageContextManager)().enable());
  propagator = new (require('@opentelemetry/core').W3CTraceContextPropagator)();
  api.propagation.setGlobalPropagator(propagator);
  api.trace.setGlobalTracerProvider(provider); tracer = provider.getTracer('dev-tool', version);
  if (isMainThread && (configured.endpoint || configured.metricsEndpoint)) {
    const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics'), { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
    const metrics = new OTLPMetricExporter({ url: configured.metricsEndpoint || configured.endpoint.replace(/\/$/, '') + '/v1/metrics', timeoutMillis: 2000 });
    meterProvider = new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: metrics, exportIntervalMillis: 10000, exportTimeoutMillis: 2500 })] });
    api.metrics.setGlobalMeterProvider(meterProvider);
    const meter = meterProvider.getMeter('dev-tool', version); duration = meter.createHistogram('dt.operation.duration', { unit: 'ms', description: 'Wall time of opted-in operations, including waits' }); completed = meter.createCounter('dt.operation.completed');
  }
  observation = require('./state-machine').observe(event => {
    if (!['transition','rejected'].includes(event.kind) || event.machine.startsWith('SM79.')) return;
    if(api.context.active().getValue(scopeContext)!==scopeKey()||!enabled())return;
    const span = api.trace.getActiveSpan(); if (span?.isRecording()) span.addEvent('state.' + event.kind, attributes({ 'dt.machine': event.machine, 'dt.from': event.from, 'dt.to': event.to, 'dt.accepted': event.kind === 'transition' }));
  });
  process.once('beforeExit', () => flush().catch(() => {}));
}
const knownSteps = new Set(['git init','git fetch','git checkout','git ls-remote','maven prepare','javac main','javac tests','gradle classpath','maven classpath','compile check','test database','resolve repo','deployed commit','extract','libraries','code index and flows','verify library repos']);
function stepName(name) { const clean=String(name).split(' (')[0];return knownSteps.has(clean)?'step.'+clean.replace(/ /g,'.'):String(name).startsWith('library ')?'step.library':'step'; }
function begin(name, input = {}, options = {}) {
  if (!enabled()) return null;
  try {
    init();
    const current = api.context.active(), parentScope = current.getValue(scopeContext);
    const parent = options.root || parentScope && parentScope !== scopeKey() ? api.ROOT_CONTEXT : current;
    const span = tracer.startSpan(safeName(name), { kind: options.kind ?? api.SpanKind.INTERNAL, attributes: attributes({ ...input, 'dt.scope_key': scopeKey() }) }, parent);
    const context = api.trace.setSpan(parent, span).setValue(scopeContext, scopeKey()); let ended = false;
    return { span, traceId: span.spanContext().traceId, spanId: span.spanContext().spanId, run: fn => api.context.with(context, fn),
      end(error, final = {}) { if (ended) return; ended = true; try { const cancelled = error?.name === 'AbortError' || error?.code === 'DT_CANCELLED' || final['dt.cancelled']; span.setAttributes(attributes({ ...final, ...(cancelled ? { 'dt.cancelled': true } : {}) }));
        if (error && !cancelled) { span.setAttribute('error.type', /^[A-Z_0-9]{1,64}$/.test(error.code || '') ? error.code : 'Error'); span.setStatus({ code: api.SpanStatusCode.ERROR }); }
        else span.setStatus({ code: api.SpanStatusCode.OK }); span.end(); } catch { dropped++; } } };
  } catch { dropped++; return null; }
}
async function run(name, input, fn, options) { const span = begin(name, input, options); if (!span) return fn(); try { const result = await span.run(fn); span.end(); return result; } catch (error) { span.end(error); throw error; } }
function carrier() { if (!provider || !enabled()) return null; const scoped=api.context.active().getValue(scopeContext);if(scoped&&scoped!==scopeKey())return null; const out = {}; propagator.inject(api.context.active(), out, api.defaultTextMapSetter); return out.traceparent ? {traceparent:out.traceparent} : null; }
function withCarrier(value, fn) {
  if (!enabled() || !value?.traceparent || !/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/.test(value.traceparent)) return fn();
  try { init(); } catch { return fn(); }
  return api.context.with(propagator.extract(api.ROOT_CONTEXT, { traceparent: value.traceparent }, api.defaultTextMapGetter).setValue(scopeContext,scopeKey()), fn);
}
// Only call after authenticating the runner transport. Scope is correlation,
// never a principal credential, and no baggage/HTTP headers are propagated.
function remote(value, sink, fn) {
  if (!/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/.test(value?.traceparent||'') || !/^(legacy|[a-f0-9]{32})$/.test(value.scope||'')) return fn();
  return transport.run({enabled:true,scope:value.scope,sink},()=>withCarrier(value,fn));
}
async function snapshot(options = {}) {
  const scope = A.current().scopeKey;
  if (!store && fs.existsSync(path.join(home(), 'traces.sqlite'))) store = new (require('./telemetry-store').TraceStore)(path.join(home(), 'traces.sqlite'));
  const saved = await store?.read(scope, options) || [];
  for(const row of saved)if(row.running&&row.observerInstance!==instance){row.orphaned=true;row.observedUntil ||= row.startMs;}
  const merged = new Map(saved.map(row => [row.spanId, row]));
  for (const row of [...recent.values(), ...active.values()]) if (row.scope === scope && (!options.traceId || row.traceId === options.traceId)) merged.set(row.spanId, row);
  const spans = [...merged.values()].sort((a,b)=>a.startMs-b.startMs).slice(-Math.max(1,Math.min(2000,Number(options.limit)||1000)));
  const admin = A.current().role === 'admin';
  return { protocol: 'dt.observability/v1', available: settings().available, enabled: enabled(), sampled: true, sampleRatio: configured?.sampleRatio ?? settings().sampleRatio, spans, storage: admin ? store?.status() || { state: 'cold', dropped: 0, persistence: 'idle' } : { persistence: store?.status().persistence || 'idle' },
    exporter: { configured: !!(settings().endpoint || settings().tracesEndpoint), initialized: !!exporter, ...(admin ? { exported, failures: exportFailures, dropped: exportDropped, queued: exporting.size } : {}), restartRequired: !!configured && JSON.stringify(configured) !== JSON.stringify(settings()) }, ...(admin ? { dropped } : {}),
    meaning: 'Sampled diagnostic spans in this chat. Running spans remain open. Durations include waits and are not CPU usage. Arguments, outputs, SQL, headers and error messages are excluded.' };
}
async function flush() { await Promise.allSettled([provider?.forceFlush({timeoutMillis:3000}), meterProvider?.forceFlush(), store?.flush()]); }
async function shutdown() { observation?.(); await flush(); await provider?.shutdown(); await meterProvider?.shutdown(); await store?.close(); }
function chrome(snapshot) { return require('../web/trace-format').chrome(snapshot); }

function health(){return {dropped:dropped+exportDropped+(store?.status().dropped||0),exportFailures,queued:exporting.size};}
function annotate(input){try{if(enabled()&&api.context.active().getValue(scopeContext)===scopeKey())api.trace.getActiveSpan()?.setAttributes(attributes(input));}catch{}}
module.exports = {annotate,health, remote, stepName, begin, run, carrier, withCarrier, snapshot, setEnabled, enabled, flush, shutdown, ingest, interruptProducer, chrome, settings };
