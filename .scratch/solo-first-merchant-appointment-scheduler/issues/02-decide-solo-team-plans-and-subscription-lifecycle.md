# Decide Solo and Team Plans and the Merchant Subscription Lifecycle

Type: grilling
Status: resolved
Blocked by: 01

## Question

What exact capabilities, limits, pricing dimensions, trial behavior, billing intervals, upgrade timing, downgrade preconditions, grace periods, cancellation behavior, and entitlement states define the Solo Plan, Team Plan, and Merchant Subscription without coupling merchant billing to customer appointment Payments?

## Comments

### Resolution — 2026-07-27

Solo and Team are paid, single-Shop plans with the same scheduler capabilities and unlimited core usage: appointments, customers, services, booking-page activity, email notifications, reports, exports, queues, and waiting lists carry no plan-specific quota or per-booking fee. Solo permits exactly one active Merchant Member—the Owner—who is also the sole active Provider. Team permits 2–20 active Merchant Members including the Owner, uses the fixed Owner, Manager, and Employee roles, and allows optional Provider linkage without billing Provider status separately.

All catalog prices are in EUR and exclude applicable VAT. Solo costs €19 monthly or €190 annually. Team costs €15 per active Merchant Member monthly or €150 per active Merchant Member annually, with a quantity floor of two and ceiling of twenty. Annual terms are prepaid at the equivalent of ten monthly payments. Price versions are immutable during a paid period; an announced catalog change requires at least 30 days' notice and applies at renewal, with no permanent grandfathering. Resubscription uses the then-current catalog price. Checkout collects the Merchant's billing identity and optional VAT ID; tax changes neither entitlements nor purchased SMS units.

A new Merchant receives one 14-day, no-card trial. It may evaluate either plan and switch between them without resetting or extending the deadline. Trial expiry without confirmed first payment enters Restricted Access immediately; the seven-day Grace Period applies only to a failed paid renewal. Production entitlement requires trial or Stripe payment evidence. Non-production may issue an explicit development grant through the same entitlement interface; launch has no complimentary production subscription or hidden Team-capable bypass.

The authoritative D1 entitlement projection has exactly four Subscription Access States: Trialing, Active, Grace, and Restricted. Stripe statuses remain provider facts and never authorize product behavior directly. Pending paid upgrades, scheduled quantity decreases, scheduled plan or interval changes, and scheduled cancellation are separate lifecycle facts rather than access states.

Paid capacity increases take effect only after confirmed prorated payment. During trial they take effect immediately. An accepted Team invitation creates a Pending Member while any required prorated seat charge is attempted; Merchant access begins only after payment. Paid capacity belongs to the Merchant rather than an individual, so a replacement may occupy a vacant already-paid slot without another charge. Removing a member revokes access immediately but produces no credit; the lower billing quantity applies at renewal and is cancelled if the slot is refilled before then.

Team-to-Solo downgrade is scheduled for period end with no credit and requires exactly one active Merchant Member (the Owner), the Owner as sole active Provider, no pending invitations, all future appointments assigned to other Providers reassigned or cancelled, no active queue or waiting-list dependency on another Provider, and all other memberships and Providers retained only as inactive history. Billing-interval changes also apply at period end without mid-period credit or reset.

A failed paid renewal starts seven days of full-plan Grace. Recovery returns the Merchant to Active immediately. If payment is still absent at the deadline, the failed renewal invoice is voided and access becomes Restricted; the Merchant does not owe the unused renewal term. Cancelling during Grace immediately voids that invoice and enters Restricted Access. Voluntary cancellation outside Grace is reversible until period end, preserves full access through that date, issues no self-service prorated refund, and then enters Restricted Access without deleting the Merchant.

Restricted Access stops new customer bookings, merchant-created appointments, configuration changes, invitations, member activation, and new appointment-series, queue, or waiting-list entries. It preserves the Merchant's Public Page Status preference but presents the page as temporarily unavailable. Role-limited read access, billing recovery, data export, essential notifications, and completion, cancellation, no-show, or rescheduling of appointments created before restriction remain available. Successful payment restores the effective plan automatically. Operational Merchant data remains recoverable for 12 months, with deletion warnings 30 and 7 days before deletion or irreversible anonymization; legally required billing, tax, security, and audit records follow their own retention periods.

Subscription chargebacks immediately enter Restricted Access without Grace. A full support refund must explicitly state whether it ends access or is a courtesy refund that preserves access; partial refunds do not alter entitlement unless an authorized billing operation explicitly shortens it. There is no self-service immediate cancellation refund.

Outbound transactional SMS is a separate prepaid usage dimension routed through the product's outbound SMS router. Each provider-accepted Outbound SMS Segment costs €0.03; rejected attempts, email, and in-app notifications are not billed, while a long message may consume multiple segments. An SMS Balance must cover the complete message before submission, eliminating postpaid exposure. The Owner may buy €10, €25, or €50 credit and may enable an automatic top-up in those amounts when balance falls below €2. Auto top-up permits only one charge in flight and requires an Owner-selected monthly cap from €10 to €250, defaulting to €25. SMS pauses when funds are insufficient or the cap is reached; email continues. Credit never expires while the Merchant is retained, remains usable for permitted existing-appointment notifications during Restricted Access, is non-transferable and not cash-redeemable, and is not automatically refunded on cancellation except where legally required or initiated by the platform. A chargeback freezes SMS sending and balance without restricting the core plan.

The no-card trial includes email but not free SMS. The Owner must fund the SMS Balance and explicitly enable metered SMS; doing so does not end the plan trial. Only the Owner may start checkout, change plan or interval, manage payment methods, purchase SMS credit, configure automatic top-up, schedule or undo subscription changes, or cancel. Managers may view plan, billed quantity, renewal, SMS Balance, and usage; Employees see no billing surface.

Billing lifecycle notifications go to the Owner by email and persistent in-app notice, never SMS: trial reminders at 7, 3, and 1 day before expiry and at expiry; renewal failure immediately and on Grace days 3 and 6 and at restriction; paid-upgrade success or failure; scheduled-change notice immediately, three days before effect, and when applied; and immediate recovery confirmation. Merchant Subscription and SMS-credit payments remain categorically separate from customer appointment Payments, which stay Pay In Person for this destination.

### Scope amendment — 2026-07-29

BeeSolo launches with the Solo Plan only. The Solo price, interval, trial, access-state, renewal, grace, restriction, cancellation, recovery, retention, and prepaid-SMS decisions remain launch requirements. Team pricing, seat capacity, invitations, upgrades, downgrades, quantity changes, and Manager billing visibility are retained as future design and must not produce launch implementation work.

### Messaging economics supersession — 2026-07-30

The €0.03-per-provider-accepted-Outbound-SMS-Segment charge, SMS Balance, and automatic-top-up rules above are superseded by [Resolve the €0.03 SMS Segment Unit Economics](./21-resolve-sms-segment-unit-economics.md). BeeSolo uses the Operational Messaging Router's provider-neutral Messaging Balance and charges €0.045 excluding VAT for one verified Chargeable Delivery through either WhatsApp or SMS. SMS segments remain Provider Messaging Cost evidence rather than a Merchant charging unit, and automatic top-up is outside launch scope.
