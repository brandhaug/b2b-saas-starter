import { Cause, Clock, Effect, Exit, Layer, Logger, Option, type Scope } from 'effect'

function newTraceId(): string {
  return globalThis.crypto.randomUUID()
}

function errorMessage(head: unknown): string {
  if (head instanceof Error) return head.message
  return String(head)
}

function failureMetadata(head: unknown): Record<string, unknown> {
  const base = {
    errorKind: 'fail',
    error: errorMessage(head)
  }
  if (typeof head === 'object' && head !== null && '_tag' in head) {
    return { ...base, errorTag: head._tag }
  }
  return base
}

function causeMetadata(cause: Cause.Cause<unknown>): Record<string, unknown> {
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

export type WideEventScopeOptions = {
  readonly service: string
  readonly event: string
  readonly traceId?: string | undefined
  readonly environment?: WideEventEnvironment | undefined
  readonly metadata?: Record<string, unknown> | undefined
}

/** The wide event's outcome fields: `ok`, or the failure classified by cause. */
function outcomeMetadata(exit: Exit.Exit<unknown, unknown>): Record<string, unknown> {
  if (Exit.isFailure(exit)) {
    return { status: 'error', ...causeMetadata(exit.cause) }
  }
  return { status: 'ok' }
}

export function withRequestScope<A, E, R>(
  options: WideEventScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  const traceId = options.traceId ?? newTraceId()
  return Effect.scoped(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis
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
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const finishedAt = yield* Clock.currentTimeMillis
            yield* Effect.log(options.event, {
              durationMs: finishedAt - startedAt,
              ...outcomeMetadata(exit)
            })
          })
        )
      )
    })
  )
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

/** Region hints for the environment enrichment; absent when there is no colo. */
function coloHint(colo: string | undefined): { readonly colo: string } | undefined {
  if (colo === undefined) return undefined
  return { colo }
}

/**
 * Wide-event envelope for an HTTP-triggered handler. Owns the whole recipe —
 * trace propagation from `x-trace-id`, environment enrichment (env + cf colo),
 * and `pathname`/`method` metadata — so every worker emits the same envelope
 * from one call instead of hand-assembling `withRequestScope` options.
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
export function withTriggerScope<A, E, R>(
  options: TriggerScopeOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return withRequestScope(
    {
      service: options.service,
      event: options.event,
      traceId: options.traceId,
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

export const WideEventLoggerLive: Layer.Layer<never> = Layer.mergeAll(
  Logger.layer([Logger.consoleJson])
)

export { newTraceId }
