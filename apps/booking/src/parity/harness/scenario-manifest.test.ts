import { describe, expect, it } from 'vitest'
import {
  defineScenario,
  fixtureBundleIdentity,
  parseScenarioManifest
} from './scenario-manifest.ts'

const validScenario = {
  schemaVersion: 1,
  id: 'booking/pay-in-person-smoke',
  journey: 'pay-in-person',
  fixture: {
    schemaVersion: 1,
    data: { merchantSlug: 'acme', availability: ['2026-02-16T11:00:00.000Z'] }
  },
  clock: { instant: '2026-02-16T10:00:00.000Z', timezone: 'UTC' },
  route: '/acme/booking',
  locale: 'en',
  embedding: 'standalone',
  viewport: { width: 375, height: 812 },
  providers: {},
  network: { allow: ['http://booking.test'] },
  assertions: ['booking shell is visible'],
  console: { allow: [] }
} as const

describe('scenario manifest contract', () => {
  it('defines a versioned scenario with a content-addressed fixture', async () => {
    const scenario = await defineScenario(validScenario)

    expect(scenario.fixtureIdentity).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(scenario.fixtureIdentity).toBe(
      await fixtureBundleIdentity(validScenario.fixture)
    )
  })

  it('rejects invalid clocks, routes, and undeclared fixture fields', async () => {
    await expect(
      parseScenarioManifest({
        ...validScenario,
        route: 'https://example.com/acme',
        clock: { instant: 'not-a-date', timezone: '' },
        fixture: { ...validScenario.fixture, surprise: true }
      })
    ).rejects.toThrow(/invalid scenario manifest/i)
  })
})
