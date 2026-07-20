# packages/capabilities

Effect application layer for the Booking Product. Business behavior belongs in the
Merchant Catalog, Scheduling, Booking, developer-platform, governance, Operations,
or notification bounded context and is consumed by thin app/worker boundaries.

Runtime applications must select Live D1 adapters. Seed adapters exist only for the
single typed deterministic Booking scenario and tests. Product capabilities are
Merchant-owned; never introduce Workspace context, generic Starter capabilities, or
production fixture fallback.

Live and Seed implementations must satisfy the same service shape. D1 failures map to
`CapabilityUnavailable`, and cross-context imports stay explicit.

## Bounded-context map

| Context             | Intent node                |
| ------------------- | -------------------------- |
| Booking             | `src/booking/`             |
| Merchant Catalog    | `src/merchant-catalog/`    |
| Scheduling          | `src/scheduling/`          |
| Pricing             | `src/pricing/`             |
| Payments            | `src/payments/`            |
| Gift Cards          | `src/gift-cards/`          |
| Waiting List        | `src/waiting-list/`        |
| Walk-ins            | `src/walk-ins/AGENTS.md`   |
| Customer Identity   | `src/customer-identity/`   |
| Customer Engagement | `src/customer-engagement/` |
| Notifications       | `src/notifications/`       |
| Scheduled Work      | `src/scheduled-work/`      |
| Developer Platform  | `src/developer-platform/`  |
| Governance          | `src/governance/`          |
| Operations          | `src/operations/AGENTS.md` |

## Where to put a new capability

Place behavior in the bounded context that owns its domain decisions, not the app,
transport, actor, or data table that happens to invoke it. Operations owns
platform-staff workflows. Governance owns reusable governance mechanisms such as the
append-only Audit Event Log; it must not become an umbrella for security-sensitive
workflows from other contexts. Keep cross-context imports explicit and add a leaf
`AGENTS.md` beside each new capability source.
