# @b2b-saas-starter/logger

## Purpose & Scope

The one observability seam for all three workers: wide events, OTel traces, RED metrics, OTLP export (ADR 0007, ADR 0050). Nothing else constructs a logger, tracer, or span. Vendor glue: `./providers`.

## Usage Patterns

`withRequestScope` (one span, one `Scope`, one canonical line on exit) is always wrapped; handlers annotate inside it with `Effect.annotateLogsScoped`.

- HTTP entry points call `withHttpInvocation`, not `withHttpRequestScope`: scope and OTLP layer are one recipe (invariant 3).
- Queue and cron triggers call `withTriggerScope`; in `apps/background` one invocation carries a batch, so `runInvocation` provides exporters once around N scopes.

## Invariants

1. **One event per request per service.** A request-scoped fact is an annotation on it, never an `Effect.log` line or a second scope.
2. **Emit from `Effect.onExit`, never a scope finalizer.** Finalizers are LIFO: one runs after `annotateLogsScoped` restores the previous annotations, silently dropping every handler field. Has regressed before.
3. **The OTLP layer is per invocation; the loggers are per isolate.** An exporter outliving its invocation stops exporting silently, so `makeOtlpLayer` is provided `{ local: true }` per entry point, _inside_ the module-scope `ManagedRuntime` (apps/api: router layer) holding the I/O-free `WideEventLoggerLive`. `loggerMergeWithExisting` keeps the console JSON event only if they are in context when it builds.
4. **Two levels, fixed.** `info` on success, `error` with the `Cause` on failure. No debug, no warn.
5. **Metric attributes stay low cardinality** — `service`, `event`, `status`. Ids go on the wide event and spans.

## Anti-patterns

- Don't build `traceparent` by hand (`currentTraceparent` encodes it) or set it outbound; `HttpClient` injects it.
- Don't hoist `makeOtlpLayer` or a PostHog client to module scope (invariant 3).
- Don't call Sentry or PostHog ad hoc: `wireWideEventProviders` sends failed scopes to Sentry and every scope to PostHog, inert without their env vars.
- Don't import `./providers` from code reaching the browser bundle.
- Don't mint a correlation id by hand; `currentTraceId` is the only source.

## Dependencies & Edges

`env`, `failure`, `effect`, optional `@sentry/cloudflare` / `posthog-node`. Consumed by all three workers, `rate-limit`, and `capabilities`; it must stay free of domain-knowledge dependencies to remain importable anywhere.
