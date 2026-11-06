// One in-flight preparation per identity. Durable cache validity is a separate
// concern: finishing a promise does not make a classpath/index fresh forever.
const { create } = require('./state-machine');
class KeyedWork {
  constructor(model, { retainTick = true } = {}) { this.model = model; this.retainTick = retainTick; this.items = new Map(); }
  run(key, fn) {
    const old = this.items.get(key); if (old) return old.promise;
    const entry = { lifecycle: create(this.model) };
    entry.promise = Promise.resolve().then(() => { entry.lifecycle.to('running'); return fn(); }).then(
      value => { entry.lifecycle.to(value?.error ? 'failed' : 'ready'); return value; },
      error => { entry.lifecycle.to('failed'); throw error; },
    ).finally(() => {
      // Keep same-tick observers on the same result. Never evict a newer run.
      const evict = () => { if (this.items.get(key) === entry) this.items.delete(key); };
      if (this.retainTick) setTimeout(evict, 0); else evict();
    });
    this.items.set(key, entry); return entry.promise;
  }
  entries() { return [...this.items].map(([key, entry]) => [key, entry.promise]); }
}
module.exports = { KeyedWork };
