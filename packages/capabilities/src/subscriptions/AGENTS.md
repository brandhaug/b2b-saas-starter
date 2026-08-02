# Merchant Subscriptions

Own the Solo-only Merchant Subscription lifecycle. D1 access state is authoritative;
Stripe objects and events are evidence to reconcile, never direct authorization.

Keep Merchant Subscription billing separate from customer Appointment Payments. Do
not introduce Team, seat, quantity, upgrade, or downgrade concepts. Provider-facing
operations must be idempotent and price evidence immutable.
