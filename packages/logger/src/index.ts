import {
  Cause,
  Clock,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  Metric,
  Option,
  type Scope,
  type Tracer
} from 'effect'
import { FetchHttpClient, Headers, HttpTraceContext } from 'effect/unstable/http'
import { Otlp } from 'effect/unstable/observability'

function newTraceId(): string {
  return globalThis.crypto.randomUUID()
}

function errorMessage(head: unknown): string {
  if (head instanceof Error) return head.message
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
  readonly errorTag?: unknown
}

function failureMetadata(head: unknown): WideEventFailure {
  const base: WideEventFailure = {
    errorKind: 'fail',
    error: errorMessage(head)
  }
  if (typeof head === 'object' && head !== null && '_tag' in head) {
    return { ...base, errorTag: head._tag }
  }
  return base
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

export type WideEventEnvironment = {
  readonly commitHash?: string | undefined
  readonly serviceVersion?: string | undefined
  readonly region?: string | undefined
  readonly environment?: string | undefined
}

export const TRACE_HEADER = 'x-trace-id'

export function readTraceHeader(request: Request): string | undefined {
  return request.headers.get(TRACE_HEADER) ?? undefined
}

/**
 * Read one own property of an untyped env bag as a non-empty string. The
 * descriptor lookup keeps the own-property semantics without asserting a
 * dictionary type onto the caller's `object`.
 */
function ownStringValue(source: object, key: string): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(source, key)?.value
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}

function pickString(
  source: object | undefined,
  ...keys: readonly string[]
): string | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = ownStringValue(source, key)
    if (value !== undefined) return value
  }
  return undefined
}

export function readWideEventEnvironment(
  source: object | undefined,
  hints?: {
    readonly colo?: string | undefined
    readonly region?: string | undefined
  }
): WideEventEnvironment {
  const commit = pickString(source, 'GIT_COMMIT_SHA', 'CF_VERSION_METADATA_ID')
  const version = pickString(source, 'SERVICE_VERSION', 'WORKERS_CI_BUILD_UUID')
  const region = hints?.colo ?? hints?.region ?? pickString(source, 'CF_REGION')
  const environment = pickString(source, 'ENVIRONMENT', 'NODE_ENV')
  // Built by assignment so absent fields stay absent (no `key: undefined`),
  // which keeps the emitted wide event free of empty columns.
  const resolved: {
    commitHash?: string
    serviceVersion?: string
    region?: string
    environment?: string
  } = {}
  if (commit) resolved.commitHash = commit
  if (version) resolved.serviceVersion = version
  if (region) resolved.region = region
  if (environment) resolved.environment = environment
  return resolved
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
          // by handlers via annotateWide() during `body`. A scope finalizer runs
          // only after annotateLogsScoped has restored the previous annotations
          // (finalizers are LIFO), which silently drops all handler-set context
          // from the event. onExit still fires on success, failure, and interrupt.
          // `withParentSpan` wraps the finalizer too, so the canonical line is
          // also recorded as an event on this span by `Logger.tracerLogger`.
          return yield* body.pipe(
            Effect.onExit((exit) => emitWideEvent(options, span, startedAt, exit)),
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
      return
    }
    yield* Effect.log(options.event).pipe(annotated)
  })
}

/** Cloudflare colo hint from an incoming request's `cf` object, if present. */
export function readCfColo(request: Request): string | undefined {
  if (!('cf' in request)) return undefined
  const { cf } = request
  if (typeof cf !== 'object' || cf === null) return undefined
  if (!('colo' in cf) || typeof cf.colo !== 'string') return undefined
  return cf.colo
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

function parentSpanFromRequest(request: Request): Tracer.AnySpan | undefined {
  return parentSpanFromHeaders(Object.fromEntries(request.headers.entries()))
}

/** Region hints for the environment enrichment; absent when there is no colo. */
function coloHint(colo: string | undefined): { readonly colo: string } | undefined {
  if (colo === undefined) return undefined
  return { colo }
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
      parent: parentSpanFromRequest(options.request),
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

export const annotateWide: {
  (key: string, value: unknown): Effect.Effect<void, never, Scope.Scope>
  (values: Record<string, unknown>): Effect.Effect<void, never, Scope.Scope>
} = Effect.annotateLogsScoped

/**
 * The always-on logger set. `consoleJson` is what Cloudflare Workers Logs
 * ingests; `tracerLogger` copies each record onto the active span so a wide
 * event is visible from the trace even when no log backend is configured.
 */
export const WideEventLoggerLive: Layer.Layer<never> = Logger.layer([
  Logger.consoleJson,
  Logger.tracerLogger
])

export type ObservabilityEnv = {
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string | undefined
  readonly OTEL_EXPORTER_OTLP_HEADERS?: string | undefined
  readonly SERVICE_VERSION?: string | undefined
  readonly ENVIRONMENT?: string | undefined
  readonly GIT_COMMIT_SHA?: string | undefined
}

/** Parses the OTLP `key=value,key=value` header form used by the OTel spec. */
function otlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined
  const entries = value.split(',').flatMap((entry) => {
    const separator = entry.indexOf('=')
    if (separator <= 0) return []
    const key = entry.slice(0, separator).trim()
    const headerValue = entry.slice(separator + 1).trim()
    if (key.length === 0 || headerValue.length === 0) return []
    return [[key, headerValue]]
  })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

/** OTel resource attributes, from the same env fields the wide event reads. */
function resourceAttributes(env: ObservabilityEnv): Record<string, unknown> {
  const environment = readWideEventEnvironment(env)
  const attributes: Record<string, unknown> = { 'cloud.provider': 'cloudflare' }
  if (environment.environment) {
    attributes['deployment.environment.name'] = environment.environment
  }
  if (environment.commitHash)
    attributes['vcs.ref.head.revision'] = environment.commitHash
  return attributes
}

/**
 * OTLP export of traces, metrics, and the canonical log records. `Layer.empty`
 * when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, so the starter stays
 * provider-light: without a collector the console JSON event is still emitted
 * and nothing fails.
 *
 * **Provide this per invocation, never per isolate.** The exporters flush from
 * a background fiber and from a scope finalizer, and a Cloudflare Worker may
 * not perform I/O on behalf of a request that has already ended. An exporter
 * built once per isolate would therefore stop exporting after the request that
 * created it — silently. Every entry point builds this inside the invocation
 * (`Effect.provide(..., { local: true })`) so its scope closes, and the final
 * flush runs, while the invocation is still allowed to make requests.
 *
 * Provide it *inside* `WideEventLoggerLive`, never merged beside it:
 * `loggerMergeWithExisting` reads the loggers present when this layer builds,
 * so console JSON survives only if it is already in context by then.
 */
export function makeOtlpLayer(
  serviceName: string,
  env: ObservabilityEnv
): Layer.Layer<never> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '')
  if (!endpoint) return Layer.empty
  return Otlp.layerJson({
    baseUrl: endpoint,
    headers: otlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    resource: {
      serviceName,
      serviceVersion: env.SERVICE_VERSION,
      attributes: resourceAttributes(env)
    },
    // Keep the Cloudflare console JSON event as the canonical local record.
    loggerMergeWithExisting: true,
    // Invocation-scoped exporters: the periodic fibers rarely get a turn, so
    // keep the intervals short and let the shutdown flush do the real work.
    loggerExportInterval: Duration.seconds(1),
    metricsExportInterval: Duration.seconds(1),
    tracerExportInterval: Duration.seconds(1),
    shutdownTimeout: Duration.seconds(3)
  }).pipe(Layer.provide(FetchHttpClient.layer))
}
