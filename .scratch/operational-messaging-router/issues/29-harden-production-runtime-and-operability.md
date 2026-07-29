# Harden the Production Runtime and Operability

Type: task
Status: resolved
Blocked by: 23, 24, 25

## Question

Prepare a production-like Cloudflare environment for qualification without enabling customer traffic: deploy the API callback routes, shared queue binding, Background Worker cron and provider adapters with environment-separated secret/configuration placeholders; wire schema-safe migrations, rollback-compatible envelope handling, health probes, dashboards, SLO and integrity alerts, provider-cost and complaint thresholds, reconciliation and retention schedules, dead-letter/ambiguity views, and scoped kill-switch probes. Add least-authority binding checks, PII and secret leak scans, load and failure-injection harnesses, recovery procedures, credential and encryption-key rotation paths, incident runbooks and named ownership, while proving old application versions remain safe during the expand/contract window and Booking plus email stay operational when messaging is disabled or degraded.

## Comments

### Resolution — 2026-07-30

Implemented an isolated production-like Cloudflare qualification stack with its own migrated D1 database, callback API, Background Worker, shared Queue, dead-letter Queue, five-minute recovery/reconciliation/retention cron, production provider adapters, fail-closed environment validation, and least-authority secret bindings. It deploys no customer-facing, Booking, Merchant, or Operations surface, so qualification cannot enable customer booking traffic.

Added a Notifications-owned, Effect-schema-decoded qualification and alert policy for the settled delivery, latency, complaint, provider-cost, and zero-tolerance integrity thresholds; actual-topology authority tests for both Alchemy stacks; rollback-compatible legacy/version-1 envelope and expand/contract evidence; a 60,000-intent deterministic load/failure model plus evidence gate; comprehensive messaging-secret, bearer-token, and unmasked Romanian phone scans; and production dead-letter wiring in Alchemy and Wrangler.

Documented the redacted environment contract, health/callback/Queue/kill-switch probes, masked dashboards and ambiguity views, actual five-minute leased job cadence, named response roles and two-person recovery boundary, rollback procedure, credential and encryption-key rotation, incident containment, and no-blind-replay recovery. Focused verification passed 26 tests across infrastructure, qualification policy, queue envelopes, migration compatibility, Background recovery, and Booking/email isolation; capability and infrastructure typechecks pass. The repository-wide test/typecheck commands remain red only in unrelated concurrently edited Web, Merchant, and Operations tests.

Real-account provisioning and the exactly-16-send live-provider gate remain owned by [Provision and Qualify the SMSO.ro Seed Route](./13-provision-and-qualify-smso-ro-seed-route.md), [Provision and Qualify the WhatsApp Production Route](./15-provision-and-qualify-whatsapp-production-route.md), and [Prove the Messaging Launch Gate and Enable Operational Messaging](./31-prove-launch-gate-and-enable-operational-messaging.md); this ticket does not claim that external evidence.
