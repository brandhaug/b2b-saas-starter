import { Cause, Effect, Exit, Layer, Logger, Option, type Scope } from 'effect'

const newTraceId = (): string => globalThis.crypto.randomUUID()

const failureMetadata = (head: unknown): Record<string, unknown> => {
  const base = {
    errorKind: 'fail',
    error: head instanceof Error ? head.message : String(head)
  }
  if (typeof head === 'object' && head !== null && '_tag' in head) {
    return { ...base, errorTag: head._tag }
  }
  return base
}

const causeMetadata = (cause: Cause.Cause<unknown>): Record<string, unknown> => {
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

export const readTraceHeader = (request: Request): string | undefined =>
  request.headers.get(TRACE_HEADER) ?? undefined

const pickString = (
  source: object | undefined,
  ...keys: readonly string[]
): string | undefined => {
  if (!source) return undefined
  for (const key of keys) {
    const value = Object.prototype.hasOwnProperty.call(source, key)
      ? (source as Record<string, unknown>)[key]
      : undefined
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export const readWideEventEnvironment = (
  source: object | undefined,
  hints?: {
    readonly colo?: string | undefined
    readonly region?: string | undefined
  }
): WideEventEnvironment => {
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

export type WideEventScopeOptions = {
  readonly service: string
  readonly event: string
  readonly traceId?: string | undefined
  readonly environment?: WideEventEnvironment | undefined
  readonly metadata?: Record<string, unknown> | undefined
}

export const withRequestScope = <A, E, R>(
  options: WideEventScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> => {
  const traceId = options.traceId ?? newTraceId()
  return Effect.scoped(
    Effect.gen(function* () {
      const startedAt = Date.now()
      yield* Effect.annotateLogsScoped({
        service: options.service,
        traceId,
        ...options.environment,
        ...options.metadata
      })
      // Emit the canonical wide event via onExit (not addFinalizer) so it runs
      // while the scope's annotations are still active — including those added
      // by handlers via annotateWide() during `body`. A scope finalizer runs
      // only after annotateLogsScoped has restored the previous annotations
      // (finalizers are LIFO), which silently drops all handler-set context
      // from the event. onExit still fires on success, failure, and interrupt.
      return yield* body.pipe(
        Effect.onExit((exit) => {
          const outcome: Record<string, unknown> = Exit.isFailure(exit)
            ? { status: 'error', ...causeMetadata(exit.cause) }
            : { status: 'ok' }
          return Effect.log(options.event, {
            durationMs: Date.now() - startedAt,
            ...outcome
          })
        })
      )
    })
  )
}

/** Cloudflare colo hint from an incoming request's `cf` object, if present. */
export const readCfColo = (request: Request): string | undefined => {
  const cf = 'cf' in request ? (request as { cf?: unknown }).cf : undefined
  return typeof cf === 'object' &&
    cf !== null &&
    'colo' in cf &&
    typeof cf.colo === 'string'
    ? (cf as { colo: string }).colo
    : undefined
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
 * trace propagation from `x-trace-id`, environment enrichment (env + cf colo),
 * and `pathname`/`method` metadata — so every worker emits the same envelope
 * from one call instead of hand-assembling `withRequestScope` options.
 */
export const withHttpRequestScope = <A, E, R>(
  options: HttpRequestScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> => {
  const url = new URL(options.request.url)
  const colo = readCfColo(options.request)
  return withRequestScope(
    {
      service: options.service,
      event: options.event,
      traceId: readTraceHeader(options.request),
      environment: readWideEventEnvironment(options.env, colo ? { colo } : undefined),
      metadata: {
        pathname: url.pathname,
        method: options.request.method,
        ...options.metadata
      }
    },
    body
  )
}

export type TriggerScopeOptions = {
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
export const withTriggerScope = <A, E, R>(
  options: TriggerScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
  withRequestScope(
    {
      service: options.service,
      event: options.event,
      traceId: options.traceId,
      environment: readWideEventEnvironment(options.env),
      metadata: options.metadata
    },
    body
  )

export const annotateWide: {
  (key: string, value: unknown): Effect.Effect<void, never, Scope.Scope>
  (values: Record<string, unknown>): Effect.Effect<void, never, Scope.Scope>
} = Effect.annotateLogsScoped

export const WideEventLoggerLive: Layer.Layer<never> = Layer.mergeAll(
  Logger.layer([Logger.consoleJson])
)

export { newTraceId }
