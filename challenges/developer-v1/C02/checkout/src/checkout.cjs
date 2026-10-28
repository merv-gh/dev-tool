exports.place = async function(order, reservations) {
  if (!order || typeof order.id !== 'string' || !order.id || !/^[A-Z]{3}$/.test(order.currency)) throw new Error('invalid order');
  const total = Number(order.total);
  if (!Number.isFinite(total) || total < 0) throw new Error('invalid total');
  return reservations({ orderId: order.id, amountCents: Math.trunc(total), currency: order.currency });
};
