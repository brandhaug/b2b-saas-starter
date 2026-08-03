# Service Buffer configuration

`service-buffers.ts` owns the one bounded decoder shared by Merchant Catalog writes,
Merchant Availability, and customer Booking Scheduling. Persisted configuration is
untrusted: missing fields use the zero-minute launch default, while malformed, negative,
over-120, fractional, or non-five-minute values fail closed.
