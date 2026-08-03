# Define the Full-Parity Domain Model and Aggregate Invariants

Type: grilling
Status: resolved
Blocked by: 05

## Question

What canonical terms, lifecycle states, aggregate boundaries, ownership relationships, and atomic invariants should govern composite/group bookings, pricing adjustments, checkout policies and acceptances, payments, gift-card sale and redemption, waiting-list applications and offers, walk-in queue entries, cancellation and rescheduling, optional customer identity, operational notifications, and reminders—without reviving the legacy Cart, Sale Order, or Reservation model?

## Answer

The canonical language and relationships are now recorded in [`CONTEXT.md`](../../../CONTEXT.md). The full-parity model has no generic Cart, Order, Transaction, Sale Order, or Reservation aggregate.

### Aggregate boundaries

- **Booking Session** is the capability-protected access, locale, expiry, and continuation envelope for exactly one **Booking Party**.
- **Booking Party** is the single-currency aggregate for one or more ordered **Booking Requests**, coordinated by one customer and payer. Confirmation atomically creates one **Appointment** per request or creates none.
- **Appointment** owns each confirmed lifecycle and immutable change history. Individual changes do not silently affect sibling Appointments; explicit whole-party commands remain atomic.
- **Pricing** owns versioned **Pricing Quotes**, server-validated **Promotions**, and deterministically allocated **Pricing Adjustments**. **Settlement Allocations** divide the accepted total across gift-card value and external Payment without changing the price.
- **Payment** owns one payer's real collection/refund activity, idempotent **Payment Attempts**, and immutable monetary transactions. Pay In Person creates no Payment and implies no unpaid state.
- **Gift Card Sale** owns purchase and exactly-once issuance; issued **Gift Card** owns its immutable value ledger and redemption reservations.
- **Waiting List Application** owns its sequential **Availability Offers**. Each **Walk-in Entry** is independently mutable; **Walk-in Queue** is an ordered Shop-scoped view/configuration boundary.
- Merchant Catalog owns configuration aggregates; Notifications owns delivery aggregates. Optional **Customer Account** identity remains separate from Booking snapshots and anonymous capabilities.

### Lifecycles

- Booking Party: **Active**, **Confirming**, **Confirmed**, **Expired**, **Abandoned**.
- Payment: **Pending**, **Authorized**, **Partially Captured**, **Captured**, **Partially Refunded**, **Refunded**, **Cancelled**, derived from successful monetary transactions. Provider failures belong to Payment Attempts, not a terminal Failed state.
- Gift Card Sale: **Pending Payment**, **Issuing**, **Issued**, **Cancelled**, **Refunded**. Gift Card: **Active**, **Suspended**, **Expired**, **Voided**; zero balance is derived, not a status.
- Waiting List Application: **Active**, **Fulfilled**, **Withdrawn**, **Expired**. Availability Offer: **Pending**, **Accepted**, **Declined**, **Expired**, **Superseded**.
- Walk-in Entry: **Waiting**, **Called**, **Serving**, **Served**, **Removed**, **Expired**.
- Appointment remains **Scheduled**, **Completed**, **Cancelled**, or **No Show**; rescheduling is a command/session, never a status.

### Atomic invariants

1. A coordinated Booking Party resolves every Provider and acquires its complete conflict-free Time Slot Hold set atomically or acquires none.
2. The latest accepted Pricing Quote is bound to exact selections, holds, policy versions, promotion reservations, tip, and gift-card reservations. Material changes require a new version and acceptance; expired dependencies make it unconfirmable rather than silently repricing it.
3. Limited Promotion uses and gift-card value are reserved during checkout, committed with confirmation, and released on expiry or abandonment. Gift-card settlement is tender, not a discount.
4. Confirmation has one idempotency key. External payment work completes idempotently before one local commit consumes holds, commits reservations, records Payment facts, creates every Appointment, consumes the Booking Party, and appends Notification Intents. A failure after provider success is retried/reconciled without charging again; no partial Appointments are exposed.
5. Policy Acceptance snapshots the exact Checkout Policy disclosure/version once for the party. Marketing Consent remains person-specific, and Operational Notifications never depend on it.
6. At most one Availability Offer is Pending per Waiting List Application. Acceptance consumes it and creates a purpose-bound Booking Session plus Time Slot Hold, not an Appointment; declined or expired offers can leave the application Active.
7. Rescheduling preserves the Scheduled Appointment while a replacement hold is acquired; commit swaps time/provider/quote and records history atomically. Failure or expiry leaves the original unchanged.
8. Cancellation eligibility and refund entitlement are separate. Cancellation may commit while an idempotent refund obligation remains retryable in Payments.
9. A captured Gift Card Sale issues exactly one Gift Card. Redemptions cannot exceed available balance or cross fixed currency/scope. Refunding a sale can void only unspent value absent an explicit adjustment rule.
10. Domain changes append semantically deduplicated Notification Intents with committed facts. Reminders are version-bound scheduled intents; superseding changes invalidate obsolete pending reminders, and provider failures never roll back domain state.

### Ownership and privacy

Merchant configuration resolves explicitly from Merchant to Brand to Shop and is snapshotted downstream. Providers and Services remain Merchant-owned with Brand/Shop associations. Optional Customer Accounts are platform-wide identities, but merchants see only facts from their own interactions; account changes never rewrite historical Customer Details or invalidate purpose-limited confirmation access. Provider passcode proofs are short-lived, Booking Session/Provider-bound access proofs—not customer identity or merchant authorization.
