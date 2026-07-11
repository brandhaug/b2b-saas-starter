# packages/db

D1 schema for Better Auth and the Booking Product. Mutable product records are owned
by Merchant: catalog, schedule rules, booking sessions/holds, appointments,
confirmation access, notification outbox, Platform API tokens/webhooks, and audit
events. Do not add Workspace bridges, durable Customers, persisted Availability,
Brands, Shops, Sale Orders, generic payment ledgers, Checkout Policy, or prototype
state. `scripts/seed.ts` owns the deterministic local Booking scenario.
