// Network admission stays shared per target; CPU/build admission is bounded and round-robin by story.
const rate = () => require('./config').getServer().ratePerSec;
const MAX_WAIT = Number(process.env.DT_RATE_MAX_WAIT_MS ?? 30000), next = new Map();
const { create } = require('./state-machine'), admission = require('./lifecycles').admission;
async function take(key) {
  const E = require('./execution'); E.check();
  const RATE = budget(key).ratePerSec; if (!RATE || !key) return 0;
  const gap = 1000 / RATE, now = Date.now(), at = Math.max(now, next.get(key) || 0), wait = at - now;
  if (wait > budget(key).maxWaitMs) throw Object.assign(new Error('rate limit: live target is busy; retry later or batch the question'),{code:'DT_RATE_LIMIT',statusCode:429,retryAfter:Math.ceil(wait/1000)});
  if(next.size>4096)for(const [k,t]of next)if(t<now)next.delete(k);
  if(next.size>=4096&&!next.has(key))throw Object.assign(Error('Target admission capacity reached'),{code:'DT_QUEUE_FULL',statusCode:429,retryAfter:30});
  next.set(key, at + gap);
  const reservation = create(require('./lifecycles').networkAdmission); reservation.to('reserved');
  try { if (wait > 0) { reservation.to('waiting'); await sleep(wait, E.signal()); } E.check(); reservation.to('admitted'); return wait; }
  catch (error) { reservation.to('cancelled'); throw error; }
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(require('./execution').abortError(signal.reason)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
}
class FairScheduler {
  constructor({ concurrency = 1, maxQueued = 100 } = {}) { this.concurrency = concurrency; this.maxQueued = maxQueued; this.running = 0; this.queues = new Map(); this.order = []; this.queued = 0; }
  run(fn, { key = require('./access').owner().scopeKey, signal = require('./execution').signal() } = {}) {
    if (signal?.aborted) return Promise.reject(require('./execution').abortError(signal.reason));
    if (this.queued >= this.maxQueued) return Promise.reject(Object.assign(new Error('Execution queue is full; wait for an active operation to finish'), { code: 'DT_QUEUE_FULL',statusCode:429,retryAfter:1 }));
    return new Promise((resolve, reject) => {
      const lifecycle = create(admission);
      const item = { lifecycle, fn: require('async_hooks').AsyncResource.bind(fn), resolve, reject, signal, key };
      item.abort = () => { const q = this.queues.get(key), i = q?.indexOf(item) ?? -1; if (i < 0) return; lifecycle.to('cancelled'); q.splice(i, 1); this.queued--; this.removeEmpty(key); reject(require('./execution').abortError(signal.reason)); };
      if (!this.queues.has(key)) { this.queues.set(key, []); this.order.push(key); }
      this.queues.get(key).push(item); this.queued++; signal?.addEventListener('abort', item.abort, { once: true });
      queueMicrotask(() => this.drain());
    });
  }
  removeEmpty(key) { if (!this.queues.get(key)?.length) { this.queues.delete(key); this.order = this.order.filter(k => k !== key); } }
  drain() {
    while (this.running < this.concurrency && this.order.length) {
      const key = this.order.shift(), q = this.queues.get(key), item = q.shift(); this.queued--;
      if (q.length) this.order.push(key); else this.queues.delete(key);
      item.signal?.removeEventListener('abort', item.abort);
      if (item.signal?.aborted) { item.lifecycle.to('cancelled'); item.reject(require('./execution').abortError(item.signal.reason)); continue; }
      item.lifecycle.to('running');
      this.running++;
      // Preserve the original async-local owner/trace rather than the context that freed a slot.
      Promise.resolve().then(item.fn).then(value => { item.lifecycle.to('fulfilled'); item.resolve(value); }, error => { item.lifecycle.to('rejected'); item.reject(error); }).finally(() => { this.running--; this.drain(); });
    }
  }
  stats() { return { concurrency: this.concurrency, running: this.running, queued: this.queued, maxQueued: this.maxQueued, scopes: this.queues.size }; }
}
const schedulers = new Map();
function schedule(resource, fn, options = {}) {
  const E = require('./execution'), A = require('async_hooks').AsyncResource;
  const C = require('./config'), c = C.live(() => C.getTools());
  const configured = resource === 'catalog' ? c.catalogReadConcurrency : resource === 'cpu' ? c.workerConcurrency : resource === 'code' ? c.codeConcurrency : c.buildConcurrency;
  const concurrency = Math.max(1, Math.min(8, Number(configured || (resource === 'cpu' ? 1 : 2)))), maxQueued = Math.max(1, Number(c.maxQueued || 100));
  if (!schedulers.has(resource)) schedulers.set(resource, new FairScheduler({ concurrency, maxQueued }));
  else { const scheduler = schedulers.get(resource); scheduler.concurrency = concurrency; scheduler.maxQueued = maxQueued; }
  const bound = A.bind(fn);
  return E.track(schedulers.get(resource).run(bound, options));
}
const networkSchedulers=new Map();
function budget(key){const map=require('./config').getServer().networkBudgets||{},v=map[key]||map[key.split(':')[0]+':*']||{};return {ratePerSec:v.ratePerSec??rate(),concurrency:v.concurrency||4,maxQueued:v.maxQueued||100,maxWaitMs:v.maxWaitMs??MAX_WAIT};}
async function network(key,fn){
 const b=budget(key),E=require('./execution');
 if(!networkSchedulers.has(key)){if(networkSchedulers.size>=1024)for(const [k,s]of networkSchedulers)if(!s.running&&!s.queued)networkSchedulers.delete(k);if(networkSchedulers.size>=1024)throw Object.assign(Error('Too many active network targets'),{code:'DT_QUEUE_FULL',statusCode:429,retryAfter:30});networkSchedulers.set(key,new FairScheduler(b));}
 const scheduler=networkSchedulers.get(key);scheduler.concurrency=b.concurrency;scheduler.maxQueued=b.maxQueued;
 let began=false;const timeout=AbortSignal.timeout(b.maxWaitMs),signal=E.signal(),admission=signal?AbortSignal.any([signal,timeout]):timeout,t=Date.now();
 try{return await E.track(scheduler.run(async()=>{await take(key);if(timeout.aborted)throw Error('Admission deadline exceeded');began=true;require('./operational-metrics').record('admission',Date.now()-t);return fn();},{signal:admission}));}
 catch(error){if(!began&&timeout.aborted&&!signal?.aborted)throw Object.assign(Error('Live target admission timed out; retry later'),{code:'DT_RATE_LIMIT',statusCode:429,retryAfter:1});throw error;}
}
const stats = () => Object.fromEntries([...schedulers].map(([key, s]) => [key, s.stats()]));
module.exports = { take, rate, sleep, FairScheduler, schedule, stats, status: () => ({...stats(),network:{targets:networkSchedulers.size,running:[...networkSchedulers.values()].reduce((n,s)=>n+s.running,0),queued:[...networkSchedulers.values()].reduce((n,s)=>n+s.queued,0)}}), network, budget };
