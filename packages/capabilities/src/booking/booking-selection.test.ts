import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { hashSha256 } from '../internal/crypto.ts'
import type { BookingSession } from './booking-sessions.ts'
import {
  BookingSelection,
  emptySeedBookingSelectionStore,
  SeedBookingSelection,
  seedBookingSelectionEligibilityKey
} from './booking-selection.ts'

const session: BookingSession = {
  id: 'bsn_test',
  merchantSlug: 'mara-studio',
  checkoutPath: 'pay_in_person',
  lifecycle: 'active',
  createdAt: '2026-07-10T10:00:00.000Z',
  lastActivityAt: '2026-07-10T10:00:00.000Z',
  idleExpiresAt: '2026-07-10T10:30:00.000Z',
  absoluteExpiresAt: '2026-07-10T12:00:00.000Z'
}

const fixture = (presentation: 'solo' = 'solo') => {
  const store = emptySeedBookingSelectionStore({
    merchants: [{ id: 'mer_mara', slug: 'mara-studio', presentation }],
    shops: [
      {
        id: 'shp_mer_mara',
        merchantId: 'mer_mara',
        brandId: 'brd_mara',
        slug: 'mara-studio',
        publicName: 'Mara Studio',
        alias: 'Downtown',
        coverPhotoUrl: 'https://images.example.test/mara-cover.jpg',
        brandName: 'Mara Studio',
        timezone: 'UTC'
      }
    ],
    providers: [
      {
        id: 'prv_ava',
        merchantId: 'mer_mara',
        displayName: 'Ava S.',
        isDefault: true,
        status: 'active'
      },
      {
        id: 'prv_noah',
        merchantId: 'mer_mara',
        displayName: 'Noah B.',
        isDefault: false,
        status: 'active'
      },
      {
        id: 'prv_restricted',
        merchantId: 'mer_mara',
        displayName: 'Private Pro',
        isDefault: false,
        status: 'active',
        bookingAccess: 'restricted'
      },
      {
        id: 'prv_hidden',
        merchantId: 'mer_other',
        displayName: 'Hidden',
        isDefault: true,
        status: 'active'
      }
    ],
    services: [
      {
        id: 'svc_cut',
        merchantId: 'mer_mara',
        name: 'Signature Cut',
        category: 'Haircuts',
        priceMinor: 4500,
        currency: 'USD',
        durationMinutes: 45,
        status: 'active'
      },
      {
        id: 'svc_beard',
        merchantId: 'mer_mara',
        name: 'Beard Trim',
        category: 'Grooming',
        priceMinor: 2800,
        currency: 'USD',
        durationMinutes: 30,
        status: 'active'
      },
      {
        id: 'svc_eur',
        merchantId: 'mer_mara',
        name: 'Euro Service',
        category: null,
        priceMinor: 2000,
        currency: 'EUR',
        durationMinutes: 20,
        status: 'active'
      },
      {
        id: 'svc_inactive',
        merchantId: 'mer_mara',
        name: 'Hidden Service',
        category: null,
        priceMinor: 1000,
        currency: 'USD',
        durationMinutes: 10,
        status: 'inactive'
      },
      {
        id: 'svc_other',
        merchantId: 'mer_other',
        name: 'Private Service',
        category: null,
        priceMinor: 1000,
        currency: 'USD',
        durationMinutes: 10,
        status: 'active'
      }
    ],
    eligibility: [
      ['mer_mara', 'prv_ava', 'svc_cut'],
      ['mer_mara', 'prv_ava', 'svc_beard'],
      ['mer_mara', 'prv_ava', 'svc_eur'],
      ['mer_mara', 'prv_noah', 'svc_cut'],
      ['mer_mara', 'prv_restricted', 'svc_cut']
    ].map(([merchantId, providerId, serviceId]) =>
      seedBookingSelectionEligibilityKey({
        merchantId: merchantId!,
        providerId: providerId!,
        serviceId: serviceId!
      })
    ),
    scheduleRules: [
      {
        id: 'sch_ava_saturday',
        merchantId: 'mer_mara',
        providerId: 'prv_ava',
        weekday: 6,
        startTime: '09:00',
        endTime: '10:00'
      }
    ],
    canSellUnassignedGiftCard: true
  })
  const layer = SeedBookingSelection(store)
  const run = <A, E>(effect: Effect.Effect<A, E, BookingSelection>) =>
    Effect.runPromise(Effect.provide(effect, layer))
  return { store, run }
}

describe('Booking Selection', () => {
  it('derives professional availability and unassigned gift-card eligibility from catalog facts', async () => {
    const { run } = fixture()
    const loaded = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )

    expect(loaded.canSellUnassignedGiftCard).toBe(true)
    expect(loaded.shops[0]?.timezone).toBe('UTC')
    expect(loaded.shops[0]).toMatchObject({
      alias: 'Downtown',
      coverPhotoUrl: 'https://images.example.test/mara-cover.jpg'
    })
    expect(
      loaded.providers.find((provider) => provider.id === 'prv_ava')?.nextAvailableAt
    ).toBe('2026-07-11T09:00:00.000Z')
  })

  it('exposes an authoritative legacy provider short name for compound names', async () => {
    const { store, run } = fixture()
    store.providers.set('prv_ava', {
      ...store.providers.get('prv_ava')!,
      displayName: 'Maria de la Cruz',
      bookingConfiguration: { shortName: 'Maria d.' }
    })

    const loaded = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )

    expect(
      loaded.providers.find((provider) => provider.id === 'prv_ava')
    ).toMatchObject({
      displayName: 'Maria de la Cruz',
      shortName: 'Maria d.'
    })
  })

  it('distinguishes inactive catalog facts from invalid associations', async () => {
    const invalid = fixture()
    invalid.store.eligibility.clear()
    invalid.store.services.delete('svc_inactive')
    expect(
      await invalid.run(
        Effect.flatMap(BookingSelection, (selection) => selection.load(session))
      )
    ).toMatchObject({ catalogRecovery: 'invalid_associations' })

    const inactive = fixture()
    for (const [id, service] of inactive.store.services) {
      if (service.merchantId === 'mer_mara') {
        inactive.store.services.set(id, { ...service, status: 'inactive' })
      }
    }
    expect(
      await inactive.run(
        Effect.flatMap(BookingSelection, (selection) => selection.load(session))
      )
    ).toMatchObject({ catalogRecovery: 'inactive_entities' })
  })

  it('switches Shop atomically, resolves localized configuration precedence, and clears dependent choices', async () => {
    const { store, run } = fixture()
    store.shops.set('shp_riverside', {
      id: 'shp_riverside',
      merchantId: 'mer_mara',
      brandId: 'brd_mara',
      slug: 'riverside',
      publicName: 'Riverside',
      brandName: 'Mara Studios',
      addressLines: ['21 Mercer Street', 'New York, NY 10013'],
      coordinates: { latitude: 40.724, longitude: -74.001 },
      bookingConfiguration: {
        sourceLocale: 'en',
        nameTranslations: { es: 'Ribera' },
        premiumPalette: {
          primaryColor: '#111111',
          primaryDark: '#121212',
          primaryDarker: '#131313',
          primaryLight: '#141414',
          primaryFontColor: '#ffffff',
          secondaryColor: '#151515',
          linkColor: '#161616'
        }
      }
    })
    store.shopProviders.add('shp_riverside\0prv_noah')
    store.shopServices.add('shp_riverside\0svc_cut')
    const localizedSession = { ...session, locale: 'es' as const }
    await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(localizedSession, { kind: 'any' }, 1)
      )
    )
    const changed = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseShop(localizedSession, 'shp_riverside', 2)
      )
    )

    expect(changed).toMatchObject({
      version: 3,
      shopId: 'shp_riverside',
      providerPreference: null,
      selection: { primaryServiceId: null, additionalServiceIds: [] },
      reconciliation: ['shop_changed'],
      resolvedConfiguration: {
        shopName: { text: 'Ribera', locale: 'es' },
        premiumPalette: { primaryColor: '#111111' }
      },
      shops: expect.arrayContaining([
        expect.objectContaining({
          id: 'shp_riverside',
          addressLines: ['21 Mercer Street', 'New York, NY 10013'],
          coordinates: { latitude: 40.724, longitude: -74.001 }
        })
      ])
    })
    expect(changed.providers.map((provider) => provider.id)).toEqual(['prv_noah'])
    expect(changed.services.map((service) => service.id)).toEqual(['svc_cut'])
  })

  it('exposes restricted Providers explicitly but rejects selecting them', async () => {
    const { store, run } = fixture()
    const loaded = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )
    expect(
      loaded.providers.find((provider) => provider.id === 'prv_restricted')
    ).toMatchObject({
      access: 'restricted'
    })
    const result = await run(
      Effect.result(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(
            session,
            { kind: 'specific', providerId: 'prv_restricted' },
            loaded.version
          )
        )
      )
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BookingSelectionRejected' }
    })
    store.selections.set(session.id, {
      providerPreference: { kind: 'specific', providerId: 'prv_restricted' },
      primaryServiceId: 'svc_cut',
      additionalServiceIds: []
    })
    expect(
      await run(
        Effect.flatMap(BookingSelection, (selection) => selection.load(session))
      )
    ).toMatchObject({
      providerPreference: { kind: 'specific', providerId: 'prv_ava' },
      selection: { primaryServiceId: 'svc_cut' },
      reconciliation: []
    })
  })

  it('auto-selects the sole default Provider for Solo and exposes active bookable catalog only', async () => {
    const { store, run } = fixture('solo')
    store.selections.set(session.id, {
      providerPreference: { kind: 'specific', providerId: 'prv_noah' },
      primaryServiceId: null,
      additionalServiceIds: []
    })
    const journey = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )

    expect(journey.presentation).toBe('solo')
    expect(journey.providerPreference).toEqual({
      kind: 'specific',
      providerId: 'prv_ava'
    })
    expect(journey.providers.map((provider) => provider.id)).toEqual([
      'prv_ava',
      'prv_noah',
      'prv_restricted'
    ])
    expect(journey.services.map((service) => service.id)).toEqual([
      'svc_cut',
      'svc_beard',
      'svc_eur'
    ])
    expect(store.selections.get(session.id)?.providerPreference).toEqual({
      kind: 'specific',
      providerId: 'prv_ava'
    })
  })

  it('normalizes legacy Any Provider commands to the sole Owner-Provider', async () => {
    const { run } = fixture()
    const journey = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(session, { kind: 'any' }, 1)
      )
    )
    expect(journey.providerPreference).toEqual({
      kind: 'specific',
      providerId: 'prv_ava'
    })
  })

  it('rejects stale aggregate versions without overwriting current intent', async () => {
    const { run } = fixture()
    const changed = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(session, { kind: 'any' }, 1)
      )
    )
    const stale = await run(
      Effect.result(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(
            session,
            { kind: 'specific', providerId: 'prv_noah' },
            1
          )
        )
      )
    )

    expect(changed.version).toBe(2)
    expect(stale).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BookingPartyConflict', expectedVersion: 1 }
    })
    expect(
      await run(
        Effect.flatMap(BookingSelection, (selection) => selection.load(session))
      )
    ).toMatchObject({
      version: 2,
      providerPreference: { kind: 'specific', providerId: 'prv_ava' }
    })
  })

  it('persists one Primary Service and ordered unique Additional Services', async () => {
    const { run } = fixture()
    await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(
          session,
          { kind: 'specific', providerId: 'prv_ava' },
          1
        )
      )
    )
    const journey = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseServices(
          session,
          {
            primaryServiceId: 'svc_cut',
            additionalServiceIds: ['svc_beard']
          },
          2
        )
      )
    )
    expect(journey.selection).toEqual({
      primaryServiceId: 'svc_cut',
      additionalServiceIds: ['svc_beard']
    })
    expect(journey.compatibleAdditionalServiceIds).toEqual(['svc_beard'])
    const refreshed = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )
    expect(refreshed.selection).toEqual(journey.selection)

    const cleared = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseServices(
          session,
          {
            primaryServiceId: null,
            additionalServiceIds: []
          },
          3
        )
      )
    )
    expect(cleared.selection).toEqual({
      primaryServiceId: null,
      additionalServiceIds: []
    })
  })

  it('clears Services when the customer changes Provider Preference', async () => {
    const { run } = fixture()
    await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(
          session,
          {
            kind: 'specific',
            providerId: 'prv_ava'
          },
          1
        )
      )
    )
    await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseServices(
          session,
          {
            primaryServiceId: 'svc_cut',
            additionalServiceIds: ['svc_beard']
          },
          2
        )
      )
    )
    const changed = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(
          session,
          {
            kind: 'specific',
            providerId: 'prv_noah'
          },
          3
        )
      )
    )
    expect(changed.selection).toEqual({
      primaryServiceId: null,
      additionalServiceIds: []
    })
  })

  it('removes stale catalog selections from the public projection', async () => {
    const { store, run } = fixture()
    store.selections.set(session.id, {
      providerPreference: { kind: 'specific', providerId: 'prv_ava' },
      primaryServiceId: 'svc_cut',
      additionalServiceIds: ['svc_beard']
    })
    store.providers.set('prv_ava', {
      ...store.providers.get('prv_ava')!,
      status: 'inactive'
    })
    const refreshed = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )
    expect(refreshed.providerPreference).toBeNull()
    expect(refreshed.selection).toEqual({
      primaryServiceId: null,
      additionalServiceIds: []
    })
  })

  it('accepts a restricted Provider only with a short-lived proof bound to its Booking Session and Provider', async () => {
    const { store, run } = fixture()
    store.providers.set('prv_ava', {
      ...store.providers.get('prv_ava')!,
      bookingAccess: 'restricted',
      bookingAccessVerifierHash: await hashSha256('2468')
    })
    const proof = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.verifyProviderAccess(
          session,
          'prv_ava',
          '2468',
          new Date().toISOString()
        )
      )
    )
    const selected = await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(
          session,
          { kind: 'specific', providerId: 'prv_ava' },
          1,
          proof.proof
        )
      )
    )
    expect(selected.providerPreference).toEqual({
      kind: 'specific',
      providerId: 'prv_ava'
    })

    await expect(
      run(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(
            session,
            { kind: 'specific', providerId: 'prv_ava' },
            2,
            proof.proof,
            proof.expiresAt
          )
        )
      )
    ).rejects.toMatchObject({ _tag: 'BookingSelectionRejected' })

    const wrongSession = { ...session, id: 'bsn_other' }
    await expect(
      run(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(
            wrongSession,
            { kind: 'specific', providerId: 'prv_ava' },
            1,
            proof.proof
          )
        )
      )
    ).rejects.toMatchObject({ _tag: 'BookingSelectionRejected' })
  })

  it('rejects invalid, private, duplicate, ineligible, and mixed-currency selections without mutation or disclosure', async () => {
    const { run } = fixture()
    await run(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(
          session,
          { kind: 'specific', providerId: 'prv_noah' },
          1
        )
      )
    )
    const choose = (
      primaryServiceId: string | null,
      additionalServiceIds: readonly string[]
    ) =>
      run(
        Effect.result(
          Effect.flatMap(BookingSelection, (selection) =>
            selection.chooseServices(
              session,
              {
                primaryServiceId,
                additionalServiceIds
              },
              2
            )
          )
        )
      )

    for (const input of [
      ['missing', []],
      ['svc_other', []],
      ['svc_inactive', []],
      ['svc_cut', ['svc_cut']],
      ['svc_cut', ['svc_eur']],
      [null, ['svc_beard']]
    ] as const) {
      const result = await choose(input[0], input[1])
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure')
        expect(result.failure).toMatchObject({
          _tag: 'BookingSelectionRejected',
          message: 'Selection could not be accepted'
        })
    }
    const journey = await run(
      Effect.flatMap(BookingSelection, (selection) => selection.load(session))
    )
    expect(journey.selection).toEqual({
      primaryServiceId: null,
      additionalServiceIds: []
    })
  })
})
