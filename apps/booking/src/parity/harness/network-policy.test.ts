import { describe, expect, it } from 'vitest'
import { createNetworkPolicy } from './network-policy.ts'

describe('scenario network boundary', () => {
  it('fails undeclared requests while allowing declared origins and local assets', () => {
    const policy = createNetworkPolicy({
      allow: ['http://booking.test'],
      localAssetOrigin: 'http://assets.booking.test'
    })

    expect(() => policy.assertAllowed('http://booking.test/acme/booking')).not.toThrow()
    expect(() =>
      policy.assertAllowed('http://assets.booking.test/sha256/a')
    ).not.toThrow()
    expect(() => policy.assertAllowed('https://analytics.example/events')).toThrow(
      /undeclared network request/i
    )
    expect(policy.requests()).toHaveLength(3)
  })
})
