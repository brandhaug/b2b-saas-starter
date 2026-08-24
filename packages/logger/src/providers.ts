import { Clock, Effect, Option, Schema } from 'effect'

/**
 * Env-gated error-reporting and product-analytics providers (Sentry, PostHog),
 * as fetch-based ingestion rather than vendor SDKs — the same posture as
 * `makeOtlpLayer`: no dependency, no timers, no fibers, and nothing at all
 * when the env vars are unset (the provider-light default).
 *
 * Both providers are consumed by the wide-event scope itself (`withRequestScope`
 * reports every failed scope), so setting `SENTRY_DSN` / `POSTHOG_KEY` turns
 * them on across all three workers with one seam. Explicit product-analytics
 * events go through {@link TelemetryProviders.captureEvent}.
 *
 * Like the OTLP exporters, reports run inside the invocation's `onExit`, while
 * the Worker is still allowed to perform I/O — never from a background timer.
 * A failed report is swallowed: observability must never fail a request.
 */

/** The env fields this module reads; a worker's full env bag satisfies it. */
export type TelemetryProviderEnv = {
  readonly SENTRY_DSN?: string | undefined
  readonly POSTHOG_KEY?: string | undefined
  readonly POSTHOG_HOST?: string | undefined
}

/** The pieces of a Sentry DSN needed to POST an envelope to the store endpoint. */
type SentryTarget = {
  readonly url: string
  readonly publicKey: string
}

/**
 * Parse `https://<publicKey>@<host>/<projectId>`. `undefined` for anything
 * else — a malformed DSN disables Sentry rather than failing the worker.
 */
function parseSentryDsn(dsn: string): SentryTarget | undefined {
  const match = /^https:\/\/([^@]+)@([^/]+)\/(.+)$/.exec(dsn)
  if (match === null) return undefined
  const publicKey = match[1]
  const host = match[2]
  const projectId = match[3]
  if (!publicKey || !host || !projectId) return undefined
  return { publicKey, url: `https://${host}/api/${projectId}/store/` }
}

/**
 * The JSON envelope body Sentry's store endpoint accepts for an exception
 * event, as the scope builds it: fixed fields first, conditional ones added
 * below only when present, so no empty columns ship.
 */
type SentryEnvelope = {
  event_id: string
  timestamp: number
  platform: 'javascript'
  level: 'error'
  server_name: string
  message: string
  exception: { values: Array<{ type: string; value?: string }> }
  tags: Record<string, string>
  environment?: string
  release?: string
}

/** PostHog's `/batch/` capture payload (one event per request here). */
type ExceptionProperties = {
  $lib: string
  service?: string
  event?: string
  error_kind?: string
  message?: string
  traceId?: string
}

type PosthogEvent = {
  event: string
  distinct_id: string
  properties: ExceptionProperties
}

type PosthogBatch = {
  api_key: string
  batch: Array<PosthogEvent>
}

/** One failure of a wide-event scope, already classified by the scope. */
export type ReportedFailure = {
  readonly service: string
  /** The scope's event name (`request.health`, …) — identifies where it fired. */
  readonly event: string
  readonly message: string
  readonly kind: 'fail' | 'interrupt' | 'defect'
  /** The `x-trace-id` correlation key, so Sentry links back to the log stream. */
  readonly traceId?: string | undefined
  readonly environment?: string | undefined
  readonly commitHash?: string | undefined
}

/** An explicit product-analytics event, independent of success or failure. */
export type AnalyticsEvent = {
  readonly event: string
  /** Who did it — user id, anonymous id; PostHog groups events by this. */
  readonly distinctId: string
  readonly properties?: Record<string, unknown> | undefined
}

/**
 * The HTTP boundary, as a port so tests observe requests without a network.
 * A failed Effect means "provider unreachable" and is swallowed by callers.
 */
export type EventPoster = (
  url: string,
  headers: Record<string, string>,
  body: unknown
) => Effect.Effect<unknown, unknown>

function postWithFetch(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Effect.Effect<unknown, unknown> {
  return Effect.tryPromise({
    try: () =>
      globalThis.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        // The one serialization point of the ingestion boundary: both endpoints
        // take flat JSON documents whose shapes are fixed above, not user data.
        // oxlint-disable-next-line effect/noGlobals -- wire-format serialization for two fixed payload schemas
        body: JSON.stringify(body)
      }),
    catch: () => POST_UNREACHABLE
  })
}

export type TelemetryProviders = {
  /** Whether each provider saw a usable config — surfaced for diagnostics. */
  readonly sentryActive: boolean
  readonly posthogActive: boolean
  /**
   * Report one failed scope to Sentry and (as `$exception`) to PostHog.
   * Never fails: transport problems are swallowed, and inactive providers
   * make it a no-op.
   */
  readonly reportError: (failure: ReportedFailure) => Effect.Effect<void>
  /** Send an explicit product-analytics event to PostHog. Same contract. */
  readonly captureEvent: (event: AnalyticsEvent) => Effect.Effect<void>
}

/** Error channel marker; only ever swallowed, never surfaced to callers. */
const POST_UNREACHABLE = 'post-unreachable'

/** Shared no-op instance: unset env vars cost nothing beyond one comparison. */
const INACTIVE: TelemetryProviders = {
  sentryActive: false,
  posthogActive: false,
  reportError: () => Effect.void,
  captureEvent: () => Effect.void
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.length > 0
}

function posthogHost(config: { readonly posthogHost: string | undefined }): string {
  return (config.posthogHost ?? 'https://us.i.posthog.com').replace(/\/$/, '')
}

/**
 * Build the provider set from parsed config. Exposed for tests, which inject
 * `post` and assert on captured requests; production uses {@link telemetryProvidersFromEnv}.
 */
export function makeTelemetryProviders(
  config: {
    readonly sentry: SentryTarget | undefined
    readonly posthogKey: string | undefined
    readonly posthogHost: string | undefined
  },
  post: EventPoster = postWithFetch
): TelemetryProviders {
  function reportToSentry(
    failure: ReportedFailure,
    eventId: string
  ): Effect.Effect<void, unknown> {
    const target = config.sentry
    if (!target) return Effect.void
    return Effect.gen(function* () {
      const timestamp = yield* Clock.currentTimeMillis
      const envelope: SentryEnvelope = {
        event_id: eventId,
        timestamp: timestamp / 1000,
        platform: 'javascript',
        level: 'error',
        server_name: failure.service,
        message: `[${failure.event}] ${failure.message}`,
        exception: { values: [{ type: failure.kind, value: failure.message }] },
        tags: { service: failure.service, event: failure.event }
      }
      if (failure.traceId) envelope.tags.traceId = failure.traceId
      if (failure.environment) envelope.environment = failure.environment
      if (failure.commitHash) envelope.release = failure.commitHash
      yield* post(
        `${target.url}?sentry_version=7&sentry_key=${target.publicKey}`,
        {},
        envelope
      )
    })
  }

  function reportToPosthog(failure: ReportedFailure): Effect.Effect<void, unknown> {
    const apiKey = config.posthogKey
    if (!apiKey) return Effect.void
    const record: PosthogEvent = {
      event: '$exception',
      distinct_id: failure.service,
      properties: {
        $lib: 'b2b-saas-starter',
        service: failure.service,
        event: failure.event,
        error_kind: failure.kind,
        message: failure.message
      }
    }
    // Assigned only when present, so the payload carries no empty column.
    if (failure.traceId) record.properties.traceId = failure.traceId
    const batch: PosthogBatch = { api_key: apiKey, batch: [record] }
    return post(`${posthogHost(config)}/batch/`, {}, batch)
  }

  function reportError(failure: ReportedFailure): Effect.Effect<void> {
    const eventId = globalThis.crypto.randomUUID().replaceAll('-', '')
    return Effect.ignore(
      Effect.gen(function* () {
        yield* reportToSentry(failure, eventId)
        yield* reportToPosthog(failure)
      })
    )
  }

  function captureEvent(event: AnalyticsEvent): Effect.Effect<void> {
    const apiKey = config.posthogKey
    if (!apiKey) return Effect.void
    const batch: PosthogBatch = {
      api_key: apiKey,
      batch: [
        {
          event: event.event,
          distinct_id: event.distinctId,
          properties: { $lib: 'b2b-saas-starter', ...event.properties }
        }
      ]
    }
    return Effect.ignore(post(`${posthogHost(config)}/batch/`, {}, batch))
  }

  return {
    sentryActive: config.sentry !== undefined,
    posthogActive: hasValue(config.posthogKey),
    reportError,
    captureEvent
  }
}

/**
 * The provider set for a worker env bag. Unset vars produce the shared no-op:
 * no SDK loaded, no state, no network — the app runs exactly as it would
 * without this module.
 */
export function telemetryProvidersFromEnv(
  env: TelemetryProviderEnv | undefined,
  post: EventPoster = postWithFetch
): TelemetryProviders {
  const dsn = ownString(env, 'SENTRY_DSN')
  const posthogKey = ownString(env, 'POSTHOG_KEY')
  if (dsn === undefined && posthogKey === undefined) return INACTIVE
  let sentry: SentryTarget | undefined = undefined
  if (dsn !== undefined) sentry = parseSentryDsn(dsn)
  return makeTelemetryProviders(
    { sentry, posthogKey, posthogHost: ownString(env, 'POSTHOG_HOST') },
    post
  )
}

/** Non-empty own string property, absent keys collapsing to `undefined`. */
const decodeString = Schema.decodeUnknownOption(Schema.String)

function ownString(source: object | undefined, key: string): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(source ?? {}, key)?.value
  const decoded = decodeString(value)
  if (Option.isNone(decoded) || decoded.value.length === 0) return undefined
  return decoded.value
}
