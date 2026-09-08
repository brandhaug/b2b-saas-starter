/**
 * Vendor provider glue for the wide-event seam: Sentry (`@sentry/cloudflare`)
 * for failed scopes, PostHog (`posthog-node`, the officially documented
 * Cloudflare Workers integration) for analytics. Both stay fully inactive
 * until their env vars exist — no DSN/key means no network traffic, matching
 * the starter's provider-light promise (see ARCHITECTURE.md secret matrix).
 *
 * Workers wire two pieces:
 *
 * 1. **Init** — `makeSentryOptions(service, env)` feeds `Sentry.withSentry` at
 *    the worker entry. Without `SENTRY_DSN` it returns empty options and the
 *    SDK initializes a disabled client.
 * 2. **Wide-event sinks** — `wireWideEventProviders(env)` (call once per
 *    isolate, at worker init) connects the scope's exit event
 *    to both vendors. Failed scopes become Sentry exceptions tagged with the
 *    service/event/trace id; every scope becomes one PostHog event keyed by
 *    the trace id.
 *
 * Like `makeOtlpLayer`, the PostHog half respects ADR 0050: a fresh client
 * per invocation with `flushAt: 1` / `flushInterval: 0`, awaited inside the
 * invocation so no I/O outlives the request that produced it. Both SDKs are
 * imported lazily: this module is reachable from the web app's client graph
 * (through observability.ts), and vendor code has no business in the browser
 * bundle.
 */
// The vendor SDKs are Promise-native; wrapping their calls in Effect would
// only re-wrap the same awaits one layer down.
// oxlint-disable effect/noAsyncFunction, effect/noTryCatch, effect/noNewPromise
import { type CloudflareOptions } from '@sentry/cloudflare'

import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'

import {
  diagnosticFields,
  diagnosticLabel,
  sentryPrivacyOptions
} from './sanitization.ts'

import { addWideEventSink, type WideEventRecord } from './wide-event.ts'

/** Env fields the vendor glue reads. All optional; absence disables the vendor. */
export type ProviderGlueEnv = ProviderEnvOf<
  | 'SENTRY_DSN'
  | 'POSTHOG_KEY'
  | 'POSTHOG_HOST'
  | 'SERVICE_VERSION'
  | 'GIT_COMMIT_SHA'
  | 'ENVIRONMENT'
>

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

/**
 * Options for `Sentry.withSentry` at a worker entry. Without `SENTRY_DSN` the
 * returned options initialize a disabled SDK — no transport, no network — so
 * the same wrapper serves configured and provider-light deployments.
 */
export function makeSentryOptions(
  service: string,
  env: ProviderGlueEnv
): CloudflareOptions {
  const release = env.SERVICE_VERSION ?? env.GIT_COMMIT_SHA
  const options: CloudflareOptions = {
    initialScope: { tags: { service } },
    ...sentryPrivacyOptions
  }
  if (hasValue(env.SENTRY_DSN)) {
    options.dsn = env.SENTRY_DSN
  }
  if (release) {
    options.release = release
  }
  if (env.ENVIRONMENT) {
    options.environment = env.ENVIRONMENT
  }
  return options
}

// The env the sinks read, pinned by the first `wireWideEventProviders` call
// in the isolate. One binding means an in-flight emit can never observe a mix
// of two invocations' envs — it sees either the old object or the new one,
// never a half-updated view.
let wiredEnv: ProviderGlueEnv | undefined

/**
 * Point the wide-event sinks at this isolate's env.
 *
 * **Call-once-per-isolate protocol:** the first call registers the sinks and
 * pins the env they read; every later call must pass the *same* env bag (the
 * normal Workers behavior — one env object per isolate). A later call with an
 * equal-by-identity env is a no-op; a different env object replaces the pinned
 * one atomically, with the caveat that an emit already in flight finishes
 * against the previous env. Callers that genuinely reconfigure vendors between
 * requests should restart the isolate instead of re-wiring mid-flight.
 */
export function wireWideEventProviders(env: ProviderGlueEnv): void {
  if (wiredEnv === undefined) {
    addWideEventSink((record) => dispatch(record))
  }
  wiredEnv = env
}

/**
 * Sends a Sentry cron check-in around a scheduled invocation. Sentry remains
 * optional: without an initialized client this is exactly the supplied
 * operation, so local development never needs monitoring credentials.
 */
export async function withCronMonitor<A>(
  monitorSlug: string,
  operation: () => Promise<A>
): Promise<A> {
  const Sentry = await import('@sentry/cloudflare')
  if (!Sentry.isEnabled()) {
    return operation()
  }
  const checkInId = Sentry.captureCheckIn({ monitorSlug, status: 'in_progress' })
  try {
    const result = await operation()
    Sentry.captureCheckIn({ monitorSlug, status: 'ok', checkInId })
    return result
  } catch (error) {
    Sentry.captureCheckIn({ monitorSlug, status: 'error', checkInId })
    // oxlint-disable-next-line effect/noThrowStatement -- preserve the worker invocation failure for Sentry and the platform scheduler
    throw error
  }
}

/** Low-cardinality gauges include zero so Sentry metric monitors can recover. */
export async function captureOperationalSnapshot(
  values: Readonly<Record<string, number>>
): Promise<void> {
  const Sentry = await import('@sentry/cloudflare')
  if (!Sentry.isEnabled()) {
    return
  }
  for (const [name, value] of Object.entries(values)) {
    Sentry.metrics.gauge(name, value, { attributes: { service: 'background' } })
  }
}

/** Count actual HTTP outcomes, including handled 5xx responses. */
export async function withHttpMonitor(
  service: string,
  operation: () => Promise<Response>
): Promise<Response> {
  const Sentry = await import('@sentry/cloudflare')
  if (!Sentry.isEnabled()) {
    return operation()
  }
  let serverError = true
  try {
    const response = await operation()
    serverError = response.status >= 500
    return response
  } finally {
    Sentry.metrics.count('http.requests', 1, {
      attributes: { service, server_error: serverError }
    })
  }
}

/** IDs belong in event context, never in metric dimensions or fingerprints. */
export async function captureMonitoringSignal(
  signal: string,
  evidence: Readonly<Record<string, string | number | undefined>>
): Promise<void> {
  const Sentry = await import('@sentry/cloudflare')
  if (!Sentry.isEnabled()) {
    return
  }
  Sentry.captureMessage(signal, {
    level: 'error',
    fingerprint: ['operations', signal],
    tags: { signal },
    extra: diagnosticFields(evidence)
  })
  Sentry.metrics.count('operations.failures', 1, { attributes: { signal } })
}

/** Never rejects: a vendor outage must not fail the request being reported. */
async function dispatch(record: WideEventRecord): Promise<void> {
  await Promise.allSettled([captureSentryError(record), capturePostHogEvent(record)])
}

async function captureSentryError(record: WideEventRecord): Promise<void> {
  // Interrupts are not errors, and without an initialized client there is
  // nothing to send to — both leave this sink silent.
  if (record.status !== 'error' || record.errorKind === 'interrupt') {
    return
  }
  const sentry = await import('@sentry/cloudflare')
  if (sentry.getClient() === undefined) {
    return
  }

  // SDK enrichment is filtered again by beforeSend. Never hand the vendor
  // a raw provider exception or its nested customer/request data.
  // oxlint-disable-next-line effect/noNewError -- a scrubbed vendor exception, not an application failure
  const exception = new Error('Application failure')
  exception.name = diagnosticLabel(record.errorTag ?? record.errorKind)
  // Undefined tag values are dropped by Sentry's payload serializer, so the
  // optional fields are simply passed through.
  sentry.captureException(exception, {
    tags: {
      service: diagnosticLabel(record.service),
      event: diagnosticLabel(record.event),
      errorKind: record.errorKind,
      errorTag: diagnosticLabel(record.errorTag)
    },
    // Joins the Sentry issue back to the OTel trace the wide event opened.
    contexts: {
      trace: { trace_id: record.traceId, span_id: record.spanId }
    }
  })
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
