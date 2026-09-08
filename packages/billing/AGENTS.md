# Billing

## Purpose & Scope

Stripe lifecycle, checkout recovery, seat billing, and resource entitlements (ADR 0060). `ports.ts` owns the request-context, audit, and notification interfaces supplied by `capabilities/src/billing-adapters.ts` and its workspace-context layers. The package has no dependency on capabilities. Provider setup and operator policy live in [the runbook](../../docs/billing-operator-runbook.md).

## Entry Points & Contracts

- All provider events, seat work, and scheduled reconciliation use the fenced synchronization workflow. Event fields only route; Live retrieves Stripe authority and Seed reads an independent provider fixture. Provider failures preserve the last verified projection and remain retryable.
- `billing-state.ts` owns lifecycle decisions. Both synchronization and request-time plan reads evaluate its deadlines. Background callers use `currentPlanForWorkspace`; workspace context is not current billing authority. Seed fixture plans must be supplied explicitly for workspace-keyed reads.
- Persist the subscribed plan separately from effective access. A downgrade to Starter must retain enough state for payment recovery. Billing writes never change administrative suspension state.
- First access requires verified payment or an unexpired operator trial. Trial invoices do not establish paying history. Renewal grace starts at the first actual failed payment, and retries retain that timestamp. Paid zero-due renewal invoices preserve established payment history.
- Live commits subscription, plan, audit, provider evidence, and notice outbox together. Notification delivery retries use stable identities. Failures, approaching expiry, and recovery target owners and admins.
- Checkout claims retain their original inputs and provider idempotency identity across retries. A provider subscription sends self-service checkout requests to the portal. Enterprise is operator-provisioned and never self-checkout.

## Patterns & Pitfalls

- Stripe periods belong to subscription items; trial end is nullable. Configured prices must be monthly, licensed, per-unit prices. Display provider amounts using Stripe's currency units.
- Seats count current members, including owners/admins. Invitations do not count. Membership queues quantity synchronization; additions and removals use next-invoice prorations.
- Cancellation retains the customer for invoice history. Restricting product access must preserve authorized billing recovery.

Resource selection invariants live in [resource-entitlements](src/resource-entitlements.AGENTS.md). Package tests cover provider and pure decision logic; capabilities retains D1 and application-composition tests. Seed billing reads a supplied members effect so it observes the same mutable roster as invitations and membership.
