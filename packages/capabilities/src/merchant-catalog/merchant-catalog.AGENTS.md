# Merchant Catalog configuration

`merchant-catalog.ts` owns merchant-scoped Services, Providers, their lifecycle, and
explicit Provider-Service eligibility.

## Public surface

- `MerchantCatalog.read()` returns every current and inactive catalog record for
  operations and historical inspection.
- `MerchantCatalog.readBookable()` returns only active Services that have an active,
  explicitly eligible Provider, plus active Providers.
- Service and Provider create/update commands validate display data and lifecycle.
- `setServiceEligibility` replaces one Service's normalized eligibility associations
  atomically.
- `MerchantContext` is resolved from persisted Owner membership at the request boundary;
  capability commands never accept a caller-supplied Merchant id.

## Invariants

1. Eligibility exists only in `provider_service_eligibility`; never infer it from
   membership, default designation, or embedded arrays.
2. Every read and mutation uses `MerchantContext.id`. Unknown and cross-Merchant ids use
   the same `item_not_found` failure.
3. Inactive records remain readable and are updated in place. There is no hard-delete
   command.
4. Solo retains its persisted default Provider but rejects additional Provider creation.
   Team exposes Provider administration and must retain exactly one default through the
   capability's update flow.
5. Seed and Live layers implement the same shape. The canonical Booking fixture is the
   only authored graph; Solo and incomplete graphs are derived variants.

## Storage

Reads and writes `merchants`, `providers`, `services`, and
`provider_service_eligibility`. Real-D1 triggers enforce that an eligibility row's
Merchant matches both referenced records.
