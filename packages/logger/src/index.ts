/**
 * Public entry of `@b2b-saas-starter/logger`. Implementation lives in the
 * sibling seam modules — import those directly from inside this package:
 *
 * - `./trace.ts` — trace continuation: `traceparent` encode/decode,
 *   `currentTraceparent` / `currentTraceId`, `TraceContinuation`.
 * - `./wide-event.ts` — the wide-event scopes (`withRequestScope` and both
 *   envelopes), sinks, RED metrics, `WideEventLoggerLive`.
 * - `./environment.ts` — deployment-identity mining (`readWideEventEnvironment`,
 *   cf colo hints).
 * - `./otlp.ts` — per-invocation OTLP export (`makeOtlpLayer`).
 */
// oxlint-disable oxc/no-barrel-file -- package-root public entry, not an internal barrel
export * from './trace.ts'
export * from './wide-event.ts'
export * from './environment.ts'
export * from './otlp.ts'
