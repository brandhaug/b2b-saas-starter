import { defineScenario } from './scenario-manifest.ts'

const base = {
  schemaVersion: 1 as const,
  fixture: {
    schemaVersion: 1 as const,
    data: {
      merchantSlug: 'mara-booking-studio',
      appointments: [],
      availableSlots: ['2026-02-16T11:00:00.000Z']
    }
  },
  clock: { instant: '2026-07-10T09:30:00.000Z', timezone: 'UTC' },
  locale: 'en' as const,
  viewport: { width: 375, height: 812 },
  providers: {
    email: { 'send-confirmation': { status: 'disabled' } },
    payment: { 'create-payment': { status: 'disabled' } },
    analytics: { track: { status: 'disabled' } }
  },
  network: { allow: ['http://booking.test'] },
  console: { allow: [] as readonly string[] }
}

export const smokeScenarios = await Promise.all([
  defineScenario({
    ...base,
    id: 'booking/pay-in-person-smoke',
    journey: 'pay-in-person',
    route: '/mara-booking-studio/booking',
    assertions: [
      'booking shell is visible',
      'direct Session link hydrates without losing intent',
      'long copy reflows without horizontal overflow',
      '200 percent zoom remains operable',
      'compact viewport content remains reachable',
      'keyboard focus is visible',
      'pointer activation works'
    ]
  }),
  defineScenario({
    ...base,
    id: 'booking/deliberate-blank',
    journey: 'deliberate-blank',
    route: '/mara-booking-studio/booking',
    assertions: ['deliberate blank state has no customer-visible content']
  }),
  defineScenario({
    ...base,
    id: 'booking/deliberate-loading',
    journey: 'selection-loading',
    route: '/mara-booking-studio/booking',
    assertions: ['loading state is visible']
  }),
  defineScenario({
    ...base,
    id: 'booking/deliberate-error',
    console: { allow: ['503 (Service Unavailable)'] },
    journey: 'selection-error',
    route: '/mara-booking-studio/booking',
    assertions: ['localized recovery is visible']
  })
])
