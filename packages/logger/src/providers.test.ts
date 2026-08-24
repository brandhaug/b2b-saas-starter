import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  makeTelemetryProviders,
  telemetryProvidersFromEnv,
  type EventPoster
} from './providers.ts'

/** One recorded POST: the URL, headers, and decoded body a provider sent. */
type CapturedRequest = {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

/** An EventPoster that records every request instead of using the network. */
function recorder() {
  const requests: Array<CapturedRequest> = []
  function post(url: string, headers: Record<string, string>, body: unknown) {
    return Effect.sync(() => {
      requests.push({ url, headers, body })
      return 'ok'
    })
  }
  return { post, requests }
}

/** An EventPoster whose transport is down. */
function brokenPost(): EventPoster {
  return () => Effect.fail('post-unreachable')
}

const DSN = 'https://examplePublicKey@o123.ingest.sentry.io/4567'

describe('telemetryProvidersFromEnv', () => {
  it.effect('is inert with no provider vars', () => {
    return Effect.gen(function* () {
      expect(telemetryProvidersFromEnv(undefined)).toBe(telemetryProvidersFromEnv({}))
      const providers = telemetryProvidersFromEnv({})
      expect(providers.sentryActive).toBe(false)
      expect(providers.posthogActive).toBe(false)
      // Inert means a failed scope still reports cleanly into the void.
      yield* providers.reportError({
        service: 'api',
        event: 'request.health',
        message: 'boom',
        kind: 'fail'
      })
    })
  })

  it.effect('reports a failure as a Sentry envelope and a PostHog $exception', () => {
    const { post, requests } = recorder()
    return Effect.gen(function* () {
      const providers = telemetryProvidersFromEnv(
        {
          SENTRY_DSN: DSN,
          POSTHOG_KEY: 'phc_test',
          POSTHOG_HOST: 'https://us.i.posthog.com/'
        },
        post
      )
      expect(providers.sentryActive).toBe(true)
      expect(providers.posthogActive).toBe(true)
      yield* providers.reportError({
        service: 'api',
        event: 'request.tokens',
        message: 'd1 unavailable',
        kind: 'defect',
        traceId: 'trace-1',
        environment: 'production',
        commitHash: 'abc123'
      })
      expect(requests).toHaveLength(2)
      const sentry = requests[0]
      const posthog = requests[1]
      expect(sentry?.url).toBe(
        'https://o123.ingest.sentry.io/api/4567/store/?sentry_version=7&sentry_key=examplePublicKey'
      )
      expect(sentry?.body).toMatchObject({
        platform: 'javascript',
        level: 'error',
        server_name: 'api',
        message: '[request.tokens] d1 unavailable',
        environment: 'production',
        release: 'abc123',
        exception: { values: [{ type: 'defect', value: 'd1 unavailable' }] },
        tags: { service: 'api', event: 'request.tokens', traceId: 'trace-1' }
      })
      expect(posthog?.url).toBe('https://us.i.posthog.com/batch/')
      expect(posthog?.body).toMatchObject({
        api_key: 'phc_test',
        batch: [
          {
            event: '$exception',
            distinct_id: 'api',
            properties: {
              service: 'api',
              error_kind: 'defect',
              message: 'd1 unavailable'
            }
          }
        ]
      })
    })
  })

  it.effect('a malformed DSN disables Sentry without failing anything', () => {
    const { post, requests } = recorder()
    return Effect.gen(function* () {
      const providers = telemetryProvidersFromEnv(
        { SENTRY_DSN: 'not-a-dsn', POSTHOG_KEY: 'phc_test' },
        post
      )
      expect(providers.sentryActive).toBe(false)
      expect(providers.posthogActive).toBe(true)
      yield* providers.reportError({
        service: 'web',
        event: 'web.request',
        message: 'boom',
        kind: 'fail'
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe('https://us.i.posthog.com/batch/')
    })
  })

  it.effect('transport failures are swallowed', () => {
    const post = brokenPost()
    return Effect.gen(function* () {
      const providers = makeTelemetryProviders(
        { sentry: undefined, posthogKey: 'phc_test', posthogHost: undefined },
        post
      )
      yield* providers.captureEvent({
        event: 'workspace.created',
        distinctId: 'user_1'
      })
      yield* providers.reportError({
        service: 'background',
        event: 'stripe_webhook',
        message: 'boom',
        kind: 'fail'
      })
    })
  })

  it.effect('captureEvent posts an analytics batch to PostHog only', () => {
    const { post, requests } = recorder()
    return Effect.gen(function* () {
      const providers = telemetryProvidersFromEnv(
        { SENTRY_DSN: DSN, POSTHOG_KEY: 'phc_test' },
        post
      )
      yield* providers.captureEvent({
        event: 'workspace.created',
        distinctId: 'user_1',
        properties: { plan: 'team' }
      })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.body).toEqual({
        api_key: 'phc_test',
        batch: [
          {
            event: 'workspace.created',
            distinct_id: 'user_1',
            properties: { $lib: 'b2b-saas-starter', plan: 'team' }
          }
        ]
      })
    })
  })

  it.effect('captureEvent is a no-op without a PostHog key', () => {
    const { post, requests } = recorder()
    return Effect.gen(function* () {
      const providers = telemetryProvidersFromEnv({ SENTRY_DSN: DSN }, post)
      yield* providers.captureEvent({
        event: 'workspace.created',
        distinctId: 'user_1'
      })
      expect(requests).toHaveLength(0)
    })
  })
})
