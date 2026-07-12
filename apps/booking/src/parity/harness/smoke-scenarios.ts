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
  embedding: 'standalone' as const,
  viewport: { width: 375, height: 812 },
  providers: {
    email: { 'send-confirmation': { status: 'disabled' } },
    payment: { 'create-payment': { status: 'disabled' } },
    analytics: { track: { status: 'disabled' } }
  },
  network: { allow: ['http://booking.test'] },
  console: {
    // The local booking ingress does not proxy Vite's development-only HMR socket.
    allow: ["WebSocket connection to 'ws://localhost"] as readonly string[]
  }
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
    id: 'booking/group-assigned-and-any-mobile',
    journey: 'group-booking',
    viewport: { width: 320, height: 568 },
    route: '/mara-booking-studio/booking',
    fixture: {
      schemaVersion: 1,
      data: {
        merchantSlug: 'mara-booking-studio',
        bookingRequests: [
          { guest: 'Coordinator', providerPreference: 'specific' },
          { guest: 'Guest 2', providerPreference: 'any' }
        ],
        reducedMotion: true
      }
    },
    assertions: [
      'requests can be added reordered and switched by keyboard',
      'assigned and Any Provider requests retain independent selections',
      'the complete hold set is acquired atomically',
      'reduced motion and narrow viewport remain operable'
    ]
  }),
  defineScenario({
    ...base,
    id: 'booking/group-conflict-expiry-recovery-desktop',
    journey: 'group-booking',
    console: {
      allow: ['409 (Conflict)', "WebSocket connection to 'ws://localhost"]
    },
    viewport: { width: 1440, height: 900 },
    route: '/mara-booking-studio/booking',
    fixture: {
      schemaVersion: 1,
      data: {
        merchantSlug: 'mara-booking-studio',
        groupConflict: true
      }
    },
    assertions: [
      'a conflicting group acquires no holds',
      'desktop motion preserves focus and request order'
    ]
  }),
  defineScenario({
    ...base,
    id: 'booking/group-expiry-earliest-incomplete',
    journey: 'group-booking',
    viewport: { width: 390, height: 844 },
    route: '/mara-booking-studio/booking',
    fixture: {
      schemaVersion: 1,
      data: { merchantSlug: 'mara-booking-studio', expireAfterSeconds: 600 }
    },
    assertions: [
      'expiry returns to the earliest incomplete request',
      'stale holds and selections are not restored'
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
    console: {
      allow: ['503 (Service Unavailable)', "WebSocket connection to 'ws://localhost"]
    },
    journey: 'selection-error',
    route: '/mara-booking-studio/booking',
    assertions: ['localized recovery is visible']
  }),
  ...(
    [
      {
        id: 'booking/scheduling-available',
        journey: 'scheduling-available',
        assertions: [
          'available Time Slots are visible',
          'a Time Slot can be held and explicitly released'
        ]
      },
      {
        id: 'booking/scheduling-empty',
        journey: 'scheduling-empty',
        assertions: ['empty Availability has explicit recovery']
      },
      {
        id: 'booking/scheduling-loading',
        journey: 'scheduling-loading',
        assertions: ['Availability loading is visible']
      },
      {
        id: 'booking/scheduling-unavailable',
        journey: 'scheduling-unavailable',
        console: {
          allow: [
            '503 (Service Unavailable)',
            "WebSocket connection to 'ws://localhost"
          ]
        },
        assertions: ['unavailable scheduling has explicit recovery']
      },
      {
        id: 'booking/scheduling-conflict',
        journey: 'scheduling-conflict',
        console: {
          allow: ['409 (Conflict)', "WebSocket connection to 'ws://localhost"]
        },
        assertions: ['hold conflict preserves selections and offers recovery']
      },
      {
        id: 'booking/scheduling-expiry-recovery',
        journey: 'scheduling-expiry-recovery',
        assertions: ['hold expiry is clock-driven and a replacement can be selected']
      }
    ] as const
  ).map((scenario) =>
    defineScenario({
      ...base,
      ...scenario,
      route: '/mara-booking-studio/booking'
    })
  ),
  defineScenario({
    ...base,
    id: 'booking/canonical-shell-standalone-fr',
    journey: 'shell-boundary',
    locale: 'fr',
    viewport: { width: 1440, height: 900 },
    route:
      '/mara-booking-studio/booking?locale=fr&utm_source=parity&utm_campaign=shell',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'acquisition is removed',
      'canonical back and forward history is deterministic'
    ]
  }),
  defineScenario({
    ...base,
    id: 'booking/canonical-shell-widget-ro',
    journey: 'shell-boundary',
    locale: 'ro',
    embedding: 'widget',
    viewport: { width: 768, height: 900 },
    route: '/mara-booking-studio/booking?locale=ro&embed=widget&rwg_token=parity',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'embedding profile is applied',
      'acquisition is removed',
      'canonical back and forward history is deterministic'
    ]
  }),
  defineScenario({
    ...base,
    id: 'booking/canonical-shell-google-es',
    journey: 'shell-boundary',
    locale: 'es',
    embedding: 'google',
    viewport: { width: 390, height: 844 },
    route: '/mara-booking-studio/booking?locale=es&embed=google&gclid=parity',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'embedding profile is applied',
      'acquisition is removed',
      'canonical back and forward history is deterministic'
    ]
  })
])
