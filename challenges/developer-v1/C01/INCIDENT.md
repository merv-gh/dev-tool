# Checkout totals drift on multi-unit promotions

The checkout report for a three-unit basket differs from finance. Compute gross cents by extending the unit net price for each line, summing net cents, then applying invoice VAT once with half-up rounding. Inputs are nonnegative integer cents/quantities; reject invalid values and noninteger VAT basis points. Implement a fix and regression tests.
