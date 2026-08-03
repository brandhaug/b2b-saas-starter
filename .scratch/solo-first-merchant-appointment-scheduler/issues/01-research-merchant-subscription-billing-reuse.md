# Research Merchant Subscription Billing Reuse and Lifecycle Constraints

Type: research
Status: resolved
Blocked by:

## Question

What subscription-billing behavior can be reused from the repository's existing optional billing module, what is missing to make a Merchant Subscription authoritatively grant Solo or Team Plan entitlements, and what provider lifecycle facts must the product handle for checkout, trials, renewal, cancellation, delinquency, webhook replay, local development, and recovery?

## Comments

### Resolution — 2026-07-27

Research: [Merchant Subscription billing reuse and lifecycle constraints](../../../docs/research/merchant-subscription-billing-reuse-and-lifecycle-constraints.md)

Stripe is the intended merchant-subscription provider, but the repository's billing Optional Provider Module is currently a scaffold. Reuse its environment gate, provider-disabled UX, hosted-checkout and idempotent-request boundary patterns, and the repository's D1 audit/outbox/recovery conventions. Do not reuse customer appointment Payment semantics or copy the existing manual webhook verifier unchanged.

Make a D1 Merchant Subscription aggregate and effective Entitlement projection the sole authority for Solo/Team enforcement. Stripe owns provider billing facts; the application owns allowlisted Price-to-Plan mapping, grace and downgrade policy, and effective access. Checkout redirects never grant access: verified `trialing` facts may grant a bounded trial, qualifying `invoice.paid` evidence extends paid access, scheduled cancellation preserves already-earned access, and delinquent or terminal states follow an explicit local grace/suspension policy.

Ingest signed billing events into a durable, uniquely deduplicated inbox and project them transactionally with audit and notification writes. Handlers must tolerate duplicate and out-of-order delivery, support local replay, and converge through scheduled Stripe API reconciliation because automatic retry and provider event replay are bounded. With Stripe unconfigured, billing remains a healthy disabled module; any free, complimentary, or local Solo grant must be explicit through the same entitlement interface rather than an implicit Team-capable bypass.

### Scope amendment — 2026-07-29

BeeSolo launches with the Solo Plan only. Reuse the researched provider boundary and authoritative entitlement projection for Solo billing; do not implement Team price mapping, paid member capacity, per-seat quantity changes, or plan transitions in this destination.
