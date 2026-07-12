# Booking Product Operations

## Durable notification recovery

`booking_outbox` is authoritative. The booking-events Queue merely wakes the
Background Worker, and the five-minute scheduled sweep is the recovery path.

When queue publication fails, the customer still receives the committed
Confirmation and the Appointment remains visible. When email or a Webhook fails,
the worker records that channel failure and leaves/retries durable work according
to its claim state. A later queue message or cron sweep reclaims stale work;
idempotent claims and stable event IDs prevent duplicate Appointments and make
Webhook retries recognizable by consumers.

Operational checks:

1. Find the trace ID and outbox ID in PII-free wide events.
2. Confirm the Appointment and outbox row exist in D1 before retrying delivery.
3. Inspect Webhook delivery history through the Merchant App or scoped Platform API.
4. Allow the scheduled sweep to retry, or invoke the Background Worker scheduled
   handler in the target environment.
5. Verify the outbox completion and per-channel delivery outcome; never recreate
   the Appointment to repair a notification.

## Key rotation

Confirmation keys are a JSON keyring in `CONFIRMATION_SIGNING_KEYS`. Add a new key,
deploy it while the old current key remains present, switch
`CONFIRMATION_CURRENT_KEY_ID`, and retain retired keys until every token signed by
them has expired. Platform API tokens and Webhook secrets are one-time disclosures;
revoke/replace them instead of attempting to read plaintext from storage.

## Provider-light environments

Email and online Payment settlement are optional. Missing provider configuration
keeps Pay In Person available and exposes no online method. Stripe settlement is
enabled only when `STRIPE_SECRET_KEY` is present; configure
`STRIPE_WEBHOOK_SECRET` and the merchant-first callback URL
`/:merchantSlug/booking/payment-callback/stripe` for reconciliation. Restrict
`PAYMENT_PROVIDER_METHODS` to methods enabled in the Stripe account.

An unavailable external provider or Webhook does not make the application
unhealthy and cannot erase committed local facts. Local and CI verification uses
deterministic fakes for external delivery and settlement while exercising the real
D1 idempotency and reconciliation behavior.
