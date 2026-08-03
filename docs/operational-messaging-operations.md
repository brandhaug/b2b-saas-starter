# Operational Messaging Qualification and Operations

Qualification uses `alchemy.messaging-qualification.ts`: a separate D1 database,
Queue, dead-letter Queue, callback API, and Background Worker. It deploys no Public,
Booking, Merchant, or Operations surface, so it cannot accept customer booking
traffic. Never point customer DNS or production callbacks at this stack.

## Ownership

| Responsibility                               | Primary owner          | Backup / approval           |
| -------------------------------------------- | ---------------------- | --------------------------- |
| Incident command and containment             | BeeSolo Merchant Owner | Messaging recovery approver |
| Provider credentials and callbacks           | Messaging on-call      | Security owner              |
| Destination and provider-reference keys      | Security owner         | Messaging recovery approver |
| Reconciliation, cost, and charges            | Finance owner          | BeeSolo Merchant Owner      |
| Complaints, suppression, retention, deletion | Privacy owner          | Security owner              |

One person may fill multiple primary roles in this solo launch, but global re-enable
and compromised-credential recovery require a distinct second approver. Record actual
names and contacts in restricted deployment evidence, never source control.

## Qualification deployment and probes

1. Create an isolated Cloudflare boundary with no customer DNS. Copy
   `docs/operational-messaging-qualification.env.example` into the restricted secret
   store and replace every placeholder.
2. Run `bun run check`, then `bun run deploy:messaging-qualification`. Alchemy applies
   forward migrations before the isolated Workers receive traffic.
3. Verify `GET /health`, the exact Meta challenge, invalid Meta signature rejection,
   and the secret SMSO callback path. Do not log query strings or callback bodies.
4. Verify the shared Queue consumer, `*/5` cron, and dead-letter Queue. Send one
   synthetic PII-free wake-up and prove durable state precedes acknowledgement.
5. Probe Merchant, provider/channel, callback, and global kill switches with synthetic
   data. A disabled scope must stop sends while callbacks, Booking, and email remain
   independent.

The API receives callback-verification and fingerprint material only. Submission
credentials and decryptable references belong only to Background; destination keys
belong only to Booking and Background. Infrastructure tests fail on authority drift.

## Dashboards, schedules, and alerts

Cloudflare dashboards must show Worker errors/latency, Queue backlog/retries,
dead-letter depth, cron executions, D1 errors, provider calls, and callback rejects.
Operations views show masked open reconciliation cases, submission-unknown routes,
incidents, channel controls, Provider Messaging Costs, Merchant charges, and variances.
Never display a raw destination, rendered message, credential, callback body, or token.

Alert policy is executable in `infra/operational-messaging-runtime.ts`: warning below
98% verified delivery within 15 minutes; warning below 99% for immediate submission,
due reminders, or fallback; complaint warning above 0.5% and critical above 1% after
200 seven-day deliveries; provider-cost warning above €0.036 and critical at €0.045;
and critical on any duplicate charge, negative balance, unexplained variance,
duplicate delivery, or unauthorized delivery.

The five-minute sweep recovers missed wake-ups and runs bounded leased reconciliation
and retention work. Ambiguity alerts open after 24 hours, and unresolved ambiguity
closes without charge after seven days. Treat dead letters as failed wake-ups: inspect
only their PII-free version/kind/id, correlate D1, run recovery, and archive only after
durable state is terminal or claimable. Never replay an unknown envelope or resubmit
because a callback is late.

## Qualification and failure evidence

The fixed load profile is 100 Merchants × 20 submissions/minute for 30 minutes
(60,000 total) with fake latency/callbacks. It permits no loss, platform duplicate,
duplicate charge, or ledger variance; 99% must reach first submission within 60
seconds. Inject a 15-minute Queue outage; the five-minute scan must recover and drain
within 15 minutes. Also inject provider timeout/throttling, callback loss/reordering,
D1 failure, stale leases, and retention interruption.

```bash
bun run test:messaging-qualification -- restricted-evidence.json
```

The checker blocks failed gates and scans evidence for unmasked Romanian phones,
bearer credentials, and assigned provider secrets. Repository-wide CI secret scanning
remains mandatory; this is a messaging-specific backstop.

## Recovery, rollback, and rotation

Expand D1 first. Old Workers accept legacy outbox and version 1 envelopes during the
expand/contract window; unknown versions fail closed. Roll back Workers without
rolling back D1, keep callbacks appending evidence, and leave messaging disabled if
an old binary cannot transition safely. Contract only after old versions and legacy
pending rows are gone. Booking commits and independent email remain available through
messaging disablement, outage, and rollback.

Rotate provider credentials by adding a second credential where supported, deploying
it only to its owning Worker, probing submit/callback/query, switching current use,
reconciling ambiguous attempts, then revoking the old credential. Without parallel
keys, contain the provider/channel first. Rotate encryption keys with the typed
Operations command: install the new version, re-encrypt every live row, verify zero
old-key rows, then retire the old key. Partial rotation stays blocked and retryable.

For forged callbacks, compromise, unauthorized or duplicate delivery, or incorrect
charging: preserve evidence, open an incident, apply the narrowest freeze, rotate
affected material, reconcile attempts and ledger, run regression/failure tests, probe
health and kill switches, record residual risk, and obtain required approval. Recheck
paused intents from current durable state; never replay blindly.
