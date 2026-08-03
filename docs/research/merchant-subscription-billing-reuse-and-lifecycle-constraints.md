# Merchant Subscription billing reuse and lifecycle constraints

Date: 2026-07-27  
Question: What can the existing optional billing module reuse, what is missing for a
Merchant Subscription to authoritatively grant Solo or Team Plan entitlements, and
which provider lifecycle facts constrain the design?

> **BeeSolo scope update — 2026-07-29:** this research retains Team findings as future design evidence, but the launch implementation maps prices and enforces entitlement for the Solo Plan only. Team prices, seat quantities, upgrades, downgrades, invitations, and member-capacity projections are deferred.

## Direct answer

Stripe is the repository's intended platform-subscription provider, but the billing
Optional Provider Module is a scaffold, not a subscription implementation. It can
reuse the environment/configuration gate, disabled/needs-configuration UX, hosted
checkout and idempotent-request boundary patterns, and the repository's general
durability/audit conventions. It cannot reuse an existing subscription aggregate,
checkout/portal route, price mapping, lifecycle projector, webhook inbox, replay job,
or entitlement authority because none exists.

The live Stripe code under the Booking App is a different domain: it settles customer
appointment **Payments** using one-time Checkout (`mode=payment`). A Merchant
Subscription is platform billing that grants a Merchant a Solo Plan or Team Plan.
The appointment adapter's HTTP boundary, dependency injection, tests, idempotency-key
use, and raw-body verification boundary are useful patterns; its event normalization,
metadata, prices, and payment lifecycle are not Merchant Subscription behavior.

The recommended authority is a D1-backed Merchant Subscription aggregate and derived
Entitlement projection. Verified Stripe facts feed that aggregate, while local product
policy decides whether those facts grant Solo or Team. `merchants.plan` must stop being
an independently writable authority: it should either be replaced by an effective-plan
read from the projection or retained only as a transactionally updated cache. Checkout
redirects and Stripe subscription status alone must never grant access.

## Repository findings

### What exists

- The canonical domain separates a Merchant Subscription from customer booking
  Payments and says it grants Solo or Team ([`CONTEXT.md`](../../CONTEXT.md#merchant-subscription)).
- Stripe is named as the provider behind the billing Optional Provider Module, but the
  integration documentation explicitly says checkout, customer portal, inbound
  webhook, signature verification, plan-state updates, and billing audit writes are
  not implemented
  ([Stripe billing integration](../../apps/web/content/docs/integrations/stripe-billing.mdx#L9-L21)).
- The environment schema recognizes and forwards `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET`, but billing deliberately has `runtimeWired: false`; even
  present secrets therefore do not make it configured
  ([environment module status](../../packages/env/src/server.ts#L11-L13),
  [billing gate](../../packages/env/src/server.ts#L108-L117)).
- Public pricing is static Starter/Team/Enterprise presentation with disabled actions,
  not the Merchant product's Solo/Team catalog
  ([public pricing](../../apps/web/src/routes/pricing.tsx#L7-L28)).
- The Merchant Subscription settings panel does offer Solo/Team comparison and a good
  `Needs configuration` state, but plan selection is client-only and its action is
  disabled ([panel](../../apps/merchant/src/components/merchant-subscription-panel.tsx#L7-L45),
  [disabled action](../../apps/merchant/src/components/merchant-subscription-panel.tsx#L157-L176)).
- Merchant onboarding writes `plan: 'solo'` directly
  ([live onboarding](../../packages/capabilities/src/merchant-catalog/merchant-onboarding.ts#L440-L486)).
  The only persisted plan fact is `merchants.plan`; there are no billing-customer,
  subscription, invoice, provider-event, or entitlement tables
  ([merchant schema](../../packages/db/src/schema.ts#L418-L431)).
- Every protected Merchant request loads that column into `MerchantContext`
  ([Merchant context](../../packages/capabilities/src/merchant-catalog/merchant-context.ts#L31-L65)).
  Merchant Catalog then authorizes Team-only provider creation and mutation by testing
  `merchant.plan` directly
  ([Team guard](../../packages/capabilities/src/merchant-catalog/merchant-catalog.ts#L574-L617)).
  Thus the column is currently authoritative without a Merchant Subscription.
- A live Stripe adapter exists for customer booking Payments. It creates one-time
  hosted Checkout Sessions with an idempotency key and normalizes payment/charge
  events ([settlement adapter](../../apps/booking/src/lib/stripe-payment-provider.ts#L140-L195),
  [payment event normalization](../../apps/booking/src/lib/stripe-payment-provider.ts#L43-L114)).
  This is not the scaffolded platform billing module.

### Reusable versus missing

| Capability                                                                     | Reuse assessment                                      | Constraint or missing work                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optional-provider env gate and secret forwarding                               | Reuse                                                 | Set `runtimeWired` true only after the full runtime and recovery path exist; env presence is not health.                                                                                                                                                                                                                                                                                           |
| Disabled/needs-config UI                                                       | Reuse                                                 | Bind it to actual module health and Merchant Subscription state, not a constant.                                                                                                                                                                                                                                                                                                                   |
| Merchant Solo/Team comparison copy                                             | Reuse after centralizing                              | Prices/product IDs and entitlement features need one server-owned catalog, not component constants.                                                                                                                                                                                                                                                                                                |
| Hosted Checkout HTTP boundary                                                  | Reuse the shape                                       | Subscription Checkout requires `mode=subscription`, server-allowlisted recurring Price IDs, Merchant correlation, Customer reuse, and duplicate-subscription prevention. Appointment amount/metadata/event code must not cross domains.                                                                                                                                                            |
| Outbound API idempotency-key pattern                                           | Reuse                                                 | Add a durable local command/attempt key and uniqueness rule; Stripe can prune keys after at least 24 hours.                                                                                                                                                                                                                                                                                        |
| Raw-body webhook boundary and five-minute tolerance                            | Reuse the boundary and tests only                     | Do **not** copy the verifier unchanged. It collapses repeated signature fields through `Object.fromEntries` and compares digests with plain equality ([current verifier](../../apps/booking/src/lib/stripe-payment-provider.ts#L14-L41)). Stripe secret rotation can produce multiple active signatures. Use a Workers-compatible official verifier or a constant-time, multi-`v1` implementation. |
| Appointment Stripe event normalization                                         | Do not reuse                                          | Its aggregate, event set, facts, metadata, and lifecycle are customer Payment concepts, not Merchant Subscription concepts.                                                                                                                                                                                                                                                                        |
| Generic D1 transaction, audit, outbox, queue, and stale-work recovery patterns | Reuse repository conventions                          | Billing-specific inbox records, projector, audit vocabulary, scheduled reconciliation, and operations UI are missing.                                                                                                                                                                                                                                                                              |
| Merchant `plan` checks                                                         | Keep capability-level enforcement, replace the source | Guards should consume an effective entitlement projection. Direct reads/writes of `merchants.plan` bypass subscription authority.                                                                                                                                                                                                                                                                  |
| Billing customer portal                                                        | Missing                                               | Needs an authorized server route, Customer mapping, return URL allowlist, portal configuration, audit, and webhook reconciliation for portal-made changes.                                                                                                                                                                                                                                         |

## Recommended authority and invariants

The provider is authoritative for provider facts: Customer, Subscription, Price,
Invoice, payment result, period boundaries, and cancellation state. The application is
authoritative for the product meaning of those facts: which allowlisted Price means
Solo or Team, grace policy, effective entitlement, capability enforcement, and audit.
Persist the provider facts; do not call Stripe synchronously on every authorization
check.

Recommended records (names illustrative):

- `merchant_subscriptions`: Merchant ID, provider, provider Customer ID, provider
  Subscription ID, requested/effective plan, provider status, lifecycle, period/trial/
  cancel boundaries, last paid-through boundary, grace deadline, last reconciled time,
  and provider revision/fingerprint.
- `merchant_entitlements`: Merchant ID, effective plan, grant state, valid-until,
  reason, subscription ID, and projection revision. It may be folded into the
  subscription record if updated atomically and still exposed through a narrow service.
- `billing_checkout_attempts`: durable command/idempotency key, Merchant, target plan,
  Checkout Session, status, and expiry.
- `billing_provider_events`: unique provider Event ID, event type/object ID, provider
  creation time/API version, receipt/processing status, attempt/error metadata, and a
  payload hash or retained payload according to the data-retention policy.

Enforce these invariants:

1. A Merchant has exactly one Stripe Customer mapping and at most one nonterminal
   platform Merchant Subscription. Database uniqueness, not a 24-hour provider
   idempotency window, enforces this.
2. Only server-side allowlisted Stripe Price IDs map to `solo` or `team`. Client input,
   Price nickname, amount, Checkout metadata, and success URLs never define a plan.
3. Only the Merchant Owner (or separately authorized Operations workflow) can start
   checkout, open the portal, or request a change. The request derives Merchant ID from
   persisted membership, never request data.
4. A verified provider event, successful provider API response, or reconciliation job
   can update provider facts. Only the subscription domain projector can update the
   entitlement. The update, event processing marker, audit event, and any notification
   intent commit atomically.
5. Checkout completion is correlation, not entitlement. A trial grant requires a
   verified `trialing` subscription. A paid grant/extension requires a qualifying paid
   invoice and compatible current subscription/Price facts.
6. `merchants.plan`, if retained, is a read-optimized cache updated in the same
   transaction and is not directly mutable. Prefer making capabilities ask a dedicated
   effective-entitlement service so status/reason/expiry cannot be lost.
7. Pending cancellation does not revoke early: it records `cancelsAt` and preserves the
   already-earned entitlement until the local valid-through boundary. Actual terminal
   cancellation revokes at the policy-defined effective time.
8. Upgrade/downgrade effectiveness is explicit. Use Stripe pending updates when a
   change must apply only after its invoice is paid; never grant a paid upgrade merely
   because a change request was sent. Stripe recommends pending updates for changes
   that generate an invoice ([subscription changes](https://docs.stripe.com/billing/subscriptions/change)).
9. “No Stripe configuration” remains a healthy local/module-disabled state. It cannot
   silently grant Team. If Solo is free or development needs a grant, represent an
   explicit local/complimentary subscription source through the same entitlement
   interface and audit it.
10. Customer appointment Payments and platform Merchant Subscriptions use separate
    routes, event allowlists, domain services, and ideally distinct webhook endpoints/
    secrets. Stripe signing secrets are endpoint-specific
    ([Stripe webhooks](https://docs.stripe.com/webhooks)).

## Lifecycle and entitlement mapping

Stripe's subscription statuses include `trialing`, `active`, `incomplete`,
`incomplete_expired`, `past_due`, `canceled`, `unpaid`, and `paused`. Initial payment
failure can leave a subscription `incomplete` and then terminal
`incomplete_expired` after about 23 hours; renewal failure normally produces
`past_due`; Dashboard recovery settings decide whether it later becomes `canceled`,
`unpaid`, or stays `past_due`. A trial ending without a payment method can cancel,
pause, or create an invoice depending on configured end behavior
([subscription overview](https://docs.stripe.com/billing/subscriptions/overview),
[trials](https://docs.stripe.com/billing/subscriptions/trials)).

Recommended first policy (the grace duration remains a product decision):

| Provider/evidence state                                                | Local lifecycle        | Entitlement decision                                                                                                                                                |
| ---------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout Session open/expired or subscription absent                   | `pending` / `none`     | No grant. Expiry may offer a new checkout, not mutate plan.                                                                                                         |
| `incomplete`                                                           | `activation_pending`   | No grant until initial invoice succeeds or a valid trial is verified.                                                                                               |
| `incomplete_expired`                                                   | `activation_failed`    | No grant; terminal provider object, start a new subscription to recover.                                                                                            |
| `trialing` with allowlisted Price and future `trial_end`               | `trial`                | Grant mapped plan until trial end; notify before end.                                                                                                               |
| `active` plus successful initial/renewal invoice                       | `active`               | Grant mapped plan through the paid-through boundary. `invoice.paid` extends it.                                                                                     |
| `active` with payment still processing or invoice finalization failure | `verification_pending` | Do not extend paid-through from status alone. Preserve only already-earned time/grace while reconciling.                                                            |
| `past_due`                                                             | `delinquent`           | Keep access only through an explicit local grace deadline, notify and direct to portal. Revoke/suspend after grace even if Stripe is configured to stay `past_due`. |
| `unpaid`                                                               | `suspended`            | Revoke. Stripe explicitly recommends revoking product access in this state.                                                                                         |
| `paused`                                                               | `suspended`            | Revoke until explicit resume succeeds; this status is distinct from merely pausing payment collection.                                                              |
| Active/trialing with `cancel_at_period_end`                            | `cancel_scheduled`     | Preserve grant through valid-through/trial boundary; show cancellation date.                                                                                        |
| `canceled` / `customer.subscription.deleted`                           | `ended`                | Revoke at effective end; a canceled subscription is terminal, so recovery creates a new one.                                                                        |

Subscription status alone is insufficient payment evidence. Stripe documents that
asynchronous payment can leave an active subscription while a PaymentIntent is still
processing and that later failure can void the invoice while the subscription remains
active. Stripe also says to provision on `invoice.paid` when the subscription is active
([subscription overview](https://docs.stripe.com/billing/subscriptions/overview),
[subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)).

### Checkout and trials

- Create a fresh Checkout Session for each attempt with an allowlisted recurring Price
  and `mode=subscription`; persist the Merchant-to-attempt correlation before redirect.
  Stripe's Session API supplies `client_reference_id` specifically for reconciliation
  ([Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create)).
- Persist Stripe Customer and Subscription IDs. The browser success page may show a
  pending state but must not grant access. Consume `checkout.session.completed` for
  correlation and subscription/invoice events for authority
  ([build subscriptions](https://docs.stripe.com/billing/subscriptions/build-subscriptions)).
- `customer.subscription.trial_will_end` normally arrives three days before trial end
  (or immediately for a shorter trial). Missing-payment-method end behavior must be
  deliberately configured and reflected in the projector
  ([trials](https://docs.stripe.com/billing/subscriptions/trials)).

### Renewal, delinquency, cancellation, and recovery

- Renewal creates and finalizes an invoice, then attempts payment. Treat
  `invoice.paid` as the extension signal and `invoice.payment_failed` as a recovery
  signal. `invoice.finalization_failed` also needs an operational path; Stripe warns a
  subscription can remain active even though payment cannot be collected
  ([subscription invoices](https://docs.stripe.com/billing/invoices/subscription),
  [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)).
- Smart Retries/custom retry schedules are Stripe Dashboard policy, and the final
  action is configurable. Local access therefore needs its own fixed grace rule rather
  than inheriting a mutable provider setting
  ([Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)).
- Setting `cancel_at_period_end` produces `customer.subscription.updated`; actual
  cancellation produces `customer.subscription.deleted`. A scheduled cancellation can
  be reversed before period end, while a canceled subscription cannot be reactivated
  ([cancellation](https://docs.stripe.com/billing/subscriptions/cancel)).
- The Stripe-hosted customer portal can update billing information/payment methods,
  change or cancel subscriptions, and expose invoices. Portal changes must flow back
  through exactly the same webhook/reconciliation projector
  ([customer portal](https://docs.stripe.com/customer-management)).

## Webhook, idempotency, replay, and recovery constraints

### Secure durable ingestion

1. Accept only the billing endpoint's allowlisted event types and retain the exact raw
   request bytes until verification.
2. Verify `Stripe-Signature` with the endpoint secret before parsing. Stripe requires
   the raw body, recommends official libraries, and uses a default five-minute replay
   tolerance. The CLI-forwarding secret is different from a Dashboard endpoint secret
   ([signature verification](https://docs.stripe.com/webhooks/signature)).
3. Insert a provider-event inbox row with a unique Event ID before returning success.
   Queue/project asynchronously, but only return `2xx` once durable ownership of the
   work exists. Stripe recommends quickly returning `2xx` and asynchronous handling
   ([webhook practices](https://docs.stripe.com/webhooks)).
4. Make projection transactional and repeatable. Stripe can deliver the same Event
   more than once, and it can generate distinct Events for the same underlying object;
   dedupe by Event ID, plus use `(event.type, data.object.id)`/current resource state to
   prevent semantic duplication
   ([duplicate events](https://docs.stripe.com/webhooks)).
5. Pin and record the webhook Event API version. Old Event payloads keep the version
   from creation and are not reshaped by later retrieval or account upgrades
   ([Event API](https://docs.stripe.com/api/events/object)).

### Ordering and replay

Stripe does not guarantee event delivery order. A later invoice event may arrive before
subscription creation/update. Handlers must treat Events as prompts to converge, fetch
the referenced current Subscription/Invoice/Customer when facts are absent or
ambiguous, and apply a monotonic projection rather than assuming an event sequence
([event ordering](https://docs.stripe.com/webhooks)).

In live mode Stripe retries failed webhook delivery with exponential backoff for up to
three days; sandbox delivery retries three times over a few hours. Dashboard manual
resend is available for 15 days and CLI resend for 30 days. A manual resend does not
cancel automatic retries, making idempotency mandatory
([delivery behavior](https://docs.stripe.com/webhooks)).

Recovery must not depend only on replay. Stripe's List Events API exposes full events
for only the last 30 days, though it can filter unsuccessfully delivered events. Add:

- an operator-safe replay of the durable local inbox;
- a scheduled reconciliation scan for stale, pending, delinquent, or inconsistent
  subscriptions that retrieves current Stripe Subscription and latest Invoice facts;
- a bounded provider-event backfill (`delivery_success=false`) for outages within the
  30-day window; and
- alerts/dead letters plus a per-Merchant “reconcile now” operation that is itself
  idempotent and audited.

See Stripe's [undelivered-event recovery](https://docs.stripe.com/webhooks/process-undelivered-events)
and [List Events API](https://docs.stripe.com/api/events/list).

### Outbound idempotency

Use a stable, operation-scoped idempotency key for every consequential provider POST:
Customer/Checkout creation, subscription change, cancellation, and portal session
creation. Stripe returns the first recorded result—including a `500`—for a repeated key
with matching parameters, rejects parameter drift, and may prune keys after at least
24 hours. Consequently, local command rows and database uniqueness are the long-term
authority; Stripe idempotency is transport retry protection
([idempotent requests](https://docs.stripe.com/api/idempotent_requests)).

## Local development and lifecycle testing

- With no Stripe secrets, the app must boot, Merchant Subscription UI must report
  disabled/needs-configuration, and non-billing Solo development behavior must follow
  an explicit local/complimentary entitlement policy. Never infer “configured” merely
  from secret presence.
- In Stripe sandbox development, use `stripe listen --forward-to <local billing route>`
  and set the printed CLI `whsec_…` for that listener. The CLI can filter/trigger events
  and forward them locally ([Stripe CLI](https://docs.stripe.com/stripe-cli/use-cli)).
- Use pure capability tests for every mapping/invariant, duplicate/out-of-order Events,
  projector retries, and grace-boundary behavior. Keep provider JSON fixtures versioned.
- Add sandbox contract tests for hosted Checkout and portal creation, signature
  verification, and API reconciliation.
- Use Stripe Test Clocks to advance trials, renewals, failures, and cancellation
  deterministically and observe resulting webhooks/state. Some asynchronous payment
  methods can settle later than the clock advance, so tests must await lifecycle events
  rather than equate “clock ready” with payment success
  ([Test Clocks](https://docs.stripe.com/billing/testing/test-clocks/simulate-subscriptions),
  [advanced Test Clock use](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)).

## Risks and open decisions

1. **Solo commercial policy:** Is Solo paid, permanently free, trial-only, or
   complimentary in local/self-hosted deployments? The answer determines the initial
   Merchant Subscription source. Direct onboarding to an authoritative Solo column is
   incompatible with “Merchant Subscription grants the Plan” unless it represents an
   explicit complimentary grant.
2. **Past-due grace:** Choose the duration, customer notices, capability behavior after
   expiry, and restoration behavior. Do not delegate this product policy to mutable
   Stripe retry settings.
3. **Deferred Team downgrade safety:** A Team-to-Solo change conflicts with multiple active Providers
   and Merchant Members. Billing must not force a data-destructive downgrade. Define
   eligibility/preconditions and whether cancellation suspends premium actions while
   preserving data.
4. **Price/catalog ownership:** Define currency/interval offerings and immutable Price
   ID-to-plan mapping per environment. Never derive entitlement from amount or display
   text.
5. **Same Stripe account/secrets:** Appointment Payments and platform subscriptions
   currently share generic env names. Decide whether they use one Stripe account; even
   if they do, separate endpoint secrets, event allowlists, and domain routes prevent
   cross-domain callbacks and ease rotation.
6. **Signature implementation:** The current manual appointment verifier is not a safe
   copy target for secret rotation/multiple `v1` signatures or constant-time comparison.
   Select a Workers-compatible hardened implementation and add rotation fixtures.
7. **Tax, proration, refunds, disputes, and invoices:** These affect commercial policy
   but do not directly define entitlement. Lock proration/refund and tax ownership
   before enabling self-service plan changes.
8. **Operations:** Define reconciliation cadence, stale thresholds, alert destinations,
   event/payload retention, PII redaction, manual grant authority, and audit vocabulary.
9. **Stripe Entitlements:** Stripe can emit
   `entitlements.active_entitlement_summary.updated`, but adopting it is optional. It
   does not remove the need for the local Merchant Subscription aggregate, Solo/Team
   structural invariants, provider-independent local mode, or recovery projection
   ([subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks)).

## Resolution-ready conclusion

Reuse the optional-module configuration/disabled UX and generic Stripe boundary
patterns, not a nonexistent subscription engine and not the appointment Payment
lifecycle. Introduce a D1 Merchant Subscription plus effective Entitlement projection;
make the projection the sole source for Solo enforcement at BeeSolo launch; map only server-allowed
Prices; grant trial access from verified `trialing` facts and paid access/renewal from
qualifying `invoice.paid` evidence; preserve pending-cancellation access through its
earned boundary; apply an explicit past-due grace; and revoke/suspend for terminal or
non-billing states. Ingest signed Events durably and idempotently, tolerate duplicates
and arbitrary ordering, and converge with scheduled Stripe API reconciliation because
webhook retries/replay are bounded and Events alone are not an authoritative recovery
mechanism.

Team entitlement mapping remains an intentionally unused future extension of this boundary, not a BeeSolo launch acceptance criterion.
