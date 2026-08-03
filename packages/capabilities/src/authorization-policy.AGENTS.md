# Merchant Capability Authorization Inventory

`authorization-policy.ts` is the composition boundary for the generated Merchant
authorization and isolation matrix. Bounded contexts own their exceptions and
classifiers; this registry only assembles their declared operations and delegates
Restricted Access classification.

Keep the inventory aligned with the Merchant-scoped services in `layers.ts`. New
capabilities must declare every supported read, mutation, search, bulk operation,
export, callback, and queued action before runtime composition is considered complete.
