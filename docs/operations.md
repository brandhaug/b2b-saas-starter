# Booking Product Operations

## System Operator bootstrap and emergency recovery

Both maintenance commands target one exact, already verified email and record the
named maintainer in the global audit log. They never accept passwords, TOTP
secrets, or backup codes.

For local D1, run:

```bash
bun run operator:bootstrap -- --environment local --email operator@example.test --confirm-email operator@example.test --actor maintainer@example.test --roles merchant-reader,operator-manager
bun run operator:recover -- --environment local --email operator@example.test --confirm-email operator@example.test --actor maintainer@example.test
```

Production additionally requires the explicit `--remote` switch. Repeat the exact
target email in `--confirm-email`; the capability rejects mismatches before any
identity or session state changes.

```bash
bun run operator:bootstrap -- --environment production --remote --email operator@example.com --confirm-email operator@example.com --actor maintainer@example.com --roles merchant-reader,operator-manager
bun run operator:recover -- --environment production --remote --email operator@example.com --confirm-email operator@example.com --actor maintainer@example.com
```

Bootstrap assigns roles only to an existing verified identity already classified
as a System Operator and carrying no Merchant membership. It never reclassifies a
Merchant Member or Customer Account. Re-running it with the same explicit roles is
a no-op; a different role set is rejected. Recovery atomically revokes the
Operator Session and derived impersonation sessions, removes the old second
factor, and leaves Operations sign-in unavailable until TOTP and backup-code
enrollment is completed again.

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
