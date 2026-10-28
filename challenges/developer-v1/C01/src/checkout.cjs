exports.grossCents = function(lines, vatBps) {
  if (!Array.isArray(lines) || !Number.isSafeInteger(vatBps) || vatBps < 0) throw new Error('invalid basket');
  let gross = 0;
  for (const {unitCents, quantity} of lines) {
    if (!Number.isSafeInteger(unitCents) || unitCents < 0 || !Number.isSafeInteger(quantity) || quantity < 0) throw new Error('invalid line');
    gross += Math.round(unitCents * (10000 + vatBps) / 10000) * quantity;
  }
  if (!Number.isSafeInteger(gross)) throw new Error('total outside safe range');
  return gross;
};
