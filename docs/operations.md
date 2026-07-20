# Booking Product Operations

## Production cutover order

The Operations App is a sixth Worker on a staff-only origin with its own Better
Auth secret, trusted origins, host-only cookie namespace, and rate limits. Do not
send traffic to that origin until the following sequence is complete:

Its browser application is TanStack Start. Local development runs the Vite
pipeline with `bun run dev:operations`; production artifacts are generated with
`bun --cwd apps/operations build` and retain the same dedicated Worker name,
origin, D1/email/rate-limit bindings, and Operations Auth configuration.

1. Configure distinct `MERCHANT_AUTH_SECRET` and `OPERATIONS_AUTH_SECRET` values,
   the exact `OPERATIONS_APP_ORIGIN`, `OPERATIONS_AUTH_TRUSTED_ORIGINS`,
   `OPERATIONS_SECURITY_CONTACT`, every Operations rate limit, and a verified
   `CLOUDFLARE_EMAIL_FROM` sender.
2. Apply D1 migrations. Stage the first dedicated, verified `system_operator`
   identity through the controlled production data-change process; it must have
   no Merchant membership or Customer Account identity.
3. Run the production bootstrap command below against remote D1. Confirm its
   durable `operations.operator.bootstrap.accepted` audit event and explicit
   Better Auth roles.
4. Deploy and verify `/ready`, operator password sign-in, mandatory TOTP, the
   Operations release matrix, and target email delivery before enabling the
   Operations hostname in public DNS or routing.

Cloudflare Access is deferred. The application must remain correct and secure
through Operations Auth, current-state authorization, dedicated rate limits,
reduced impersonation authority, and durable evidence without it.

## Local deterministic operator

After local migrations and seed data are ready, set `ENVIRONMENT=development`,
`OPERATIONS_LOCAL_SEED=enabled`, and the Operations values from `.env.example`,
then run `bun run dev:operations`. The local-only fixture is:

- email: `operator@operations.local`
- password: `local-operations-password`
- authenticator setup key: `JJBFGV2ZGNCFARKIKBFTGUCYKA`
- roles: Merchant Impersonator, Impersonation Auditor, and Operator Manager

The fixture is rejected outside development and test. Sign in at
`http://localhost:3076/sign-in`; use an authenticator configured with the setup
key above, then exercise discovery, impersonation, audit, and operator management.

## System Operator bootstrap

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

## Invite and enroll an operator

An enabled operator with the Operator Manager role opens `/operators`, chooses
"Invite System Operator", supplies a new dedicated email, and assigns one or
more predefined roles. Production sends a single-use link through Cloudflare
Email; local development exposes the deterministic capture at
`/__local/operator-invitation-email`. The link expires after 24 hours and can be
revoked from its result page.

Acceptance creates a 30-minute enrollment-only session. The recipient sets a
password, verifies the email through the invitation, enrolls TOTP, stores and
confirms backup codes, and then signs in normally. The enrollment session has no
Merchant discovery, operator management, audit, or impersonation permission. If
it expires, normal sign-in resumes incomplete security enrollment.

## Emergency recovery

Identify the exact operator and target environment, confirm active incident
ownership, then run the matching `operator:recover` command shown above. In
production the exact email confirmation and `--remote` flag are mandatory. The
transaction revokes the Operator Session and every derived impersonation,
disables the old factor, queues any required terminal target notification, and
records global recovery evidence. The operator must enroll a new TOTP factor and
confirm new backup codes; password-only Operations access remains denied.

## Impersonation procedure

1. Sign in with password and TOTP, then search for the Merchant or Merchant
   Member. Confirm the Member is enabled, belongs to the displayed Merchant, and
   is eligible.
2. On Member detail, enter a non-empty internal Impersonation Reason, optionally
   add the external support reference, and complete a fresh TOTP challenge.
3. Submit the handoff. The browser sends its 60-second credential by top-level
   POST to the Merchant App; never copy it into a URL, log, ticket, or chat.
4. Confirm the persistent banner names the target Member and Merchant. Perform
   only the necessary reversible support action. Identity, MFA, ownership,
   long-lived credential, monetary, destructive, and bulk-wipe actions are
   always denied.
5. Use the banner's stop action as soon as the task is complete. The session also
   ends after one absolute hour or immediately when an authoritative security
   fact changes. Terminal flows return to Operations Member detail without
   restoring or overwriting a normal Merchant Session.

## Target notifications

Activation, manual stop, expiry, and revocation append a Notification Intent in
the same D1 transaction as the lifecycle transition. The Background Worker sends
and retries the intent idempotently. Messages name the Merchant, timestamp,
optional support reference, and security contact; they never disclose the real
operator or internal reason. For an incident, inspect the intent and delivery
attempt by stable impersonation ID, allow queue/cron retry, and do not replay the
handoff or lifecycle mutation to force email.

Production Operations readiness fails closed when its email adapter or security
contact is unavailable. Local development uses deterministic capture.

## Global audit review

An operator with the Impersonation Auditor role opens `/audit` and filters by
action, result, operator, target, Merchant, or time. Detail views expose internal
reasons and support references only to that permission. Use the stable event and
impersonation identifiers when correlating authentication, provisioning,
management, handoff, mutation, stop, expiry, or revocation evidence. Do not copy
credentials or session material into audit metadata or ordinary logs.

Impersonation evidence is classified for two-year retention and preserves
historical attribution after a live operator, Member, or Merchant is disabled or
deleted.

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
