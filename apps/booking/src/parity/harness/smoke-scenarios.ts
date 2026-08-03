import { defineScenario } from './scenario-manifest.ts'
import {
  scenarioPresentationFor,
  visualParityMotion,
  visualParityProfiles
} from '../visual-parity-contract.ts'

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
  viewport: visualParityProfiles['mobile-narrow-375x812'].host,
  input: 'touch' as const,
  motion: {
    policy: 'finish-and-freeze' as const,
    checkpoints: [visualParityMotion.pageMs] as readonly number[]
  },
  visual: { mode: 'exact' as const, masks: [] as const },
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

const shellScenario = (profile: Parameters<typeof scenarioPresentationFor>[0]) => {
  const presentation = scenarioPresentationFor(profile)
  return {
    viewport: presentation.viewport,
    input: presentation.input,
    embedding: presentation.embedding,
    fixture: {
      ...base.fixture,
      data: { ...base.fixture.data, ...presentation.fixtureData }
    }
  }
}

export const smokeScenarios = await Promise.all([
  defineScenario({
    ...base,
    id: 'booking/cancellation-refund',
    journey: 'cancellation-refund',
    route: '/mara-booking-studio/booking',
    assertions: [
      'protected confirmation offers an explicit individual cancellation',
      'cancellation commits while provider-free refund work remains optional',
      'the cancelled Appointment is visible after the command',
      'no sibling Appointment is changed implicitly',
      'no undeclared network request is made'
    ]
  }),
  ...(['en', 'es', 'fr', 'ro'] as const).map((locale) =>
    defineScenario({
      ...base,
      id:
        locale === 'en'
          ? 'booking/pay-in-person-smoke'
          : `booking/pay-in-person-smoke-${locale}`,
      journey: 'pay-in-person',
      locale,
      route: '/mara-booking-studio/booking',
      assertions: [
        'booking shell is visible',
        'provider-free Pay In Person confirms without optional providers',
        'confirmation token exchanges into protected token-free access',
        'confirmation and recovery copy use the selected locale',
        'direct Session link hydrates without losing intent',
        'long copy reflows without horizontal overflow',
        '200 percent zoom remains operable',
        'compact viewport content remains reachable',
        'keyboard focus is visible',
        'pointer activation works'
      ]
    })
  ),
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
    ...shellScenario('desktop-1440x900'),
    id: 'booking/canonical-shell-standalone-fr',
    journey: 'shell-boundary',
    locale: 'fr',
    motion: {
      policy: visualParityMotion.choreographyPolicy,
      checkpoints: [0, visualParityMotion.interactionMs, visualParityMotion.pageMs]
    },
    route:
      '/mara-booking-studio/booking?locale=fr&utm_source=parity&utm_campaign=shell',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'acquisition is removed',
      'canonical back and forward history is deterministic'
    ]
  }),
  ...(['en', 'es', 'fr', 'ro'] as const).map((locale) =>
    defineScenario({
      ...base,
      ...shellScenario('mobile-narrow-375x812'),
      id: `booking/canonical-shell-mobile-narrow-${locale}`,
      journey: 'shell-boundary',
      locale,
      route: `/mara-booking-studio/booking?locale=${locale}`,
      assertions: [
        'booking shell is visible',
        'session locale is persisted',
        'profile preserves the 375 pixel content cap and scroll ownership',
        'canonical back and forward history is deterministic'
      ]
    })
  ),
  defineScenario({
    ...base,
    ...shellScenario('mobile-wide-376x812'),
    id: 'booking/canonical-shell-mobile-wide-en',
    journey: 'shell-boundary',
    route: '/mara-booking-studio/booking?locale=en',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'profile preserves the 375 pixel content cap and scroll ownership',
      'canonical back and forward history is deterministic'
    ]
  }),
  defineScenario({
    ...base,
    ...shellScenario('laptop-1024x768'),
    id: 'booking/canonical-shell-laptop-en',
    journey: 'shell-boundary',
    route: '/mara-booking-studio/booking?locale=en',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'profile preserves the 375 pixel content cap and scroll ownership',
      'canonical back and forward history is deterministic'
    ]
  }),
  defineScenario({
    ...base,
    ...shellScenario('zoom-200'),
    id: 'booking/canonical-shell-zoom-200-en',
    journey: 'shell-boundary',
    route: '/mara-booking-studio/booking?locale=en',
    assertions: [
      'booking shell is visible',
      'session locale is persisted',
      'profile preserves the 375 pixel content cap and scroll ownership',
      'canonical back and forward history is deterministic'
    ]
  }),
  defineScenario({
    ...base,
    ...shellScenario('tablet-widget-768x900-iframe-375x700'),
    id: 'booking/canonical-shell-widget-ro',
    journey: 'shell-boundary',
    locale: 'ro',
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
  }),
  defineScenario({
    ...base,
    id: 'booking/pricing-allocation-and-promotion',
    journey: 'pricing-quote',
    route: '/mara-booking-studio/booking',
    assertions: [
      'the complete Booking Party has one immutable single-currency quote',
      'discount tax fee and tip adjustments preserve minor-unit arithmetic',
      'limited Promotion use is reserved by the server',
      'acceptance binds the exact party holds policies and tender reservations'
    ]
  }),
  ...(['en', 'es', 'fr', 'ro'] as const).map((locale) =>
    defineScenario({
      ...base,
      id: `booking/quote-recovery-${locale}`,
      journey: 'quote-expired',
      locale,
      route: `/mara-booking-studio/booking?locale=${locale}`,
      assertions: [
        'expired stale and superseded quotes have stable localized recovery',
        'locale switching does not change monetary facts'
      ]
    })
  )
])
