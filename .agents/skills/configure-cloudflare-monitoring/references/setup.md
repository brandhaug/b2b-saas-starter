# Account setup

## Choose a supported implementation

SQL Alerts and the unified SQL API launched in beta on October 2, 2026. Recheck
account availability and current documentation before applying a configuration.
[Announcement](https://blog.cloudflare.com/one-observability-platform/)

The inspected `alchemy@2.0.0-beta.79` has
`Cloudflare.Alerting.NotificationPolicy`, `NotificationWebhook`, and `Silence`.
Its policy accepts an alert type, filters, destinations, and repeat interval.
The installed `@distilled.cloud/cloudflare@1.0.0-rc.12` `CreatePolicyRequest`
does not expose a SQL query or evaluation-window property. No Custom Dashboard
resource was found in Alchemy's Cloudflare exports. An open-ended alert-type
string does not establish SQL-rule support.

Before introducing code, inspect the installed Alchemy resource and underlying
SDK request/serialization schema. Use declarative resources when they preserve
the complete required configuration and read it back correctly. Otherwise use
the supported dashboard workflow below and keep its exact settings in the private
operations record. Do not invent alert types, filter keys, dashboard JSON import
formats, or endpoints. Existing Worker logging/tracing settings already supply
collection; this setup adds no runtime SDK, SQL binding, or credential.

## Discover before writing queries

Use the available authenticated query tool described by
[investigate-cloudflare](../../investigate-cloudflare/SKILL.md). For the unified
SQL API, discover the target account's datasets, then inspect the selected
dataset with columns and custom attributes. The documented discovery operation is
`GET /client/v4/analytics/sql/introspection`, with `account_tag`, then
`dataset_name`, `include_columns=true`, and `include_custom_attributes=true`.
Use a credential-aware client without printing its authentication headers.
[Introspection](https://developers.cloudflare.com/analytics/sql-api/datasets/)

Store a sanitized mapping before composing executable SQL:

| Evidence           | Mapping to establish in this account                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Native invocation  | Dataset; timestamp; Worker; HTTP trigger; invocation-row discriminator and unique identity; outcome; optional HTTP response status |
| Application events | Dataset; timestamp; Worker; structured payload path for `event`, `service`, `signal`, `values`, `evidence`                         |
| Scheduled work     | Payload paths for `monitorSlug`, `status`; whether runs can be correlated without ambiguity                                        |
| Coverage           | Collection start, retention, sampling, ingestion delay, query permissions, and a bounded count for each Worker                     |

Select one schema-qualified dataset per query with account scope and explicit UTC
start/end. Use exact discovered identifiers and supported operators. Preview a
small aggregate before saving a rule. Discovery success alone does not establish
query authorization. Custom attribute discovery covers recent data and may omit
fields; inspect a narrowly selected sanitized event when necessary. Preserve
literal dotted snapshot keys if the payload stores them as JSON object keys.

Native logs may have several rows per invocation. Verify the invocation filter
and count each HTTP invocation once, including no-response failures and requests
rejected at entry-point gates. Neither error-log rows, trace spans, grouped Issues,
nor application request events provide the denominator. Use unsampled evidence
for the starter's count gates; mark an adaptively sampled-only source as a coverage
gap rather than claiming an exact low-volume threshold.

## Shared dashboard

In the account's Custom Dashboards, find or create
`b2b-saas-starter/<stage>/operations`. Record its provider ID/URL. Use one dashboard
for web, API, and background, with a recent time range within retention and exact
Worker filters on every chart. Dashboard-wide status/error filters must not
silently narrow an HTTP ratio's denominator.

The documented Workers Logs chart source exposes invocation/log events; Traces
exposes spans. Choose metrics and dimensions from the actual editor. Save these
panels where supported, retaining the listed title as the logical chart key:

| Chart key             | Configuration intent                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `http-volume`         | Native HTTP invocation counts over time, split by web/API Worker; include a total for the same five-minute ratio window                   |
| `http-errors`         | Error numerator and ratio per web/API Worker using the same invocation filter as volume; display the denominator and gate beside the rate |
| `worker-failures`     | Error-level log counts by Worker across all three services, clearly labeled as log events                                                 |
| `worker-duration`     | Native invocation wall/CPU time by Worker and trigger, using supported aggregates                                                         |
| `operations-snapshot` | Latest billing/email snapshot values and timestamp, with stale/unknown status                                                             |
| `operations-failures` | Counts by `signal` and Worker, with a bounded event drill-down                                                                            |
| `scheduled-work`      | Check-in status by monitor slug and last successful completion time                                                                       |
| `trace-duration`      | Optional span duration/count by service; keep span counts distinct from invocations                                                       |

Custom payload fields, computed ratios, or latest-value selection may not be
available in the chart editor. Keep unsupported panels as explicit gaps in the
operator record and save a verified Logs/SQL query for that check instead. Do not
substitute a sum of snapshot values or a count of spans. Sharing is account-based;
verify the intended operators can view it without expanding account access.
[Chart controls and Worker datasets](https://developers.cloudflare.com/analytics/custom-dashboards/#workers-observability-data),
[October 2 release](https://developers.cloudflare.com/changelog/post/2026-10-02-workers-observability-in-custom-dashboards/)

## Alert configuration

Use Alerts > Overview > Create an Alert, selecting the custom SQL/threshold option
when available. Build from the discovered mapping and preview the query before
saving. Use the conditions, windows and recovery rules in
[the canonical policy](../../../../docs/monitoring.md#runtime-evidence-and-alert-policy)
and [schedule policy](../../../../docs/monitoring.md#scheduled-work-and-missing-evidence).
Do not substitute an anomaly or SLO rule for an exact threshold.
[Alert workflow](https://developers.cloudflare.com/notifications/get-started/)

Use stable logical names `b2b-saas-starter/<stage>/<service>/<monitor>` and map each
to its provider ID. Configure the following rule families:

| Monitor key                                                         | Query/evaluation shape                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http-errors` per web/API                                           | Over the same five-minute HTTP invocation set, calculate N total and E where invocation failed OR response is 5xx, counting an invocation only once. Evaluate N >= 20 AND E > 0.05 * N. Zero traffic is unknown, not recovery. Positive traffic below the gate can recover only with telemetry coverage established. |
| `billing-overdue`, `email-transport`, `email-pending` on background | Select the newest `operations.snapshot` by event timestamp, validate its required values, then compare to the canonical thresholds. An invalid newest snapshot is unknown; do not fall back to an older healthy one. Never sum snapshots or take their maximum. Require a fresh below-threshold value to recover.    |
| `snapshot-freshness` on background                                  | Evaluate snapshot age against the policy even when the queried window has no rows. Missing/malformed values and query failure are unknown. If SQL skips empty windows or cannot express the check, retain an independent watchdog and record SQL absence coverage as unsupported.                                    |
| Each `operations.failure` signal                                    | Filter the exact signal, preserving the canonical occurrence/window threshold. Signals requiring operator disposition remain open in the incident system even after the SQL window empties.                                                                                                                          |
| Each scheduled monitor                                              | Detect failed, missing, or uncompleted runs against that slug's UTC schedule and runtime limit. Where correlation or empty-window evaluation is insufficient, use the independent heartbeat monitor; an unrelated successful slug cannot recover it.                                                                 |

Start with a one-minute evaluation cadence where the account supports it. Record
the actual cadence, lookback, data delay, threshold, pending period, repeat interval,
no-data/error handling and recovery mechanism separately. A notification repeat
interval is not an evaluation window. If the available minimum cadence cannot meet
the snapshot freshness requirement, record the gap and use the independent check.

Preserve the existing external readiness probes, missed-run/backup checks and
provider queue monitoring. The Cloudflare dashboard shares the application's
failure domain and consumer logs cannot establish provider queue depth.

## Reconcile and record

Before editing, inventory existing IDs, ownership, chart settings, queries and
destinations. Read a recorded ID first; if it is missing, list resources and match
the exact account/stage/logical name. A same-name resource with uncertain ownership
or multiple matches needs resolution before mutation. Update owned resources in
place; create only when absent. Preserve unrelated resources and user-added charts.
Archive the previous owned configuration privately so it can be restored.

Prepare rules disabled when the UI supports that state. If creation enables a rule
immediately, defer creation until the destination and activation are authorized.
Never press Test, send a webhook, or activate a rule with a guessed destination.
Destination tests verify routing only; use the verification reference for actual
condition/recovery behavior. If native recovery is unsupported, identify and test
the incident system's recovery procedure before calling coverage complete.

Read back every changed resource, compare semantic settings, then run discovery
and reconciliation again. The second pass must retain the same IDs and produce no
changes. For rollback, restore only changed owned settings and disable newly
created rules; delete owned resources only when removal is requested.

The private record must contain account/stage and deployed versions, operator and
destination references, IDs, chart definitions, exact executable queries with field
mappings, evaluation/recovery settings, independent monitor IDs, verification UTC
windows and results, and blocked/unsupported checks. Link the existing
[drill record](../../../../docs/operations/drill-record.md) for delivery evidence.
