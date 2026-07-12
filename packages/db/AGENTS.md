# packages/db

D1 schema for Better Auth and the Booking Product. Mutable product records are owned
by Merchant. The accepted full-parity model adds Merchant-owned Brand/Shop topology,
Booking Parties and Requests, quote/settlement facts, payment and gift-card facts,
waiting lists, walk-ins, policy facts, lifecycle history, protected access,
Notification Intents, and scheduled work beside the first-slice tables. Do not add
Workspace bridges, Sale Orders, generic Cart/Order/
Transaction aggregates, persisted Availability projections, or prototype state.
`scripts/seed.ts` owns the deterministic local Booking scenario.

Customer Identity persists platform-wide verified identities and account sessions
separately from Merchant authority. Merchant-scoped booking associations preserve
historical Customer Details snapshots. Booking-owned Provider proofs persist only
hashed, short-lived Booking Session/Provider-bound access material.
