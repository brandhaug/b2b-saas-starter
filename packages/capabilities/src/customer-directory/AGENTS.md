# Customer Directory

This bounded context owns Merchant-scoped Customer Records, conservative exact-contact
matching, private notes and bans, merge/split provenance, import/export, and retention.

- A Customer Record is not a Customer Account and never crosses a Merchant boundary.
- Names never match automatically. Conflicting or ambiguous contacts create possible duplicates.
- Appointment Customer Details snapshots are owned by Booking and are never mutated here.
- Public eligibility responses are generic; private ban reasons are Owner-only.
- Owner mutations require optimistic revisions, idempotency keys, actor attribution, and
  history. Appointment observation ingestion instead uses the immutable Appointment ID
  as its idempotency key, records the origin actor, and advances the aggregate revision
  inside the same atomic Appointment batch.
