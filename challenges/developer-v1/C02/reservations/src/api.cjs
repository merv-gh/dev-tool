exports.reserve = function(body) {
  if (!body || typeof body.orderId !== 'string' || !body.orderId || !Number.isSafeInteger(body.amountCents) || body.amountCents < 0 || !/^[A-Z]{3}$/.test(body.currency)) throw new Error('invalid reservation');
  return { ...body, status: 'RESERVED' };
};
