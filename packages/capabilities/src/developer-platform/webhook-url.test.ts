import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { seedWorkspaceRecord } from '../seed-fixture.ts'
import { SeedLayer } from '../layers.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import { validateWebhookUrl } from './webhook-url.ts'

const seedWorkspaceLayer = Layer.merge(
  SeedLayer,
  testWorkspaceContext(seedWorkspaceRecord)
)

describe('validateWebhookUrl', () => {
  it('accepts public https URLs', () => {
    expect(validateWebhookUrl('https://example.com/hooks')).toEqual({ valid: true })
    expect(validateWebhookUrl('https://hooks.example.com:8443/hooks')).toEqual({
      valid: true
    })
    // Public IP literals are allowed; only private/loopback/link-local ranges
    // are blocked.
    expect(validateWebhookUrl('https://8.8.8.8/hooks')).toEqual({ valid: true })
  })

  it('rejects non-https and malformed URLs', () => {
    expect(validateWebhookUrl('http://example.com/hooks').valid).toBe(false)
    expect(validateWebhookUrl('wss://example.com/hooks').valid).toBe(false)
    expect(validateWebhookUrl('%%%').valid).toBe(false)
  })

  it('rejects credentials in the URL', () => {
    expect(validateWebhookUrl('https://user:pass@example.com/').valid).toBe(false)
    expect(validateWebhookUrl('https://user@example.com/').valid).toBe(false)
  })

  it('rejects private, loopback, and link-local IP literals', () => {
    for (const url of [
      'https://10.1.2.3/',
      'https://172.16.0.1/',
      'https://172.31.255.255/',
      'https://192.168.0.1/',
      'https://127.0.0.1/',
      'https://169.254.169.254/',
      'https://0.0.0.0/',
      'https://[::1]/',
      'https://[fc00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:10.0.0.1]/'
    ]) {
      // The url rides in the asserted value so a failure names the offender.
      expect({ url, valid: validateWebhookUrl(url).valid }).toEqual({
        url,
        valid: false
      })
    }
  })

  it('allows public boundary neighbours of blocked ranges', () => {
    expect(validateWebhookUrl('https://172.15.0.1/').valid).toBe(true)
    expect(validateWebhookUrl('https://172.32.0.1/').valid).toBe(true)
  })

  it('rejects localhost and single-label hostnames', () => {
    expect(validateWebhookUrl('https://localhost/').valid).toBe(false)
    expect(validateWebhookUrl('https://foo.localhost/').valid).toBe(false)
    expect(validateWebhookUrl('https://internal/').valid).toBe(false)
  })
})

describe('WebhookEndpoints.create URL validation', () => {
  function createEndpoint(url: string) {
    return Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      return yield* Effect.result(webhooks.create({ url, events: ['module.enabled'] }))
    }).pipe(Effect.provide(seedWorkspaceLayer))
  }

  it.effect('creates endpoints for valid https URLs', () =>
    Effect.gen(function* () {
      const result = yield* createEndpoint('https://example.com/hooks')
      expect(result._tag).toBe('Success')
    })
  )

  it.effect('fails with InvalidWebhookUrl for unsafe URLs', () =>
    Effect.forEach(
      ['http://example.com/hooks', 'https://10.0.0.1/hooks', 'https://localhost/hooks'],
      (url) =>
        Effect.gen(function* () {
          const result = yield* createEndpoint(url)
          expect({ url, tag: result._tag }).toEqual({ url, tag: 'Failure' })
          if (result._tag === 'Failure') {
            expect(result.failure._tag).toBe('InvalidWebhookUrl')
          }
        })
    )
  )
})
