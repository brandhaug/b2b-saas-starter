# Scheduling and Public Booking Page

`scheduling.ts` owns Merchant-scoped recurring weekly `ScheduleRule` reads and
replacement, deterministic Availability derivation, Booking Readiness, the two-state
publication transition, and the public current-data read model.

- Schedule mutations require `MerchantContext`; public resolution is deliberately
  unscoped and returns only customer-visible fields.
- Availability is derived from rules, active catalog inputs, eligibility, an explicit
  clock instant, and the Merchant IANA timezone. Never persist generated Time Slots.
- Readiness requires public name, slug, active Service, an eligible active Provider,
  and rules for that Provider. Do not add runtime slot, Shop, Brand, checkout, or
  provider-configuration checks.
- Publication is only `published` or `unpublished`; reads always use current data.
