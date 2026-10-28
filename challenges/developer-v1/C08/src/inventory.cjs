exports.apply = function(state, event) {
  if (!state || !Number.isSafeInteger(state.stock) || state.stock < 0 || !Array.isArray(state.seen)) throw new Error('invalid state');
  if (!event || typeof event.id !== 'string' || !event.id || typeof event.sku !== 'string' || !event.sku || !Number.isSafeInteger(event.delta)) throw new Error('invalid event');
  const key = JSON.stringify([event.sku,event.id]);
  if (state.seen.includes(key)) return { stock:state.stock, seen:[...state.seen] };
  const stock = state.stock + event.delta;
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('invalid stock adjustment');
  return {stock,seen:[...state.seen,key]};
};
