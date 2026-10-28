exports.reconcile = function(state, event) {
  if (!event || !/^[0-9]+$/.test(String(event.tenantId)) || !/^[0-9]+$/.test(String(event.orderId))) throw new Error('invalid identity');
  const key = `${Number(event.tenantId)}:${Number(event.orderId)}`;
  if (state.seen.includes(key)) return { applied: false, key };
  state.seen.push(key);
  return { applied: true, key };
};
