# Foreign-currency ledger posting disagrees with invoice

Ledger posting of KWD 1.005 records 101 minor units. The invoice contract is USD/EUR two decimals, JPY zero and KWD three. The service accepts exact nonnegative decimal major amounts and returns minor units with half-up rounding; values outside signed long range must fail. Diagnose across the service dependency and add regression coverage.
