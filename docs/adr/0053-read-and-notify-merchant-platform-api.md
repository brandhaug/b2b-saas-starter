# Read-and-notify merchant Platform API

The Booking Product's `/v1` Platform API is a merchant-scoped, server-to-server read-and-notify surface: bearer tokens identify exactly one Merchant, integrations can read Merchant, Service, Provider, and Appointment records, and mutations are limited to API Token and Webhook Endpoint configuration. Booking Sessions, Availability, checkout, Appointment confirmation, and merchant catalog or scheduling writes remain first-party capability operations, preventing the external contract from becoming a parallel booking engine.

Appointment webhooks are signed, at-least-once, thin notifications containing resource identity and status rather than Customer Details; integrations fetch the authoritative Appointment when they need its snapshot, keeping PII out of queues and delivery logs while making duplicate or out-of-order delivery safe to reconcile.
