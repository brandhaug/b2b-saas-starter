# Operations Messaging Workspaces

This module owns purpose-built, masked Operations App projections for daily
Operational Messaging investigation, reconciliation, containment, incidents, and
finance. Every method authorizes the current Operator Session against D1 and checks
exactly one Messaging Operator Permission.

- Search only by internal intent/attempt identity, Merchant identity, or the last
  three destination digits. Never project message bodies, Confirmation URLs, raw
  callbacks, reusable provider references, credentials, fingerprints, or unmasked
  destinations.
- Evidence is append-only normalized evidence. Attempts, reservations, charges,
  provider costs, and Merchant ledger facts remain distinct.
- This read contract never grants Merchant authority or accepts an impersonated
  Merchant Session.
