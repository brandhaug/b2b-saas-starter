# Trace investigation

Use this branch for missing spans, slow runtime/dependency calls, or a proposed
instrumentation change. Read [automatic tracing deployment guidance](../../../../docs/deploying.md#automatic-tracing)
for the intended settings and the [Effect tracer assessment](../../../../docs/research/cloudflare-effect-tracer.md)
when considering a native adapter. Keep research conclusions there; this file
is the investigation procedure.

## Choose the evidence

Use native traces for handler timing, fetch, binding and RPC activity. Use the
existing sanitized Effect spans and optional OTLP export for named business
operations in capabilities and services. With no configured collector, the
optional exporter is inactive. Canonical events expose only their recorded
scope/invocation timings, not every nested business-operation duration. Missing
historical OTLP spans may be unavailable; this is not a native collection failure.

Native and Effect IDs, async context and parentage are separate until observed
records prove a relationship. Similar timestamps or an Effect ID stored as a
native attribute do not establish a shared trace tree or cross-queue parent.

## Verify deployed collection

1. Verify that the chosen read tool can access settings and traces for the
   specified Worker. Stop on 401/403 and report the permission gap; a working
   provisioning login does not prove telemetry access. Resolve the actual
   account, Worker, environment, active deployment and serving version or versions.
   Read deployed observability settings with a supported metadata operation or
   dashboard. Record whether native traces are enabled and persisted, and the
   effective trace sampling rate. Local Alchemy/Wrangler configuration expresses
   intent, not deployed state. If settings are inaccessible, report that gap.
2. Select a recent representative invocation inside retention with evidence of
   its Worker, version, UTC time and actual execution. Prefer existing traffic;
   any synthetic request must be an authorized safe path. A static asset response
   or request rejected before a dependency call cannot prove binding spans.
3. Inspect the invocation's native trace through the available read tool or
   dashboard. Compare the observed handler and automatic runtime spans with the
   operations that invocation actually performed. Use the current
   [span catalog](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)
   to check supported instrumentation. Record sanitized operation labels,
   durations, outcomes and evidence references for expected and observed spans.
   Do not copy SQL text, URL paths, exception messages or raw attributes into
   the report; native collection bypasses the application sanitizer.
4. State collection and coverage separately: a deployed setting does not prove
   ingestion, and one trace does not prove every operation is instrumented.
   Complete verification only when deployed settings and representative captured
   invocation evidence agree. Otherwise name the unresolved check.

For missing spans, check in order: effective read permissions and selected
account/Worker, actual serving version and deployed settings, trace sampling,
retention/window, actual traffic and execution of the expected operation, then
current platform instrumentation limits. A sampled-out or expired invocation is
not evidence of a broken tracer. Use the [skill
workflow](../SKILL.md#query-narrowly) to bound queries and sanitize evidence.
Changing collection, sampling or deployment requires separate operational
authorization; investigation alone does not enable traces.

## Decide whether instrumentation is missing

First identify the diagnostic question that existing native spans, canonical
events and Effect service spans cannot answer. Prefer existing Effect services
and spans for business operations. An instrumentation proposal must name the
missing operation or relationship and the evidence needed to demonstrate it.

Before proposing a second tracer provider, `cloudflare-effect-tracer`, or a
handwritten bridge, apply the [adapter decision guidance](../../../../docs/research/cloudflare-effect-tracer.md#adoption-or-handcrafting-later).
Check output-boundary sanitizer preservation, including exception recording;
identify who owns `Tracer.Tracer` and how existing OTLP logs, metrics and spans
remain correct. Layer composition alone does not establish dual export.
Require a demonstrable missing capability, not just a preference for one UI.

Any separately authorized adapter trial belongs with the logger and needs
deployed evidence for duration and parentage through suspension, parallel fibers,
failure, interruption and HTTP-to-queue handoff, plus privacy and disabled-provider
checks. Preserve Effect context as authoritative for its existing continuation.
Promise native/Effect correlation or native span parenting only after observing
it. Investigation output may recommend a scoped follow-up; it does not install
an adapter or change tracing providers.
