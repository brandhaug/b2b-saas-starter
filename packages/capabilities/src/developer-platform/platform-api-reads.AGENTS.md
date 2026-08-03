# Platform API reads

Merchant-scoped read projections for `/v1/merchant`, Services, Providers, and Appointments. The capability owns public DTO shaping, deterministic filtering and ordering, and stateless cursor traversal. It reads `merchants`, `public_booking_pages`, `services`, `providers`, `provider_service_eligibility`, and immutable `appointments` snapshots.

Cursor signatures use HMAC-SHA256 with `PLATFORM_API_CURSOR_SECRET`, injected by the API Worker. Cursor payloads may contain only endpoint, normalized filter hash, sort position, schema version, and expiry; never Customer Details or raw filter values.

Do not expose internal Merchant identity, ownership, payment, confirmation, policy, or mutable live catalog values in Appointment snapshots. Missing and cross-Merchant detail reads must remain indistinguishable.
