/** Optional PostHog analytics and native Workers Logs operational signals. */
// Promise-native Worker entry adapters preserve the original operation result.
// oxlint-disable effect/noAsyncFunction, effect/noTryCatch, effect/noNewPromise, effect/noGlobals, eslint/no-console
import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'
import { diagnosticFields, diagnosticLabel } from './sanitization.ts'
import { setWideEventSink, type WideEventRecord } from './wide-event.ts'

export type ProviderGlueEnv = ProviderEnvOf<
  'POSTHOG_KEY' | 'POSTHOG_HOST' | 'ENVIRONMENT'
>
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

// The env the sink reads, pinned by `wireWideEventProviders` in the isolate.
// One binding means an in-flight emit can never observe a mix
// of two invocations' envs — it sees either the old object or the new one,
// never a half-updated view.
let wiredEnv: ProviderGlueEnv | undefined

/**
 * Point the wide-event sink at this isolate's env.
 *
 * **Call-once-per-isolate protocol:** the first call installs the sink and
 * pins the env it reads; every later call must pass the *same* env bag (the
 * normal Workers behavior — one env object per isolate). A later call with an
 * equal-by-identity env is a no-op; a different env object replaces the pinned
 * one atomically, with the caveat that an emit already in flight finishes
 * against the previous env. Callers that genuinely reconfigure vendors between
 * requests should restart the isolate instead of re-wiring mid-flight.
 */
export function wireWideEventProviders(env: ProviderGlueEnv): void {
  setWideEventSink(capturePostHogEvent)
  wiredEnv = env
}

/** Completion events support freshness queries; failure still rejects the invocation. */
export async function withCronMonitor<A>(
  monitorSlug: string,
  operation: () => Promise<A>
): Promise<A> {
  const event = { event: 'cron.check_in', monitorSlug: diagnosticLabel(monitorSlug) }
  console.log(JSON.stringify({ ...event, status: 'in_progress' }))
  try {
    const result = await operation()
    console.log(JSON.stringify({ ...event, status: 'ok' }))
    return result
  } catch (error) {
    console.error(JSON.stringify({ ...event, status: 'error' }))
    // oxlint-disable-next-line effect/noThrowStatement -- preserve the platform invocation failure
    throw error
  }
}

/** Include zero values so alert queries can observe recovery. */
export function captureOperationalSnapshot(
  values: Readonly<Record<string, number>>
): Promise<void> {
  console.log(
    JSON.stringify({ event: 'operations.snapshot', service: 'background', values })
  )
  return Promise.resolve()
}

/** Error severity feeds Workers Issues; customer content stays out of evidence. */
export function captureMonitoringSignal(
  signal: string,
  evidence: Readonly<Record<string, string | number | undefined>>
): Promise<void> {
  console.error(
    JSON.stringify({
      event: 'operations.failure',
      signal: diagnosticLabel(signal),
      evidence: diagnosticFields(evidence)
    })
  )
  return Promise.resolve()
}

/**
 * One PostHog event per wide-event scope, following PostHog's documented
 * Cloudflare Workers pattern: a fresh client per invocation, immediate flush,
 * shutdown before the invocation ends.
 */
async function capturePostHogEvent(record: WideEventRecord): Promise<void> {
  const env = wiredEnv
  if (!hasValue(env?.POSTHOG_KEY)) {
    return
  }
  const { PostHog } = await import('posthog-node')
  const host = env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST
  const client = new PostHog(env.POSTHOG_KEY, {
    host,
    // Send immediately: batched writes are async and Workers may terminate
    // before they land (PostHog's own Workers guidance).
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 3000
  })
  try {
    const properties = {
      service: diagnosticLabel(record.service),
      status: record.status,
      durationMs: record.durationMs,
      // Undefined values are dropped by JSON serialization.
      traceId: diagnosticFields({ traceId: record.traceId })['traceId'],
      environment: diagnosticLabel(env.ENVIRONMENT)
    }
    await client.captureImmediate({
      distinctId: String(
        diagnosticFields({ traceId: record.traceId })['traceId'] ?? 'anonymous'
      ),
      event: diagnosticLabel(record.event),
      properties
    })
  } finally {
    await client.shutdown()
  }
}
