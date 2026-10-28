# Implement cancellation quotation

Implement quoteCancellation(booking, minutesToDeparture) and tests. Only CONFIRMED bookings may be quoted. Nonrefundable bookings always refund 0. For refundable bookings: at least 48 hours remaining refunds 100% of paidCents; at least 24 but under 48 hours refunds 50% rounded down; otherwise refunds 0. Retained cents equal paid minus refund. Accept nonnegative safe integer paid cents and nonnegative finite minutes, reject everything else without modifying booking. Return {refundCents,retainedCents}.
