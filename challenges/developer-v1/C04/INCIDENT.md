# Production reservations expire during checkout

Staging checkout remains reserved for 90 seconds. Production expires almost immediately after a configuration rollout. Reservation TTL accepts a positive integer millisecond value or a string consisting of a positive integer plus ms, s or m. Invalid/missing values must fail configuration loading. Preserve configured duration in both environments and add tests.
