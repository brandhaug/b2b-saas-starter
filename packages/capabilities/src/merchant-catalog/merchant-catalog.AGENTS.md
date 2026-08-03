# Merchant Catalog configuration

`merchant-catalog.ts` owns merchant-scoped Services, Providers, their lifecycle, and
explicit Provider-Service eligibility.

## Public surface

- `MerchantCatalog.read()` returns every current and inactive catalog record for
  operations and historical inspection.
- `MerchantCatalog.readBookable()` returns only active Services that have an active,
  explicitly eligible Provider, plus active Providers.
- Service create/update commands validate display data and lifecycle. The sole active
  Owner-Provider profile supports display-name updates only.
- `setServiceEligibility` replaces one Service's normalized eligibility associations
  atomically. An Active Service must retain the sole Owner-Provider eligibility;
  deactivate it before replacing eligibility with an empty set. Reactivation restores
  that required association atomically.
- `MerchantContext` is resolved from persisted Owner membership at the request boundary;
  capability commands never accept a caller-supplied Merchant id.

## Invariants

1. Eligibility exists only in `provider_service_eligibility`; never infer it from
   membership, default designation, or embedded arrays.
2. Every read and mutation uses `MerchantContext.id`. Unknown and cross-Merchant ids use
   the same `item_not_found` failure.
3. Inactive records remain readable and are updated in place. There is no hard-delete
   command.
4. BeeSolo retains exactly one persisted active default Owner-Provider and exposes no
   additional-Provider creation command. Every new Service is atomically made eligible
   for that Owner-Provider.
5. Seed and Live layers implement the same shape. The canonical Booking fixture is a
   Solo graph; incomplete graphs are derived variants.

## Storage

Reads and writes `merchants`, `providers`, `services`, and
`provider_service_eligibility`. Real-D1 triggers enforce that an eligibility row's
Merchant matches both referenced records.

Customer-facing Booking configuration is resolved separately by
`booking-configuration.ts`. It validates the controlled premium palette, resolves
Shop over Brand over Merchant, records the winning scope, and localizes authored
names with an explicit source-language fallback. Provider and Service configuration
JSON is treated as untrusted persisted input at the Booking projection boundary.
