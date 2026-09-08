# Production monitoring

Configure Sentry for the production environment and route alerts to the primary
operator's email and the backup operator. Add an optional paging/chat integration
webhook in Sentry. Sentry delivers these notifications independently of the
application's transactional email transport.

`SENTRY_DSN` enables runtime telemetry. Unset it for provider-free local work.
Set `MAINTENANCE_MODE=true` on all three Workers to close customer requests and
business scheduled work. Pause provider queue delivery as well, since retries
consume the queue's retention and attempt budgets. `/ready` returns 503 while
maintenance is enabled or its bounded D1 schema probe fails. Local Seed mode
without D1 fails readiness.

## Monitor inventory

Provision the runtime monitors below, the two [backup monitors](backup-recovery.md),
and the external queue monitor. Include every deployed queue and dead-letter
queue. Budget for the complete inventory and verify monitors remain active after
billing changes.

| Monitor                                         | Configuration                                                                                                           | Incident and recovery                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Web readiness                                   | GET `<WEB_URL>/ready`, every minute, 10-second timeout                                                                  | Five consecutive failures; recover after one success                                         |
| API readiness                                   | GET `<API_URL>/ready`, same timing                                                                                      | Five consecutive failures; recover after one success                                         |
| Daily digest                                    | Cron `b2b-saas-starter-background-digest`, `0 8 * * *`, UTC                                                             | 5-minute grace and maximum runtime; failure threshold 1, recovery threshold 1                |
| Retention cleanup                               | Cron `b2b-saas-starter-background-retention`, `0 * * * *`, UTC                                                          | 5-minute grace and maximum runtime; failure threshold 1, recovery threshold 1                |
| Digest retry                                    | Cron `b2b-saas-starter-background-digest-retry`, `*/15 8-14 * * *`, UTC                                                 | 5-minute grace/runtime; failure 1, recovery 1                                                |
| Billing reconciliation and operational snapshot | Cron `b2b-saas-starter-background-billing-reconciliation`, `* * * * *`, UTC                                             | 2-minute grace/runtime; failure 1, recovery 1                                                |
| HTTP errors, per web/API service                | Metric `http.requests`, sum counts for `server_error=true` divided by sum of all counts in a rolling five-minute window | Ratio >0.05 AND denominator >=20; recover when ratio <=0.05 or traffic falls below gate      |
| Overdue billing                                 | Gauge `billing.overdue_workspaces`, latest value                                                                        | >0; recover at 0                                                                             |
| Systemic email send failure                     | Gauge `email.recent_transport_failures`, latest value                                                                   | >=3 messages over the five-minute evidence window; recover below 3                           |
| Pending email backlog                           | Gauge `email.overdue_pending`, latest value                                                                             | >0 messages pending before acceptance for >=15 minutes; recover at 0                         |
| Terminal queue work                             | Counter `operations.failures`, `signal=queue_exhausted`                                                                 | Any event; notify on new/regressed incident, require operator disposition before resolving   |
| Observed old queue work                         | Same counter, `signal=queue_backlog_age`                                                                                | Any message observed >=15 minutes old; inspect provider backlog, resolve after it drains     |
| Email event processing                          | Same counter, `signal=email_event_processing_failed`                                                                    | >=3 retries in five minutes; recover when processing resumes and window clears               |
| Security evidence gap                           | Sentry issue `security_evidence_gap`                                                                                    | Any gap; resolve only after evidence has been recovered or uncertain access is revoked/reset |

Provision the cron monitors with these schedules before relying on check-ins:
SDK check-ins name the monitor but do not replace the operator's schedule and
notification setup. Configure missing telemetry as unknown/alerting, never as
healthy. In particular, a missed operational snapshot cannot clear billing or
email incidents. The snapshot emits zeros after failures resolve.

Use Sentry's metric monitor editor to apply the error-ratio denominator gate. If
the account's editor cannot express the combined condition, route the equivalent
metric query through an operator-managed rule that can; do not enable an
ungated percentage alert and call the policy complete. Verify the exact rule in
the controlled drill, including low traffic and recovery.

## Provider queue monitoring

Consumer telemetry sees only delivered messages. The independent
[queue-monitor workflow](../.github/workflows/queue-monitor.yml) reads Cloudflare's
[queue metrics API](https://developers.cloudflare.com/queues/observability/metrics/)
every five minutes without consuming messages. A nonempty queue fails when its
oldest message is at least fifteen minutes old or the age is unknown. Any
positive dead-letter count fails. A drained queue returns a successful check-in.

Set repository variable `OPS_MONITORING_ENABLED=true`. Create an
`operations-monitoring` GitHub environment without deployment approval waits,
with least-privilege queue-read credentials in `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, plus `SENTRY_DSN`. Set environment variables
`SENTRY_QUEUE_MONITOR_SLUG` and `OPS_QUEUES`, for example:

```json
[
  { "id": "<32-character-queue-id>", "name": "isolated-webhooks", "deadLetter": false },
  { "id": "<32-character-dlq-id>", "name": "isolated-webhooks-dlq", "deadLetter": true }
]
```

Inventory all physical queues in `stageResourceNames` from `infra/bindings.ts`.
Configure the Sentry cron slug with `*/5 * * * *`, UTC, ten-minute grace, five-minute
maximum runtime, failure threshold one and recovery threshold one. The grace
allows GitHub scheduling delays; it does not extend queue retention. A failure
or missed run must notify the operator independently of transactional email.
`node scripts/queue-health.ts` runs the same check from an operator shell.

The metric API reports approximate backlog. Keep unknown results actionable and
verify recovery at the provider before replaying or discarding jobs.

## Evidence and first response

Runtime events contain queue/message IDs and attempt counts in Sentry event
context. Metric dimensions and event fingerprints stay stable across messages.
Use those IDs to inspect the existing durable delivery and billing records.
For overdue billing, use [billing operator commands](billing-operator-runbook.md)
to find affected Workspaces and inspect current Stripe state. The gauge uses the
persisted first unresolved timestamp, including work waiting behind backoff;
repaired drift does not increment it.

Email transport counts exclude provider acceptance and recipient bounces,
complaints and suppression. Use [email diagnostics](email-delivery.md) for
individual recipients. Do not resolve delivery uncertainty by replaying old auth
codes or links. Send failures, event-consumer failures, scheduled failures and
terminal queue work require different first checks; see the
[response table](operations.md#alert-ownership-and-response).

For metric and uptime incidents, enable opening and recovery notifications and
deduplicate by environment, service and monitor. For terminal jobs and security
evidence gaps, an operator resolves the issue after reviewing durable evidence;
a successful later unrelated job does not repair the exhausted job. Configure a
resolved-issue notification for that manual recovery too.

## Verification

Run the [isolated drill](operations.md#drill-evidence), using its
[record template](operations/drill-record.md). Keep both delivered opening and
recovery notifications with timestamps. Local tests exercise the HTTP counting,
cron lifecycle, retry budgets, persisted fifteen-minute billing threshold,
recipient-bounce exclusion and recovery gauges. They do not prove provider
configuration, queue metrics, notification routing, budget activation or delivery.
