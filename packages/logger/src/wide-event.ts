import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Logger,
  Metric,
  Option,
  Schema,
  type Layer,
  type Scope,
  type Tracer
} from 'effect'

import {
  coloHint,
  readCfColo,
  readWideEventEnvironment,
  type WideEventEnvironment
} from './environment.ts'
import {
  parentSpanFromHeaders,
  readTraceHeader,
  type TraceContinuation
} from './trace.ts'
import { type Writable } from '@b2b-saas-starter/config/writable'

const TaggedFailure = Schema.Struct({ _tag: Schema.String })

const decodeTaggedFailure = Schema.decodeUnknownOption(TaggedFailure)

function errorMessage(head: unknown): string {
  // oxlint-disable-next-line unicorn/no-instanceof-builtins -- vendor SDKs raise real `Error`s; a cross-realm failure here is reported as a string either way
  if (head instanceof Error) {
    return head.message
  }
  return String(head)
}

/**
 * The failure half of a wide event's outcome, classified from the `Cause`.
 * Fields the cause cannot supply stay absent rather than `undefined`, so a
 * successful event carries no empty error columns.
 */
type WideEventFailure = {
  readonly errorKind: 'fail' | 'interrupt' | 'defect'
  readonly error?: string
  readonly errorTag?: string
}

function failureMetadata(head: unknown): WideEventFailure {
  const base: WideEventFailure = {
    errorKind: 'fail',
    error: errorMessage(head)
  }
  const tagged = decodeTaggedFailure(head)
  if (Option.isNone(tagged)) {
    return base
  }
  return { ...base, errorTag: tagged.value._tag }
}

function causeMetadata(cause: Cause.Cause<unknown>): WideEventFailure {
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    return failureMetadata(failure.value)
  }
  if (Cause.hasInterruptsOnly(cause)) {
    return { errorKind: 'interrupt' }
  }
  return { errorKind: 'defect', error: Cause.pretty(cause) }
}

export type WideEventScopeOptions = TraceContinuation & {
  readonly service: string
  readonly event: string
  readonly traceId?: string | undefined
  readonly environment?: WideEventEnvironment | undefined
  readonly metadata?: Record<string, unknown> | undefined
}

/** The wide event's outcome fields: `ok`, or the failure classified by cause. */
type WideEventOutcome =
  | { readonly status: 'ok' }
  | ({ readonly status: 'error' } & WideEventFailure)

/**
 * What one finished wide-event scope looks like to external sinks (Sentry,
 * PostHog — see `providers.ts`). `error` is the raw failure value, not a
 * stringified one, so error SDKs keep their stack traces; it is only present
 * on failures.
 */
export type WideEventRecord = {
  readonly service: string
  readonly event: string
  /** Always present: the scope's own OTel trace id, or the caller override. */
  readonly traceId: string
  readonly spanId: string
  readonly durationMs: number
  readonly status: 'ok' | 'error'
  readonly errorKind?: 'fail' | 'interrupt' | 'defect' | undefined
  /** The failure's `_tag`, when the failure carried one. */
  readonly errorTag?: string | undefined
  readonly environment?: WideEventEnvironment | undefined
  readonly error?: unknown
}

type WideEventSink = (record: WideEventRecord) => Promise<void> | void

const wideEventSinks: Array<WideEventSink> = []

/**
 * Register a sink invoked once per completed wide-event scope. Sinks must not
 * throw (rejections are swallowed) and must finish within the invocation —
 * the same ADR 0050 rule the OTLP exporters follow. Returns an unregister
 * function.
 */
export function addWideEventSink(sink: WideEventSink): () => void {
  wideEventSinks.push(sink)
  return () => {
    const index = wideEventSinks.indexOf(sink)
    if (index !== -1) {
      wideEventSinks.splice(index, 1)
    }
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- the raw failure value goes to vendor SDKs that accept `unknown`; parsing it here would destroy the stack trace
function failureValue(cause: Cause.Cause<unknown>): unknown {
  return Option.getOrUndefined(Cause.findErrorOption(cause))
}

// Sink dispatch is promise-native vendor glue (see providers.ts); wrapping it
// in Effect would only re-wrap the same awaits one layer down. Each sink runs
// behind its own catch: a failing vendor must never fail the request it
// reported on.
// oxlint-disable effect/noAsyncFunction, effect/noTryCatch, eslint/no-await-in-loop, react-doctor/async-await-in-loop
async function runWideEventSinks(record: WideEventRecord): Promise<void> {
  for (const sink of wideEventSinks) {
    try {
      await sink(record)
    } catch {
      // ignored by contract above
    }
  }
}

function outcomeMetadata(exit: Exit.Exit<unknown, unknown>): WideEventOutcome {
  if (Exit.isFailure(exit)) {
    return { status: 'error', ...causeMetadata(exit.cause) }
  }
  return { status: 'ok' }
}

/**
 * RED metrics, derived from the same scope that emits the wide event so the
 * two can never disagree. Attributes stay deliberately low cardinality — the
 * high-cardinality dimensions (workspace, token, endpoint) belong on the wide
 * event and on span attributes, not on a metric series.
 */
const requestsTotal = Metric.counter('starter.requests', {
  description: 'Wide-event scopes completed, by service, event, and status.',
  incremental: true
})
const requestDuration = Metric.timer('starter.request.duration', {
  description: 'Wall-clock duration of each wide-event scope.'
})

function recordRedMetrics(
  attributes: Record<string, string>,
  elapsed: Duration.Duration
): Effect.Effect<void> {
  return Effect.andThen(
    Metric.update(Metric.withAttributes(requestsTotal, attributes), 1),
    Metric.update(Metric.withAttributes(requestDuration, attributes), elapsed)
  )
}

export function withRequestScope<A, E, R>(
  options: WideEventScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return Effect.useSpan(
    options.event,
    {
      parent: options.parent,
      kind: options.spanKind ?? 'internal',
      attributes: {
        'service.name': options.service,
        'event.name': options.event,
        ...options.environment,
        ...options.metadata
      }
    },
    (span) =>
      Effect.scoped(
        Effect.gen(function* () {
          // `x-trace-id` remains a backwards-compatible correlation key. It
          // defaults to the OTel trace id so one value identifies the request
          // in both the wide event stream and the trace backend.
          const traceId = options.traceId ?? span.traceId
          const startedAt = yield* Clock.currentTimeMillis
          yield* Effect.annotateLogsScoped({
            service: options.service,
            traceId,
            otelTraceId: span.traceId,
            otelSpanId: span.spanId,
            ...options.environment,
            ...options.metadata
          })
          // Emit the canonical wide event via onExit (not addFinalizer) so it runs
          // while the scope's annotations are still active — including those added
          // by handlers via annotateLogsScoped during `body`. A scope finalizer runs
          // only after annotateLogsScoped has restored the previous annotations
          // (finalizers are LIFO), which silently drops all handler-set context
          // from the event. onExit still fires on success, failure, and interrupt.
          // `withParentSpan` wraps the finalizer too, so the canonical line is
          // also recorded as an event on this span by `Logger.tracerLogger`.
          return yield* body.pipe(
            Effect.onExit((exit) =>
              emitWideEvent(options, span, traceId, startedAt, exit)
            ),
            Effect.withParentSpan(span, { captureStackTrace: false })
          )
        })
      )
  )
}

/**
 * The one canonical line per scope: message is the event name, every field is
 * an annotation, and the level is `error` exactly when the scope failed — the
 * two-level rule from the wide-event playbook. The failure `Cause` is passed to
 * the logger rather than stringified so the JSON record and the exported OTLP
 * log record both carry the full trace of the failure.
 */
function emitWideEvent(
  options: WideEventScopeOptions,
  span: Tracer.Span,
  traceId: string,
  startedAt: number,
  exit: Exit.Exit<unknown, unknown>
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const finishedAt = yield* Clock.currentTimeMillis
    const durationMs = finishedAt - startedAt
    const outcome = outcomeMetadata(exit)
    span.attribute('outcome.status', outcome.status)
    span.attribute('duration.ms', durationMs)
    yield* recordRedMetrics(
      { service: options.service, event: options.event, status: outcome.status },
      Duration.millis(durationMs)
    )
    const annotated = Effect.annotateLogs({ durationMs, ...outcome })
    if (Exit.isFailure(exit)) {
      yield* Effect.logError(options.event, exit.cause).pipe(annotated)
    } else {
      yield* Effect.log(options.event).pipe(annotated)
    }
    if (wideEventSinks.length > 0) {
      const record: Writable<WideEventRecord> = {
        service: options.service,
        event: options.event,
        traceId,
        spanId: span.spanId,
        durationMs,
        status: outcome.status
      }
      if (outcome.status === 'error') {
        record.errorKind = outcome.errorKind
        if (outcome.errorTag !== undefined) {
          record.errorTag = outcome.errorTag
        }
        if (Exit.isFailure(exit)) {
          record.error = failureValue(exit.cause)
        }
      }
      if (options.environment) {
        record.environment = options.environment
      }
      yield* Effect.promise(() => runWideEventSinks(record))
    }
  })
}

export type HttpRequestScopeOptions = {
  readonly service: string
  readonly event: string
  readonly request: Request
  /** Worker env (or `process.env`) — mined for commit/version/region fields. */
  readonly env?: object | undefined
  readonly metadata?: Record<string, unknown> | undefined
}

/**
 * Wide-event envelope for an HTTP-triggered handler. Owns the whole recipe —
 * trace continuation from `traceparent`/`b3`, the `x-trace-id` correlation key,
 * environment enrichment (env + cf colo), and `pathname`/`method` metadata — so
 * every worker emits the same envelope from one call instead of hand-assembling
 * `withRequestScope` options.
 */
export function withHttpRequestScope<A, E, R>(
  options: HttpRequestScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  const url = new URL(options.request.url)
  const colo = readCfColo(options.request)
  return withRequestScope(
    {
      service: options.service,
      event: options.event,
      traceId: readTraceHeader(options.request),
      parent: parentSpanFromHeaders(
        Object.fromEntries(options.request.headers.entries())
      ),
      spanKind: 'server',
      environment: readWideEventEnvironment(options.env, coloHint(colo)),
      metadata: {
        pathname: url.pathname,
        method: options.request.method,
        ...options.metadata
      }
    },
    body
  )
}

export type TriggerScopeOptions = TraceContinuation & {
  readonly service: string
  readonly event: string
  /** Worker env — mined for commit/version/region fields. */
  readonly env?: object | undefined
  /** Pass when the trace continues into outbound calls (e.g. webhook POSTs). */
  readonly traceId?: string | undefined
  readonly metadata?: Record<string, unknown> | undefined
}

/**
 * Wide-event envelope for non-HTTP triggers — cron schedules and queue
 * messages. Same contract as `withHttpRequestScope` minus the request-derived
 * fields.
 */
export function withTriggerScope<A, E, R>(
  options: TriggerScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return withRequestScope(
    {
      service: options.service,
      event: options.event,
      traceId: options.traceId,
      parent: options.parent,
      spanKind: options.spanKind,
      environment: readWideEventEnvironment(options.env),
      metadata: options.metadata
    },
    body
  )
}

/**
 * The always-on logger set. `consoleJson` is what Cloudflare Workers Logs
 * ingests; `tracerLogger` copies each record onto the active span so a wide
 * event is visible from the trace even when no log backend is configured.
 */
export const WideEventLoggerLive: Layer.Layer<never> = Logger.layer([
  Logger.consoleJson,
  Logger.tracerLogger
])
