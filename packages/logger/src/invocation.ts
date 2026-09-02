import { Effect, type Scope } from 'effect'

import { makeOtlpLayer, type ObservabilityEnv } from './otlp.ts'
import { withHttpRequestScope } from './wide-event.ts'

/**
 * One HTTP-triggered worker invocation: the wide-event scope *and* the
 * exporters that must live and die with it.
 *
 * The two halves are one recipe, not two choices. `withHttpRequestScope`
 * cannot be provided a per-isolate OTLP layer (invariant 4 — a Worker may not
 * flush on behalf of an invocation that already ended), and `makeOtlpLayer`
 * must build *inside* the isolate-level loggers so `loggerMergeWithExisting`
 * keeps the console JSON event. Writing both at every entry point is how the
 * two drift; writing them here is how they cannot.
 *
 * What the caller still owns is what genuinely differs between workers: which
 * loggers are in context (a module-scope `ManagedRuntime` in `apps/web`, the
 * router layer in `apps/api`) and what the body does inside the scope.
 *
 * Queue and cron triggers do **not** come through here. They have no `Request`
 * to continue a trace from, and — in `apps/background` — one invocation
 * carries a whole batch, so its exporters wrap N wide-event scopes rather than
 * one. That path stays on `withTriggerScope` plus its own per-invocation
 * runner.
 */
export type HttpInvocationOptions = {
  readonly service: string
  readonly event: string
  readonly request: Request
  /**
   * The worker env, read twice: for the wide event's deployment identity and
   * for the OTLP endpoint. Required here — an invocation with no env has no
   * exporter to build.
   */
  readonly env: ObservabilityEnv & object
  readonly metadata?: Record<string, unknown> | undefined
}

export function withHttpInvocation<A, E, R>(
  options: HttpInvocationOptions,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return withHttpRequestScope(options, body).pipe(
    // `local: true` forces a fresh build per invocation: a shared memo map
    // would hand every later request the first request's exporters, which are
    // no longer allowed to perform I/O (see `makeOtlpLayer`).
    Effect.provide(makeOtlpLayer(options.service, options.env), { local: true })
  )
}
