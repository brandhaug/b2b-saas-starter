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
 * - `./invocation.ts` — the HTTP entry-point envelope (`withHttpInvocation`):
 *   the request scope plus its per-invocation exporters, as one call.
 */
export {
  currentTraceId,
  currentTraceparent,
  parentSpanFromHeaders,
  TRACE_HEADER,
  type TraceContinuation
} from './trace.ts'
export {
  WideEventLoggerLive,
  withRequestScope,
  withTriggerScope,
  type HttpRequestScopeOptions,
  type TriggerScopeOptions,
  type WideEventScopeOptions
} from './wide-event.ts'
export { makeOtlpLayer, type ObservabilityEnv } from './otlp.ts'
export { withHttpInvocation, type HttpInvocationOptions } from './invocation.ts'
