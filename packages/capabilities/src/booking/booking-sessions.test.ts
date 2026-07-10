import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  BookingSessions,
  SeedBookingSessions,
  emptySeedBookingSessionStore,
  enterBookingSession,
  type AuthorizeBookingSessionInput,
  type BookingSession
} from './booking-sessions.ts'

const now = '2026-07-10T10:00:00.000Z'

describe('Booking Session capability', () => {
  it('creates server-owned pay-in-person state with an independent hashed capability', async () => {
    const store = emptySeedBookingSessionStore({
      merchants: [{ id: 'mer_mara', slug: 'mara-studio', published: true }]
    })

    const issued = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.start({ merchantSlug: 'mara-studio', now })
        ),
        SeedBookingSessions(store, {
          newSessionId: () => 'bsn_route_locator',
          newCapability: () => 'a'.repeat(64)
        })
      )
    )

    expect(issued.session).toMatchObject({
      id: 'bsn_route_locator',
      merchantSlug: 'mara-studio',
      checkoutPath: 'pay_in_person',
      idleExpiresAt: '2026-07-10T10:30:00.000Z',
      absoluteExpiresAt: '2026-07-10T12:00:00.000Z'
    })
    expect(issued.capability).toBe('a'.repeat(64))
    expect(issued.session.id).not.toContain(issued.capability)

    const persisted = store.sessions.get(issued.session.id)
    expect(persisted?.capabilityHash).toMatch(/^[a-f0-9]{64}$/)
    expect(persisted).not.toHaveProperty('capability')
    expect(JSON.stringify(persisted)).not.toContain(issued.capability)
  })

  it('authorizes only the matching route, capability, Merchant, lifecycle, and expiry', async () => {
    const store = emptySeedBookingSessionStore({
      merchants: [
        { id: 'mer_mara', slug: 'mara-studio', published: true },
        { id: 'mer_other', slug: 'other-studio', published: true }
      ]
    })
    const layer = SeedBookingSessions(store, {
      newSessionId: () => 'bsn_private',
      newCapability: () => 'b'.repeat(64)
    })
    const run = <A, E>(effect: Effect.Effect<A, E, BookingSessions>) =>
      Effect.runPromise(Effect.provide(effect, layer))
    await run(
      Effect.flatMap(BookingSessions, (sessions) =>
        sessions.start({ merchantSlug: 'mara-studio', now })
      )
    )

    const authorize = (overrides: Partial<AuthorizeBookingSessionInput>) =>
      run(
        Effect.result(
          Effect.flatMap(BookingSessions, (sessions) =>
            sessions.authorize({
              merchantSlug: 'mara-studio',
              sessionId: 'bsn_private',
              capability: 'b'.repeat(64),
              now: '2026-07-10T10:05:00.000Z',
              ...overrides
            })
          )
        )
      )

    expect((await authorize({}))._tag).toBe('Success')
    for (const overrides of [
      { sessionId: 'bsn_unknown' },
      { capability: 'c'.repeat(64) },
      { merchantSlug: 'other-studio' }
    ]) {
      const result = await authorize(overrides)
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure')
        expect(result.failure._tag).toBe('BookingSessionNotFound')
    }

    const expired = await authorize({ now: '2026-07-10T10:36:00.000Z' })
    expect(expired._tag).toBe('Failure')
    if (expired._tag === 'Failure')
      expect(expired.failure._tag).toBe('BookingSessionGone')

    const record = store.sessions.get('bsn_private')!
    store.sessions.set('bsn_private', { ...record, lifecycle: 'consumed' })
    const consumed = await authorize({ now: '2026-07-10T10:06:00.000Z' })
    expect(consumed._tag).toBe('Failure')
    if (consumed._tag === 'Failure')
      expect(consumed.failure._tag).toBe('BookingSessionGone')
  })

  it('resumes a valid session after unpublishing and keeps concurrent Merchants independent', async () => {
    const store = emptySeedBookingSessionStore({
      merchants: [
        { id: 'mer_mara', slug: 'mara-studio', published: true },
        { id: 'mer_other', slug: 'other-studio', published: true }
      ]
    })
    const sessionIds = ['bsn_mara', 'bsn_other']
    const capabilities = ['d'.repeat(64), 'e'.repeat(64)]
    const layer = SeedBookingSessions(store, {
      newSessionId: () => sessionIds.shift() ?? 'unexpected',
      newCapability: () => capabilities.shift() ?? 'f'.repeat(64)
    })
    const enter = (
      merchantSlug: string,
      candidates: readonly {
        readonly sessionId: string
        readonly capability: string
      }[]
    ) =>
      Effect.runPromise(
        Effect.provide(enterBookingSession({ merchantSlug, candidates, now }), layer)
      )

    const mara = await enter('mara-studio', [])
    expect(mara.kind).toBe('created')
    if (mara.kind !== 'created') throw new Error('expected a new session')
    store.merchants.get('mara-studio')!.published = false

    const resumed = await enter('mara-studio', [
      { sessionId: mara.session.id, capability: mara.capability }
    ])
    expect(resumed).toMatchObject({ kind: 'resumed', session: { id: 'bsn_mara' } })

    const other = await enter('other-studio', [
      { sessionId: mara.session.id, capability: mara.capability }
    ])
    expect(other).toMatchObject({ kind: 'created', session: { id: 'bsn_other' } })
    expect(store.sessions).toHaveLength(2)
  })

  it('never extends activity beyond the two-hour absolute expiry', async () => {
    const store = emptySeedBookingSessionStore({
      merchants: [{ id: 'mer_mara', slug: 'mara-studio', published: true }]
    })
    const layer = SeedBookingSessions(store, {
      newSessionId: () => 'bsn_absolute',
      newCapability: () => 'f'.repeat(64)
    })
    const run = <A, E>(effect: Effect.Effect<A, E, BookingSessions>) =>
      Effect.runPromise(Effect.provide(effect, layer))
    await run(
      Effect.flatMap(BookingSessions, (sessions) =>
        sessions.start({ merchantSlug: 'mara-studio', now })
      )
    )
    let refreshed: BookingSession | undefined
    for (const activityAt of [
      '2026-07-10T10:20:00.000Z',
      '2026-07-10T10:40:00.000Z',
      '2026-07-10T11:00:00.000Z',
      '2026-07-10T11:20:00.000Z',
      '2026-07-10T11:40:00.000Z',
      '2026-07-10T11:50:00.000Z'
    ]) {
      refreshed = await run(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.authorize({
            merchantSlug: 'mara-studio',
            sessionId: 'bsn_absolute',
            capability: 'f'.repeat(64),
            now: activityAt
          })
        )
      )
    }
    expect(refreshed?.idleExpiresAt).toBe('2026-07-10T12:00:00.000Z')
  })

  it('keeps simultaneous Sessions for one Merchant independently authorized', async () => {
    const store = emptySeedBookingSessionStore({
      merchants: [{ id: 'mer_mara', slug: 'mara-studio', published: true }]
    })
    const ids = ['bsn_first', 'bsn_second']
    const secrets = ['1'.repeat(64), '2'.repeat(64)]
    const layer = SeedBookingSessions(store, {
      newSessionId: () => ids.shift()!,
      newCapability: () => secrets.shift()!
    })
    const run = <A, E>(effect: Effect.Effect<A, E, BookingSessions>) =>
      Effect.runPromise(Effect.provide(effect, layer))
    const [first, second] = await Promise.all([
      run(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.start({ merchantSlug: 'mara-studio', now })
        )
      ),
      run(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.start({ merchantSlug: 'mara-studio', now })
        )
      )
    ])
    expect(first.session.id).not.toBe(second.session.id)
    expect(first.capability).not.toBe(second.capability)

    const crossed = await run(
      Effect.result(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.authorize({
            merchantSlug: 'mara-studio',
            sessionId: first.session.id,
            capability: second.capability,
            now: '2026-07-10T10:05:00.000Z'
          })
        )
      )
    )
    expect(crossed._tag).toBe('Failure')
    if (crossed._tag === 'Failure') {
      expect(crossed.failure._tag).toBe('BookingSessionNotFound')
    }
    const own = await run(
      Effect.flatMap(BookingSessions, (sessions) =>
        sessions.authorize({
          merchantSlug: 'mara-studio',
          sessionId: first.session.id,
          capability: first.capability,
          now: '2026-07-10T10:05:00.000Z'
        })
      )
    )
    expect(own.id).toBe(first.session.id)
  })
})
