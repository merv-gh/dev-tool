# Reservation authorized for the wrong amount

Checkout 12.50 EUR appears in reservation history as 0.12 EUR. The reservations API contract is POST /reservations {orderId:string, amountCents:nonnegative-safe-integer, currency:three-uppercase-letters}. Checkout accepts {id:string,total:string,currency:string}; total is an exact decimal amount in major units with at most two fractional digits. Preserve cents and identity end to end. Fix the faulty side of this integration and add tests; malformed totals must cause no downstream request.
