# @b2b-saas-starter/logger

## Purpose & Scope

The one observability seam for all three workers: wide events, OpenTelemetry traces, RED metrics, and OTLP export. Every worker, and `packages/rate-limit` and `packages/capabilities`, import from here. Nothing else in the repo constructs a logger, a tracer, or a span for cross-cutting instrumentation — a format or transport change edits this file once. See ADR 0007 (wide events) and ADR 0050 (OTel export).

## The scope

`withRequestScope(options, body)` is the whole model. It opens one OTel span plus one `Scope`, seeds log annotations with the request's identity, runs `body`, and emits exactly one canonical line on exit.

Workers do not call it directly. Two envelopes wrap it:

- `withHttpRequestScope({ service, event, request, env, metadata })` — HTTP handlers. Owns the whole recipe: `traceparent`/`b3` continuation, the `x-trace-id` correlation key, env + cf-colo enrichment, `pathname`/`method`.
- `withTriggerScope({ service, event, env, parent?, spanKind?, metadata })` — cron ticks and queue messages, where there is no `Request`. `parent`/`spanKind` are the `TraceContinuation` pair both option types share.

Inside the scope, handlers add business context with `Effect.annotateLogsScoped(fields)` (an alias of `Effect.annotateLogsScoped`). It requires a `Scope`, which is how the type system keeps annotations from outliving the event they belong to.

## Invariants

1. **One event per request per service.** If you find yourself opening a second scope inside a first, you want a child span and `Effect.annotateLogsScoped`, not another event.
2. **The event is emitted from `Effect.onExit`, never a scope finalizer.** Finalizers are LIFO, so a finalizer runs _after_ `annotateLogsScoped` restores the previous annotations — silently dropping every field handlers added. This has regressed before; the test `emits exactly one canonical line carrying handler annotations` guards it.
3. **Two levels.** `info` on success, `error` on failure with the `Cause` attached. No debug, no warn.
4. **The OTLP layer is per invocation; the loggers are per isolate.** `makeOtlpLayer` is provided with `Effect.provide(..., { local: true })` at each entry point. A Cloudflare Worker may not perform I/O on behalf of a request that already ended, and the exporters flush from a background fiber and a scope finalizer — an exporter that outlives its invocation stops exporting, silently. `WideEventLoggerLive` (console JSON + tracer logger) is isolate-safe because it does no I/O, so every worker holds it on a module-scope `ManagedRuntime` (or, in apps/api, on the router layer) and provides the OTLP layer _inside_ it. That nesting is load-bearing: `loggerMergeWithExisting` keeps the console JSON event only if the loggers are already in context when the OTLP layer builds.
5. **Metric attributes stay low cardinality** — `service`, `event`, `status`, and nothing else. Workspace, token, and endpoint ids go on the wide event and on span attributes, where cardinality is free.

## Public surface

| Export                                         | Use                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `withHttpRequestScope` / `withTriggerScope`    | Open the one scope per invocation                                           |
| `withRequestScope`                             | The primitive both wrap; reach for it only for a genuinely new trigger kind |
| `Effect.annotateLogsScoped`                    | Add business context to the current event                                   |
| `currentTraceparent`                           | Stamp trace context onto a non-HTTP hop (queue messages)                    |
| `currentTraceId`                               | The id to hand a caller or forward as `x-trace-id`                          |
| `traceparentFor` / `parentSpanFromHeaders`     | Encode / decode W3C + B3 trace context                                      |
| `readWideEventEnvironment`                     | Deployment identity from a worker env bag                                   |
| `makeOtlpLayer`                                | Per-invocation OTLP export — see invariant 4                                |
| `WideEventLoggerLive`                          | Console JSON + tracer logger, isolate-level                                 |
| `addWideEventSink`                             | Register a per-scope sink (Sentry/PostHog glue uses this)                   |
| `makeSentryOptions` / `wireWideEventProviders` | Vendor provider glue — `./src/providers.ts`; call the latter per invocation |
| `TraceContinuation`                            | The `{ parent?, spanKind? }` pair a scope continues an upstream trace with  |
| `TRACE_HEADER` / `readTraceHeader`             | The `x-trace-id` correlation key                                            |

## Anti-patterns

- Don't call `Effect.log` for request-scoped facts. Annotate the wide event instead — a second line is a second thing to join.
- Don't build `traceparent` by hand or read it off an inbound header when producing a message. `currentTraceparent` is the encoder, and the span to continue is the one open now.
- Don't set `traceparent`/`b3` on outbound HTTP. Effect's `HttpClient` injects them.
- Don't hoist `makeOtlpLayer` to module scope in a worker, and don't merge it beside `WideEventLoggerLive` (invariant 4).
- Don't call vendor SDKs (Sentry, PostHog) ad hoc from handlers or capabilities — failed scopes already reach Sentry and every scope already becomes a PostHog event through `wireWideEventProviders` (`src/providers.ts`). Both stay inert until `SENTRY_DSN` / `POSTHOG_KEY` exist. Like the OTLP layer, the PostHog client is per invocation; never hoist one to module scope.
- Don't import `src/providers.ts` from code that reaches the browser bundle — its SDK imports are lazy for exactly that reason.
- Don't mint a correlation id by hand. `currentTraceId` is the only source; the id generator behind it is deliberately not exported.
- Don't add a log level. Two is the contract.
