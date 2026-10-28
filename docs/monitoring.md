# Production monitoring

Workers Logs and Workers Issues collect runtime failures on Cloudflare. The
committed Worker configuration enables them; no application telemetry secret or
SDK is required. Local development writes the same sanitized events to the
console. [Workers Issues](https://developers.cloudflare.com/workers/observability/issues/)
groups uncaught exceptions, failed invocations, HTTP 5xx responses, and error
logs. It requires Wrangler 4.134.0 or later and processes new traffic after enablement.

Configure an occurrence-threshold automation and a
recurrence-after-inactivity automation for each production Worker. Route them to
the operator's incident-management service or HTTPS webhook, with the backup
operator included. An occurrence threshold triggers once when crossed, not on
every later occurrence. Verify delivery at the destination; a successful
automation run only confirms acceptance by Cloudflare Notifications.
See [Issues automations](https://developers.cloudflare.com/workers/observability/issues/automations/).

Cloudflare's [October 2 observability announcement](https://blog.cloudflare.com/one-observability-platform/)
adds custom SQL Alerts in beta for Workers events and other observability data.
Use these for windowed counts, ratios and snapshot thresholds below. Follow
[configure-cloudflare-monitoring](../.agents/skills/configure-cloudflare-monitoring/SKILL.md)
to set up or reconcile the shared three-Worker dashboard and account-specific
rules. Its setup reference covers SDK support, schema discovery, chart definitions,
repeatable updates and rollback; its verification scenarios cover gates, freshness,
no-data behavior and delivery. The optional monitoring stack below provisions owned
rules after configuration. Keep resource IDs and verification evidence in the
deployment's private operations record.

## Optional monitoring stack

`monitoring.config.ts` defaults to `{ enabled: false }`. Importing that public
configuration declares no resources. `alchemy.monitoring.ts` uses Alchemy beta.84's
native `Cloudflare.Alerting.CustomAlert`, `NotificationPolicy`, and
`Cloudflare.Workers.IssueAutomation`, with operator-owned local state, like the
email provisioning stack. No live monitoring has been provisioned by this change.

This stack has a single production owner. Both the configuration stage and Alchemy
state stage must be `prod`; other stages fail before any resources are declared.
Use one operator state directory for one Cloudflare account and one GitHub
repository. The repository-wide queue-monitor gate and fixed environment name
cannot represent multiple stage or account owners. Serialize operator applies and
transfer the existing state when changing operators. Changing directories or
retargeting this configuration is not a way to create a second monitor owner.

Before enabling configuration, supply the account ID, `prod` stage, existing authorized
webhook or PagerDuty destination IDs, and exact SQL rules. The `MonitoringConfig`
type in `infra/monitoring-settings.ts` describes the required fields. Each rule
requires a discovered dataset, a private verification-record reference, an
independent missing-data watchdog reference, and a recovery procedure. The query
must return a single numeric `value`, scope the account and exact deployed Worker,
and use the verified field mapping. It must have no trailing semicolon. Never copy
an example dataset or field name into production without discovery and preview.
The validator checks configuration shape, not SQL semantics or account access.

Before declaring resources, the stack inventories all account notification policies
with the authenticated Distilled API. Duplicate desired names fail the plan. A
same-name policy must match the policy ID saved for that logical resource in the
operator's Alchemy state, including its account and resource type. For intentional
adoption, verify the existing policy and set `adoptPolicyId` on that SQL rule or
the `issues` block. The ID must match the unique named policy and its alert type;
an arbitrary `--adopt` flag does not bypass this check. Inventory permission or
state-read failures stop provisioning. Keep the adoption ID until state records
ownership, then remove it. This preflight compensates for the native notification
policy providers' first-name-match behavior.

Use `activate: false` to provision disabled policies and automations. Opt into
`issues` with explicit occurrence and inactivity thresholds to create both
automation types for each of the three stage Workers. With the correct Cloudflare
profile and credentials, preview the operator stack with:

```sh
pnpm run bootstrap:monitoring:plan
```

Use `prod` and the same operator state directory on every subsequent run. After
reviewing the plan and completing the setup prerequisites, an operator can run
`pnpm run bootstrap:monitoring`. Activation is a separate reviewed
configuration change to `activate: true`; creation acceptance does not prove
delivery. Keep `enabled: true` with `activate: false` when pausing managed rules.
Setting `enabled: false` after deployment removes them from the desired resource
set and can plan their deletion. Back up the local state securely, especially
when it contains a generated queue-monitor token. Never commit that state.

Repeat `pnpm run bootstrap:monitoring:plan` without `--force` to check convergence.
Expect unchanged resource IDs and no planned changes when inputs and observable
provider settings have not changed. GitHub secret values are write-only; an
unchanged normal plan cannot prove their remote contents match local state. If a
credential was overwritten externally, pause the queue-monitor gate and explicitly
force reconciliation to re-upload it. A forced apply can write secrets even when
their configured values are unchanged, so it is not a zero-write convergence check.

Cloudflare's [Monitors documentation](https://developers.cloudflare.com/notifications/monitors/)
states that no rows produce no signal and cannot trigger an evaluation. The
native resource exposes no configurable no-data/error state or recovery policy.
An empty or failed query must therefore remain unknown in the independent
watchdog and incident system; it must not resolve an incident. Even a verified
empty-window SQL expression cannot detect loss of the Cloudflare account itself.
Most datasets support one-minute evaluation, but Log Explorer requires at least
ten minutes and cannot meet the two-minute snapshot freshness policy.

The optional `queueMonitor` block owns the `operations-monitoring` GitHub
environment, an account-scoped `Queues Read` token, both workflow secrets and
`OPS_QUEUES`. Supply the six always-deployed physical queue IDs keyed by their
`stageResourceNames` property names, the repository/default branch, and a private
missed-run watchdog reference. The stack derives queue names and dead-letter flags.
Include `workspaceExportQueue` only when workspace exports are deployed.
It publishes the repository `OPS_MONITORING_ENABLED` variable only after both
secrets and the inventory have reconciled, setting it to the `activate` value.
Do not assign these same resources to another stack. The environment permits only
the configured default branch. New environments have no approval wait. Remove
reviewers and wait timers from an existing environment before adopting it; the
stack omits these fields for compatibility with private repositories. Initial setup needs
Cloudflare account token-write permission plus alert/Issues management access,
and GitHub environment/secret/variable write access. The generated runtime token
has only account-scoped queue-read permission, not deployment or consumption rights.

When updating an already active queue monitor, first set `activate: false` and
apply that pause before changing credentials or inventory. A failed update is
not transactional and can leave the previously published gate enabled. Configure
GitHub failure notifications and the independent ten-minute missed-run check
before activation. External readiness probes and dashboards remain operator-managed.

Set `MAINTENANCE_MODE=true` on all three Workers to close customer requests and
business scheduled work. Pause provider queue delivery as well, since retries
consume the queue's retention and attempt budgets. `/ready` returns 503 while
maintenance is enabled or its bounded D1 schema probe fails. Local Seed mode
without D1 fails readiness.

## Runtime evidence and alert policy

These are the required deployment policies. Issues detection alone does not
implement ratio gates, stale-data checks, uptime probes or recovery notifications.
Keep logs unsampled when using event counts to evaluate these policies.

| Monitor                     | Evidence and condition                                                                                                                           | Recovery                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Web and API readiness       | External GET `<WEB_URL>/ready` and `<API_URL>/ready` every minute, 10-second timeout; five consecutive failures                                  | One success                                                                   |
| HTTP errors, per service    | Native HTTP invocation records: failed invocations or HTTP 5xx divided by all HTTP invocations in five minutes; ratio >0.05 and denominator >=20 | Ratio <=0.05 or traffic below the gate, with telemetry present                |
| Overdue billing             | Latest `operations.snapshot` value `billing.overdue_workspaces` >0                                                                               | Fresh value 0                                                                 |
| Systemic email send failure | Latest snapshot value `email.recent_transport_failures` >=3, covering five minutes                                                               | Fresh value below 3                                                           |
| Pending email backlog       | Latest snapshot value `email.overdue_pending` >0, covering messages pending acceptance for >=15 minutes                                          | Fresh value 0                                                                 |
| Terminal queue work         | `operations.failure`, `signal=queue_exhausted`; any occurrence                                                                                   | Operator disposition of the affected job                                      |
| Observed old queue work     | `operations.failure`, `signal=queue_backlog_age`; any delivered message >=15 minutes old                                                         | Provider backlog drained                                                      |
| Email event processing      | `operations.failure`, `signal=email_event_processing_failed`; >=3 events in five minutes                                                         | Processing resumes and window clears                                          |
| Security evidence gap       | `operations.failure`, `signal=security_evidence_gap`; any occurrence                                                                             | Evidence recovered or uncertain access revoked/reset                          |
| Completed action audit gap  | `operations.failure`, `signal=audit_write_gap`; any occurrence                                                                                   | Authoritative state reviewed and audit repaired or affected access restricted |

Snapshot values are fields inside `values`, including explicit zeros after
recovery. Failure details are inside sanitized `evidence`; snapshot service is
`background`. For HTTP ratios, select the deployed web or API Worker and use native
invocation outcomes and response statuses. Count each invocation once, including
requests rejected by maintenance, readiness, or other entry-point gates. Application
wide events do not cover every gate and cannot supply the complete denominator.
Verify the dataset includes failed invocations with no HTTP response, and count
those as errors. Inspect actual native field names before configuring the query.
Issue occurrences are grouped errors, not request totals.

Best-effort webhook, seat synchronization, and notification-email publication
failures retain `webhookPublish`, `seatSyncPublish`, or
`notificationEmailEnqueue` with the value `failed` on the originating request
event. The request can still have `status: ok` because its mutation committed.
Notification email events also retain recipient and enqueue counts. Provider
diagnostic strings remain excluded from application telemetry.

Auth audit body failures retain `authAuditBodyErrorTag: AuthAuditBodyUnreadable`
on the request event. Request bodies and parsing diagnostics remain excluded.

## Scheduled work and missing evidence

Scheduled work emits `event=cron.check_in`, a `monitorSlug`, and `status` of
`in_progress`, `ok`, or `error`. Errors use `console.error` for Issues detection.
These are structured logs, not a provider cron-monitor check-in API.

| Monitor slug                                         | UTC schedule      | Grace and maximum runtime |
| ---------------------------------------------------- | ----------------- | ------------------------- |
| `b2b-saas-starter-background-digest`                 | `0 8 * * *`       | 5 minutes                 |
| `b2b-saas-starter-background-retention`              | `0 * * * *`       | 5 minutes                 |
| `b2b-saas-starter-background-digest-retry`           | `*/15 8-14 * * *` | 5 minutes                 |
| `b2b-saas-starter-background-billing-reconciliation` | `* * * * *`       | 2 minutes                 |

Alert on a failed run, a missing expected run, or an `in_progress` event without
a completion within its runtime limit. Require a fresh successful run to recover.
The billing reconciliation run also emits the operational snapshot. Treat a
snapshot older than two minutes as unknown/alerting; absence cannot clear billing
or email incidents. Configure a SQL absence rule only after verifying that it
actually evaluates a window with no events. Otherwise use an independent
watchdog. Keep external readiness probes and missed-run monitoring independent
of the application's transactional email and production Cloudflare account.

## Provider queue monitoring

Consumer telemetry sees only delivered messages. The independent
[queue-monitor workflow](../.github/workflows/queue-monitor.yml) reads Cloudflare's
[queue metrics API](https://developers.cloudflare.com/queues/observability/metrics/)
every five minutes without consuming messages. A nonempty queue fails when its
oldest message is at least fifteen minutes old or the age is unknown. Any
positive dead-letter count fails. A drained queue returns a successful job.

Set repository variable `OPS_MONITORING_ENABLED=true`. Create an
`operations-monitoring` GitHub environment without deployment approval waits,
with least-privilege queue-read credentials in `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. Set environment variable `OPS_QUEUES`, for example:

```json
[
  { "id": "<32-character-queue-id>", "name": "isolated-webhooks", "deadLetter": false },
  { "id": "<32-character-dlq-id>", "name": "isolated-webhooks-dlq", "deadLetter": true }
]
```

Inventory all physical queues in `stageResourceNames` from `infra/bindings.ts`.
Configure GitHub Actions failure notifications for operators. Use an independent
watchdog to detect a missing successful run after ten minutes, allowing for
GitHub scheduling delays. A five-minute job timeout bounds an individual run.
GitHub failure notifications alone cannot detect a disabled workflow or missed
schedule. These Node scripts run outside Workers and do not send logs to Workers
Issues. `node scripts/queue-health.ts` runs the same check from an operator shell.

The metric API reports approximate backlog. Keep unknown results actionable and
verify recovery at the provider before replaying or discarding jobs. Configure
the two [backup jobs and their missed-run monitoring](backup-recovery.md) too.

## Evidence and first response

Runtime failure evidence includes queue/message IDs and attempt counts. Use
those IDs to inspect the existing durable delivery and billing records.
For overdue billing, use [billing operator commands](billing-operator-runbook.md)
to find affected Workspaces and inspect current Stripe state. The snapshot uses
the persisted first unresolved timestamp, including work waiting behind backoff;
repaired drift does not increment it.

Email transport counts exclude provider acceptance and recipient bounces,
complaints and suppression. Use [email diagnostics](email-delivery.md) for
individual recipients. Do not resolve delivery uncertainty by replaying old auth
codes or links. Send failures, event-consumer failures, scheduled failures and
terminal queue work require different first checks; see the
[response table](operations.md#alert-ownership-and-response).

Configure opening and recovery notifications at the alert destination and
deduplicate by environment, service and monitor. A later unrelated success does
not repair an exhausted job or a security evidence gap. Resolve those only after
reviewing durable evidence and notify the operators of the disposition.

## Verification

Run the [isolated drill](operations.md#drill-evidence), using its
[record template](operations/drill-record.md). Keep delivered opening and recovery
notifications with timestamps. Include an uncaught Worker exception, handled
error log, HTTP 5xx, low-traffic ratio gate, restored zero snapshot, absent
snapshot, stopped schedule, and failed/missed GitHub job. Local tests verify
emitted evidence and domain thresholds; they do not prove Cloudflare issue
grouping, configured SQL rules, external probes, notification delivery or
missed-run detection. Record those as unverified until the provider drill passes.
