# packages/capabilities

Effect application layer for the Booking Product. Business behavior belongs in the
Merchant Catalog, Scheduling, Booking, developer-platform, governance, or notification
bounded context and is consumed by thin app/worker boundaries.

Runtime applications must select Live D1 adapters. Seed adapters exist only for the
single typed deterministic Booking scenario and tests. Product capabilities are
Merchant-owned; never introduce Workspace context, generic Starter capabilities, or
production fixture fallback.

Live and Seed implementations must satisfy the same service shape. D1 failures map to
`CapabilityUnavailable`, and cross-context imports stay explicit.
