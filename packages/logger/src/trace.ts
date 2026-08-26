import { Effect, Option, type Tracer } from 'effect'
import { Headers, HttpTraceContext } from 'effect/unstable/http'

function newTraceId(): string {
  return globalThis.crypto.randomUUID()
}

export const TRACE_HEADER = 'x-trace-id'

export function readTraceHeader(request: Request): string | undefined {
  return request.headers.get(TRACE_HEADER) ?? undefined
}

/**
 * W3C `traceparent` for any span, including the `ExternalSpan` decoded from an
 * upstream header. `HttpTraceContext.toHeaders` only accepts a live
 * `Tracer.Span`, and every producer here (queue publisher, tests) may hold
 * either shape, so the encoder lives once, here.
 */
export function traceparentFor(span: Tracer.AnySpan): string {
  return `00-${span.traceId}-${span.spanId}-${traceFlags(span.sampled)}`
}

/** W3C trace-flags byte: bit 0 is the sampled flag, the rest are reserved. */
function traceFlags(sampled: boolean): string {
  if (sampled) return '01'
  return '00'
}

/**
 * The current span's `traceparent`, or `undefined` outside a span. Producers
 * that hand work to another service (queue messages, stored jobs) stamp this
 * onto the payload so the consumer can continue the same trace.
 */
export const currentTraceparent: Effect.Effect<string | undefined> = Effect.map(
  Effect.option(Effect.currentParentSpan),
  Option.match({
    onNone: () => undefined,
    onSome: (span) => traceparentFor(span)
  })
)

/**
 * The current trace's id, or a fresh correlation id outside a span. Used for
 * the `x-trace-id` header so the legacy correlation key and the OTel trace id
 * are the same value whenever a trace exists.
 */
export const currentTraceId: Effect.Effect<string> = Effect.map(
  Effect.option(Effect.currentParentSpan),
  Option.match({
    onNone: () => newTraceId(),
    onSome: (span) => span.traceId
  })
)

/**
 * How this span joins an existing trace: the decoded upstream parent (from a
 * `traceparent`/`b3` header or a queue message) and this span's kind. One
 * concept, so both scope option types intersect it instead of each declaring
 * the pair. `traceId` is *not* part of it — that is the `x-trace-id`
 * correlation override, which says nothing about span continuation.
 */
export type TraceContinuation = {
  /** A decoded W3C/B3 parent propagated from an upstream service. */
  readonly parent?: Tracer.AnySpan | undefined
  readonly spanKind?: Tracer.SpanKind | undefined
}

/**
 * The upstream span to continue, decoded from `traceparent`/`b3` headers, or
 * `undefined` when they are absent or unparseable. The return value is a span
 * to pass as `TraceContinuation.parent` — `traceparentFor` is the encoder in
 * the other direction.
 */
export function parentSpanFromHeaders(
  headers: Record<string, string | undefined>
): Tracer.AnySpan | undefined {
  const presentHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  return Option.getOrUndefined(
    HttpTraceContext.fromHeaders(Headers.fromRecordUnsafe(presentHeaders))
  )
}
