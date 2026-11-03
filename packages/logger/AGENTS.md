# @b2b-saas-starter/logger

The one observability seam for all three workers: wide events, OTel traces, RED metrics, OTLP export (ADR 0007, ADR 0050). Nothing else constructs a logger, tracer, or span. Native operational signals: `./providers`.

## Changes

`withRequestScope` (one span, one `Scope`, one canonical line on exit) is always wrapped. Use `annotateWideEvent` for facts that must survive nested scopes. `Effect.annotateLogsScoped` works only when its scope remains open through emission.

- HTTP entry points call `withHttpInvocation`, not `withHttpRequestScope`: scope and OTLP layer are one recipe (invariant 3). Its body returns a response with numeric `status`; the wrapper records `statusCode` after transport encoding.
- Queue and cron triggers call `withTriggerScope`; in `apps/background` one invocation carries a batch, so `runInvocation` provides exporters once around N scopes.

## Invariants

1. **One canonical application event per request per service.** Request facts are annotations on that event. Native Worker invocation records supply the HTTP denominator, including entry-point gates. Operator snapshots, scheduler lifecycle check-ins, and independent evidence-gap signals are separate operational events; they must not duplicate request facts.
2. **Emit from `Effect.onExit`, never a scope finalizer.** Finalizers are LIFO: one runs after `annotateLogsScoped` restores the previous annotations, silently dropping every handler field. Has regressed before.
3. **The OTLP layer is per invocation; the loggers are per isolate.** An exporter outliving its invocation stops exporting silently, so `makeOtlpLayer` is provided `{ local: true }` per entry point, _inside_ the module-scope `ManagedRuntime` (apps/api: router layer) holding the I/O-free `WideEventLoggerLive`. `loggerMergeWithExisting` keeps the console JSON event only if they are in context when it builds.
4. **Two levels, fixed.** `info` on success, `error` on failed Effects, returned HTTP 5xx responses or translated protocol defects. Preserve translated causes with `annotateWideEventCause`; HTTP 200 does not hide an MCP defect. `status` is `ok`/`error`, `statusCode` is HTTP, and `outcome` is the business result. No debug, no warn.
5. **Metric attributes stay low cardinality**. `service`, `event`, `status`. Ids go on the wide event and spans.

## Boundaries

- Don't build `traceparent` by hand (`currentTraceparent` encodes it) or set it outbound; `HttpClient` injects it.
- Don't hoist `makeOtlpLayer` to module scope (invariant 3).
- Failed canonical events use `console.error` so Cloudflare Issues detects handled failures. Interrupt-only scopes retain their event evidence through `console.log`, avoiding Issues for cancellation. Both console methods use the same allowlisted payload.
- Don't import `./providers` from code reaching the browser bundle.
- Don't mint a correlation id by hand; `currentTraceId` is the only source.
- Only approved scalar facts survive `sanitization.ts`. Add emitted-output coverage when extending it. Use immutable IDs and code-owned operation labels; raw paths, workspace slugs, credentials, customer content and provider messages stay excluded. The known web `nested` list receives the same policy in console and OTLP.
- Operational check-ins, snapshots and failure signals take deployment identity at their execution boundary. Keep their existing operational payload shape.
- `routeTemplate` comes only from the router's registered route, never a request URL. Nested web operations use `withWideEventFacts` so one child's context cannot overwrite another's.
