# Cloudflare observability assessment

> Current implementation: PostHog has been removed. Optional browser analytics
> uses an Alchemy-managed Cloudflare Web Analytics site; server telemetry retains
> Workers Logs/Issues and optional Effect OTLP. PostHog findings below describe
> the earlier audit snapshot and are not implementation recommendations. See the
> [current integration guide](../../apps/web/content/docs/integrations/cloudflare-observability.mdx).

Reviewed 2026-10-02 for the move to native Worker error tracking. Deployment configuration and
[monitoring](../monitoring.md) define the implemented behavior. This note records
which new capabilities fit the starter and which still require account setup or
further work.

## Adopt now

Workers Issues is an open beta, free during beta, that groups exceptions, failed
invocations, HTTP 5xx responses, and `console.error` output. Wrangler 4.134.0 or
later supports `observability.issues.enabled`; the repository's version exceeds
that requirement. It processes new traffic after activation. All three Workers
can use it without an SDK or error-reporting credentials. The migration emits
failed application scopes as sanitized error-level JSON. This is the direct
replacement for server error capture. [Issues documentation](https://developers.cloudflare.com/workers/observability/issues/)

Issues automations support occurrence thresholds and recurrence after inactivity,
with webhook, chat, incident-management, and coding-agent destinations. An
operator must configure and test destinations in the account. A successful
handoff is not proof an operator received a page. Keep automatic coding-agent
connections optional; their diagnostic payloads can contain platform metadata.
[Automation documentation](https://developers.cloudflare.com/workers/observability/issues/automations/)

## Deployment and privacy

Wrangler sets `observability.redact_query_string = true`; Alchemy sets
`redactQueryString: true`. Cloudflare documents this field as removing query
strings from request URLs in logs and traces. It does not replace application
output filtering or scrub URL paths, arbitrary strings, or uncaught exception
text. Native runtime records bypass the application sanitizer and still require
inspection in the deployed account.
[Workers Scripts API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)

Alchemy's pinned `@distilled.cloud/cloudflare@1.0.0-rc.12` dependency omits Issues
and query-string redaction from `PutScriptMetadataObservability`. The repository
[patch](../../patches/@distilled.cloud__cloudflare@1.0.0-rc.12.patch) adds these
fields to its source schema, runtime JavaScript, and declarations so the upload
model retains them. The [regression test](../../scripts/cloudflare-observability.test.ts)
checks that model. Remove the patch after upgrading to a release whose unpatched
upload metadata schema preserves both fields, with the regression check passing.
Local schema verification does not prove the deployed account applied the settings.

## Use the new investigation tools

The October 2 announcement introduces unified Logs, a beta SQL API, beta custom
Alerts, custom dashboards, broader tracing, and self-serve Logpush. These are
useful operator tools, not resources this migration provisions. Start with saved
queries for request failures and the background `operations.snapshot`,
`operations.failure`, and `cron.check_in` events. Create dashboards and threshold
alerts after confirming actual field names and delivery in the target account.
The announcement marks cross-dataset queries, longer retention, and additional
OpenTelemetry capabilities as future work. Its new ingestion/storage pricing
starts December 1, 2026. Recheck costs before activation or increasing sampling.
[October 2 announcement](https://blog.cloudflare.com/one-observability-platform/)

The SQL API accepts a single SELECT over one schema-qualified dataset, with an
account or zone scope and lower time bound. Dataset availability depends on plan
and permissions. Discover schemas before writing queries; the CLI exposes
`cf sql datasets` and `cf sql query`. This is a good fit for repeatable incident
investigation without adding analytics bindings to application code.
[SQL API](https://developers.cloudflare.com/analytics/sql-api/)

The repository's `investigate-cloudflare` skill follows that read-only workflow.
It can use an already connected Observability MCP server, or an authenticated
Cloudflare CLI. Tool availability and telemetry access remain local prerequisites.
Cloudflare's official server endpoint is
`https://observability.mcp.cloudflare.com/mcp`.
[Agent setup](https://developers.cloudflare.com/agent-setup/devin/)

## Keep tracing separate

Native Workers tracing automatically records fetch, binding, RPC, and handler
operations. It has independent head sampling and seven-day retention. Those
records bypass this repository's application allowlist. Alchemy and generated
Wrangler configurations enable persisted native traces at 100% sampling for all
three Workers in every stage. Inspect captured request metadata and binding
attributes in the deployed account. The existing per-invocation
Effect OTLP exporter remains useful for sanitized application spans.
[Workers traces](https://developers.cloudflare.com/workers/observability/traces/)

Native custom spans nest through JavaScript async context. They currently lack
manual parent wiring, `spanContext()` and `setStatus`. Do not assume that turning
on platform tracing merges its trace IDs with Effect's existing spans. A bridge
would need its own interoperability and privacy validation.
[Custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/)

## Coverage limits

Workers Issues does not execute in the browser. Browser exceptions have no remote reporting; optional PostHog remains
restricted to analytics and does not capture exceptions. A browser ingest endpoint
would be separate application behavior with its own abuse and privacy policy.

Error events cannot detect a cron that never ran. `cron.check_in` logs are evidence,
not a configured missed-run monitor. Cloudflare also shares the application's
failure domain. Retain independent availability, backup freshness, and heartbeat
checks for account loss and monitoring outages. No account alerts, destinations,
or production telemetry were provisioned or verified by this repository change.

The marketing page's illustrative `env.OBSERVABILITY` snippets are not this
starter's API contract. Implementation uses documented Wrangler configuration,
console output, and the official query tools above.
[Product page](https://www.cloudflare.com/products/workers-observability/)

## Local validation evidence

On 2026-10-02, implementation commit `2e84dbd1` passed:

```sh
CI=true pnpm run validate
```

This ran the repository check, production build, generated Wrangler drift check,
local D1 migration and seed, and Chromium E2E suite. All 53 browser tests passed.
The repeatable browser report is generated at
`apps/web/playwright-report/results.json`; retain that artifact with the run log.
The SDK metadata regression and logger serialization checks ran as part of the
repository check. Existing assistant cancellation integration tests emitted
interrupt-only evidence on stdout, while failure/defect serialization checks
verified error output and privacy filtering.

Independent Standards and Spec reviews found no remaining behavioral blockers
after repair. Local evidence does not verify Cloudflare ingestion, issue grouping,
SQL alert delivery, or independent missed-run monitors. Those require the
[deployment drill](../monitoring.md#verification).
