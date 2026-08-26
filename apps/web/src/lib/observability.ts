import {
  makeOtlpLayer,
  WideEventLoggerLive,
  withHttpRequestScope,
  withTriggerScope
} from '@b2b-saas-starter/logger'
import { env as cloudflareEnv } from 'cloudflare:workers'
import {
  Cause,
  Effect,
  Exit,
  ManagedRuntime,
  Option,
  References,
  type Context,
  type Scope,
  type Tracer
} from 'effect'

import { currentRequest } from './request-context'

/**
 * Per-request telemetry for the web worker.
 *
 * TanStack Start fans one HTTP request out into many independent Effect runs —
 * every loader and server function calls `Effect.runPromiseExit` on its own.
 * Left alone that produces one root trace and one wide event *per loader*,
 * which is neither a wide event (the playbook wants one per request per
 * service) nor a usable trace (a page load becomes a dozen unrelated traces).
 *
 * The global request middleware in `src/start.ts` opens exactly one scope per
 * request and registers it here. Nested work then joins that scope through
 * `withWebRequestScope`: child spans under the request span, and business
 * context accumulated onto the single canonical line the middleware emits.
 */
type RequestTelemetry = {
  readonly span: Tracer.AnySpan
  /**
   * The middleware's built services — loggers, tracer, OTLP exporters, and the
   * request-level log annotations. Nested runs inherit all of it.
   */
  readonly services: Context.Context<never>
  /** Request-level annotation keys, so nested entries record only their own. */
  readonly baseKeys: ReadonlySet<string>
  /** Nested work, appended in completion order, flushed onto the wide event. */
  readonly nested: Array<Record<string, unknown>>
}

// Keyed by the request object so entries die with the request; a Worker isolate
// can interleave concurrent requests, so a module-level "current" would race.
const registry = new WeakMap<Request, RequestTelemetry>()

/**
 * Isolate-level half of the web worker's observability: the console JSON logger
 * and the tracer logger. Neither does I/O, so one set per isolate is correct —
 * and the request scope needs them in context before the exporters build.
 */
const loggerRuntime = ManagedRuntime.make(WideEventLoggerLive)

/**
 * The per-invocation half: the OTLP exporters. Provided with `local: true`
 * inside the invocation, because a Worker may not perform I/O for a request
 * that has already ended — an exporter shared across requests stops flushing
 * (see `makeOtlpLayer`). It is applied *inside* the loggers on purpose:
 * `makeOtlpLayer` merges its log exporter with the loggers already in context.
 */
function withInvocationExporters<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
  return Effect.provide(effect, makeOtlpLayer('web', cloudflareEnv), { local: true })
}

/**
 * How this module finds the in-flight request, as a port. Injected rather than
 * imported at the call site so a test drives the join with a real lookup of this
 * shape instead of replacing `./request-context` — the ambient request is the
 * one input these functions read from outside their arguments.
 */
export type CurrentRequest = () => Request | undefined

function currentTelemetry(lookupRequest: CurrentRequest): RequestTelemetry | undefined {
  const request = lookupRequest()
  if (!request) return undefined
  return registry.get(request)
}

export type WebRequestScopeOptions = {
  readonly request: Request
  /** Which Start handler is serving this request — a router page or a server fn. */
  readonly handlerType: string
  readonly serverFnId?: string | undefined
}

/**
 * The wide-event annotations this app adds to a request scope. `serverFnId` is
 * assigned only when the request is a server-function call: the bag is spread
 * into the annotations, so a key set to `undefined` would show up as an empty
 * column on the emitted event.
 */
type WebRequestMetadata = {
  handlerType: string
  serverFnId?: string
}

/**
 * Wraps one web request in the single wide-event scope every nested run joins.
 * Called only from the global request middleware.
 *
 * The exporters are built here, per request, and torn down when the scope
 * closes. One request therefore means one build and one flush, however many
 * loaders ran inside it; the loggers come from the isolate's runtime.
 */
export function runWebRequestScope(
  options: WebRequestScopeOptions,
  next: () => Promise<Response>,
  lookupRequest: CurrentRequest = currentRequest
): Promise<Response> {
  const metadata: WebRequestMetadata = { handlerType: options.handlerType }
  if (options.serverFnId) metadata.serverFnId = options.serverFnId
  return loggerRuntime
    .runPromiseExit(
      withInvocationExporters(
        withHttpRequestScope(
          {
            service: 'web',
            event: 'web.request',
            request: options.request,
            env: cloudflareEnv,
            metadata
          },
          registerAndRun(options.request, next, lookupRequest)
        )
      )
    )
    .then(settle)
}

function registerAndRun(
  request: Request,
  next: () => Promise<Response>,
  lookupRequest: CurrentRequest
): Effect.Effect<Response, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const span = yield* Effect.currentParentSpan
    // Read after the scope annotated itself, so nested runs inherit the
    // request's identity (service, traceId, pathname) for free.
    const services = yield* Effect.context<never>()
    const baseKeys = new Set(Object.keys(yield* References.CurrentLogAnnotations))
    const telemetry: RequestTelemetry = { span, services, baseKeys, nested: [] }
    registry.set(request, telemetry)
    // The middleware and the loaders may see different `Request` instances
    // (Start re-wraps the request as it flows through the handler chain), so
    // register the ambient one too when it differs.
    const ambient = lookupRequest()
    if (ambient && ambient !== request) registry.set(ambient, telemetry)
    const response = yield* runNext(next)
    yield* Effect.annotateLogsScoped({ statusCode: response.status })
    if (telemetry.nested.length > 0) {
      yield* Effect.annotateLogsScoped({ nested: telemetry.nested })
    }
    return response
  })
}

/**
 * Bridges Start's promise-returning handler chain without reshaping failures:
 * a rejection stays the original value so `settle` can re-raise it unchanged
 * and Start's own error handling sees exactly what it would have seen.
 */
function runNext(next: () => Promise<Response>): Effect.Effect<Response, unknown> {
  return Effect.tryPromise({ try: next, catch: (error: unknown) => error })
}

function settle(exit: Exit.Exit<Response, unknown>): Response {
  if (Exit.isSuccess(exit)) return exit.value
  // The handler's own failure where there is one, the squashed cause otherwise.
  // Inlined rather than a helper: the value is whatever the handler failed with,
  // so naming a return type for it would only be `unknown` under another name.
  // oxlint-disable-next-line effect/noThrowStatement -- re-raises the handler's original rejection across the Promise boundary TanStack Start owns
  throw Option.getOrElse(Cause.findErrorOption(exit.cause), () =>
    Cause.squash(exit.cause)
  )
}

export type NestedScopeOptions = {
  readonly event: string
  readonly metadata?: Record<string, unknown> | undefined
}

/**
 * Runs nested work — a loader, a server function, the auth catch-all — inside
 * the request's scope when there is one.
 *
 * Inside a request: a child span under the request span, using the request's
 * loggers and exporters, with its outcome folded into the request's one wide
 * event. Outside one (a client-side navigation, a test): a standalone scope
 * with its own layer, so the same call site works in both places.
 */
export function withWebRequestScope<A, E, R>(
  options: NestedScopeOptions,
  effect: Effect.Effect<A, E, R>,
  lookupRequest: CurrentRequest = currentRequest
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return Effect.suspend(() => {
    const telemetry = currentTelemetry(lookupRequest)
    if (!telemetry) return standalone(options, effect)
    return nested(telemetry, options, effect)
  })
}

function nested<A, E, R>(
  telemetry: RequestTelemetry,
  options: NestedScopeOptions,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  const body = Effect.gen(function* () {
    yield* Effect.annotateLogsScoped({ ...options.metadata })
    // Same `onExit` reasoning as the logger's own scope: a finalizer would run
    // after the scoped annotations were restored, losing everything the nested
    // code added with `Effect.annotateLogsScoped`.
    return yield* Effect.onExit(effect, (exit) => record(telemetry, options, exit))
  })
  return Effect.scoped(body).pipe(
    Effect.withSpan(options.event, { attributes: options.metadata }),
    Effect.withParentSpan(telemetry.span),
    Effect.provide(telemetry.services)
  )
}

/**
 * Folds one nested run into the request's wide event: its own annotations
 * (everything the request did not already carry) plus its outcome.
 */
function record(
  telemetry: RequestTelemetry,
  options: NestedScopeOptions,
  exit: Exit.Exit<unknown, unknown>
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const annotations = yield* References.CurrentLogAnnotations
    const own = Object.entries(annotations).filter(
      ([key]) => !telemetry.baseKeys.has(key)
    )
    telemetry.nested.push({
      event: options.event,
      ...Object.fromEntries(own),
      status: Exit.isSuccess(exit) ? 'ok' : 'error'
    })
  })
}

/**
 * No ambient request: emit a self-contained wide event of its own.
 * This is the client-side navigation path (loaders re-run in the browser
 * against the Seed layer) and the path unit tests take. It is also what a
 * *missed* join degrades to, so the event says `scope: 'standalone'` — a second
 * line for one request is then visibly a missed join rather than normal traffic.
 *
 * The loggers are provided here rather than taken from `loggerRuntime`, so the
 * returned Effect stays self-contained: callers run it on a bare
 * `Effect.runPromiseExit` (see `capabilities.ts`) and it must not depend on
 * which runtime they used. Building the logger layer costs nothing — it does no
 * I/O — unlike the exporters, which stay invocation scoped.
 */
function standalone<A, E, R>(
  options: NestedScopeOptions,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return withTriggerScope(
    {
      service: 'web',
      event: options.event,
      env: cloudflareEnv,
      metadata: { ...options.metadata, scope: 'standalone' }
    },
    effect
  ).pipe(withInvocationExporters, Effect.provide(WideEventLoggerLive))
}
