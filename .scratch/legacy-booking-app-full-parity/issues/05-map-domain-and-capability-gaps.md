# Map Domain and Capability Gaps for Full Parity

Type: research
Status: resolved
Blocked by: 01

## Question

Which legacy journeys require domain concepts, persistence, scheduling rules, booking-session behavior, payments, gift cards, waiting lists, walk-ins, identity, notifications, or background operations not yet represented by the canonical glossary and current Effect capabilities, and where should each responsibility live?

## Answer

The source-cited gap matrix is recorded in [Domain and Capability Gap Map for Legacy Booking Parity](../research/domain-and-capability-gap-map.md).

The current architecture already provides the correct seams for the single-appointment, Pay In Person path: Merchant Catalog owns bookable configuration, Scheduling derives availability and holds, Booking owns session/selection/checkout/confirmation, D1 persists durable facts, and Notifications plus the Background Worker react to committed outbox work. Full parity should deepen those seams rather than revive the legacy Cart, Sale Order, repository, or route-handler model.

Parity adds distinct responsibilities: Merchant Catalog expands to Brand/Shop topology and provider access policy; Booking gains composite parties/requests, policy acceptances, cancellation, rescheduling, and purpose-limited customer continuation; Scheduling gains coordinated, replacement, and offer-candidate rules; new Commerce/Pricing, Payments, Gift Cards, Waiting List, Walk-ins, and optional Customer Identity boundaries own their respective invariants; Notifications and durable background operations generalize beyond `appointment.created`; localization and telemetry remain provider-neutral presentation/integration concerns. Availability and customer-directory views remain derived, while monetary ledgers, lifecycle aggregates, access metadata, immutable accepted snapshots, and outbox/scheduled work persist in D1.

The investigation also exposed unresolved canonical language and aggregate invariants that downstream compatibility and boundary decisions depend on. [Define the Full-Parity Domain Model and Aggregate Invariants](./14-define-full-parity-domain-model-and-aggregate-invariants.md) now owns that live decision; no canonical glossary terms were prematurely added from research-only recommendations.
