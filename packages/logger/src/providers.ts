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
 * 2. **Wide-event sinks** — `wireWireEventProviders(env)` (call once per
 *    invocation, at the top of each handler) connects the scope's exit event
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
import { Option, Schema } from 'effect'

import { addWideEventSink, type WideEventRecord } from './index.ts'

/** Env fields the vendor glue reads. All optional; absence disables the vendor. */
export type ProviderGlueEnv = {
  readonly SENTRY_DSN?: string | undefined
  readonly POSTHOG_KEY?: string | undefined
  readonly POSTHOG_HOST?: string | undefined
  readonly SERVICE_VERSION?: string | undefined
  readonly GIT_COMMIT_SHA?: string | undefined
  readonly ENVIRONMENT?: string | undefined
}

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

const decodeTag = Schema.decodeUnknownOption(Schema.String)

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
    tracesSampleRate: 1
  }
  if (env.SENTRY_DSN) options.dsn = env.SENTRY_DSN
  if (release) options.release = release
  if (env.ENVIRONMENT) options.environment = env.ENVIRONMENT
  return options
}

let currentEnv: ProviderGlueEnv | undefined
let wired = false

/**
 * Point the wide-event sinks at this invocation's env. Cheap enough to call at
 * the top of every handler: the first call registers the sinks, every later
 * one refreshes the env the sinks read (per-invocation activation, so a
 * binding added between requests takes effect without an isolate restart).
 */
export function wireWideEventProviders(env: ProviderGlueEnv): void {
  currentEnv = env
  if (wired) return
  wired = true
  addWideEventSink((record) => dispatch(record))
}

/** Never rejects: a vendor outage must not fail the request being reported. */
async function dispatch(record: WideEventRecord): Promise<void> {
  await Promise.allSettled([captureSentryError(record), capturePostHogEvent(record)])
}

async function captureSentryError(record: WideEventRecord): Promise<void> {
  // Interrupts are not errors, and without an initialized client there is
  // nothing to send to — both leave this sink silent.
  if (record.status !== 'error' || record.errorKind === 'interrupt') return
  const Sentry = await import('@sentry/cloudflare')
  if (Sentry.getClient() === undefined) return

  // The raw failure value keeps its stack when it is an Error; Sentry
  // serializes anything else. Interrupt-only scopes never reach this point.
  const exception = record.error ?? `${record.service} failed ${record.event}`
  // Undefined tag values are dropped by Sentry's payload serializer, so the
  // optional fields are simply passed through.
  Sentry.captureException(exception, {
    tags: {
      service: record.service,
      event: record.event,
      errorKind: record.errorKind,
      errorTag: Option.getOrUndefined(decodeTag(record.errorTag))
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
  const env = currentEnv
  if (env?.POSTHOG_KEY === undefined || env.POSTHOG_KEY.length === 0) return
  const { PostHog } = await import('posthog-node')
  let host = DEFAULT_POSTHOG_HOST
  if (env.POSTHOG_HOST !== undefined && env.POSTHOG_HOST.length > 0) {
    host = env.POSTHOG_HOST
  }
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
      service: record.service,
      status: record.status,
      durationMs: record.durationMs,
      // Undefined values are dropped by JSON serialization.
      traceId: record.traceId,
      environment: env.ENVIRONMENT
    }
    await client.captureImmediate({
      distinctId: record.traceId,
      event: record.event,
      properties
    })
  } finally {
    await client.shutdown()
  }
}
