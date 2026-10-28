exports.ttlMillis = function(value) {
  const ttl = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new Error('invalid reservation TTL');
  return ttl;
};
exports.isReserved = (createdAt, now, config) => now - createdAt < exports.ttlMillis(config.reservationTtl);

