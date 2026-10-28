# Reconciliation skips a neighboring order

Two paid events with different decimal order identifiers are present, but the second reconciliation is skipped. Order IDs are decimal strings, including values larger than JavaScript safe integers. Deduplicate only an identical tenant and order pair; equal order IDs in different tenants are independent. Accept safe integer numeric IDs for compatibility, reject unsafe numbers and malformed identities before mutating state. Add a fix and tests.
