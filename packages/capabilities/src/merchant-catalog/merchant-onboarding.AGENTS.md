# Merchant Onboarding and membership

`merchant-onboarding.ts` owns the first persisted Booking Product authorization boundary.

## Public surface

- `MerchantOnboarding.status(userId)` resolves verification and current ownership.
- `MerchantOnboarding.complete(userId, payload)` validates public identity and atomically creates the Merchant, sole Owner membership, default Provider, and Unpublished Public Booking Page.
- `MerchantMembership.resolveForUser(userId)` and `resolveBySlug(userId, slug)` re-read persisted membership for every protected request. Unknown and unauthorized requested slugs both return `MerchantNotFound`.
- `buildSeedBookingScenario(anchorTime)` is the sole typed, deterministic booking fixture builder. Its clock anchor is mandatory.

## Invariants

1. Better Auth's `user` row remains valid when onboarding is abandoned or fails; there are no persisted onboarding drafts.
2. The D1 batch is the only live completion boundary. Never split its four inserts across requests.
3. `merchant_memberships` is the authority source. Provider linkage or status never grants Merchant access.
4. The first slice has one Owner per Merchant and at most one owned Merchant per person. Do not introduce an active-Merchant selector or Workspace bridge.
5. Seed and Live adapters implement the same capability shapes. Runtime Merchant App requests always use the Live adapter; Seed is test/fixture infrastructure only.

## Storage

Reads and writes `user`, `merchants`, `merchant_memberships`, `providers`, and `public_booking_pages`. Local reseeding deletes only the deterministic seed Merchant ID and relies on cascading deletion for that graph.
