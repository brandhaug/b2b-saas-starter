import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  appointments,
  brands,
  layerFromD1,
  merchants,
  merchantSubscriptions,
  merchantMemberships,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  scheduleRules,
  services,
  shopAddresses,
  shops,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  testMerchantContext,
  type MerchantContext
} from '../merchant-catalog/merchant-context.ts'
import {
  BookingPublication,
  LiveBookingPublication,
  LiveScheduling,
  Scheduling
} from './scheduling.ts'
import {
  BookingScheduling,
  LiveBookingScheduling
} from '../booking/booking-scheduling.ts'
import type { BookingSession } from '../booking/booking-sessions.ts'

let test: TestD1
const merchant = {
  id: 'mer_scheduling_live',
  publicName: 'Live Schedule Studio',
  slug: 'live-schedule-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'solo' as const
}

const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, layerFromD1(test.d1)))

const run = <A, E>(
  effect: Effect.Effect<A, E, Scheduling | BookingPublication | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        LiveScheduling,
        LiveBookingPublication,
        testMerchantContext({ ...merchant, actorUserId: 'usr_scheduling_live' })
      ).pipe(Layer.provide(layerFromD1(test.d1)))
    )
  )

beforeAll(async () => {
  test = await provisionTestD1()
  await runDb(
    Effect.gen(function* () {
      const db = yield* Database
      const now = '2026-07-10T09:30:00.000Z'
      yield* db
        .insert(merchants)
        .values({ ...merchant, createdAt: now, updatedAt: now })
      yield* db.insert(user).values({
        id: 'usr_scheduling_live',
        email: 'owner@scheduling.test',
        name: 'Owner',
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: new Date('2026-07-10T09:30:00.000Z'),
        updatedAt: new Date('2026-07-10T09:30:00.000Z')
      })
      yield* db.insert(merchantMemberships).values({
        merchantId: merchant.id,
        userId: 'usr_scheduling_live',
        role: 'owner',
        createdAt: now
      })
      yield* db.insert(brands).values({
        id: 'brd_live_schedule',
        merchantId: merchant.id,
        name: merchant.publicName,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(shops).values({
        id: 'shp_live_schedule',
        brandId: 'brd_live_schedule',
        merchantId: merchant.id,
        slug: merchant.slug,
        publicName: merchant.publicName,
        timezone: merchant.timezone,
        currency: merchant.currency,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(shopAddresses).values({
        id: 'sad_live_schedule',
        shopId: 'shp_live_schedule',
        addressJson: JSON.stringify({ line1: 'Strada Test 10', locality: 'București' }),
        latitude: '44.43',
        longitude: '26.1',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(providers).values({
        id: 'prv_live_schedule',
        merchantId: merchant.id,
        linkedUserId: 'usr_scheduling_live',
        displayName: 'Live Provider',
        status: 'active',
        isDefault: true,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(services).values({
        id: 'svc_live_schedule',
        merchantId: merchant.id,
        name: 'Live Service',
        description: null,
        category: null,
        priceMinor: 5000,
        currency: 'RON',
        durationMinutes: 60,
        status: 'active',
        createdAt: now,
        updatedAt: now
      })
      yield* db
        .insert(providerServiceEligibility)
        .values({
          merchantId: merchant.id,
          providerId: 'prv_live_schedule',
          serviceId: 'svc_live_schedule',
          createdAt: now
        })
        .onConflictDoNothing()
      yield* db.insert(appointments).values({
        id: 'apt_live_schedule_busy',
        merchantId: merchant.id,
        providerId: 'prv_live_schedule',
        status: 'scheduled',
        startsAt: '2026-07-13T07:00:00.000Z',
        endsAt: '2026-07-13T08:00:00.000Z',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(publicBookingPages).values({
        id: 'pg_live_schedule',
        merchantId: merchant.id,
        status: 'unpublished',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(merchantSubscriptions).values({
        id: 'sub_live_schedule',
        merchantId: merchant.id,
        plan: 'solo',
        interval: 'monthly',
        status: 'trialing',
        trialEndsAt: '2026-07-24T00:00:00.000Z',
        createdAt: now,
        updatedAt: now
      })
    })
  )
  await test.d1
    .prepare(
      `INSERT INTO transactional_email_evidence
       (id,merchant_id,owner_user_id,idempotency_key,purpose,locale,template_key,masked_destination,sender_identity,status,attempted_at,attempt_count,retryable,accepted_at,updated_at)
       VALUES ('tee_scheduling_live',?,'usr_scheduling_live','scheduling-live','owner_activation_test','en','owner_activation_test_en_v1','o***@scheduling.test','no-reply@beesolo.test','accepted',?,1,0,?,?)`
    )
    .bind(
      merchant.id,
      '2026-07-10T09:30:00.000Z',
      '2026-07-10T09:30:00.000Z',
      '2026-07-10T09:30:00.000Z'
    )
    .run()
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Scheduling and publication', () => {
  it('persists rules, derives Availability, publishes current data, and retains configuration on unpublish', async () => {
    const result = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        const publication = yield* BookingPublication
        yield* scheduling.saveProviderRules('prv_live_schedule', [
          { weekday: 1, startTime: '09:00', endTime: '12:00' }
        ])
        const availability = yield* scheduling.availability({
          providerId: 'prv_live_schedule',
          serviceId: 'svc_live_schedule',
          from: '2026-07-10T09:30:00.000Z',
          days: 7
        })
        const readiness = yield* publication.readiness()
        yield* publication.publish()
        const page = yield* publication.resolvePublished(merchant.slug)
        yield* publication.unpublish()
        return {
          availability,
          readiness,
          page,
          rules: yield* scheduling.listProviderRules('prv_live_schedule')
        }
      })
    )

    expect(result.availability.slots[0]?.startsAt).toBe('2026-07-13T06:00:00.000Z')
    expect(result.availability.slots.map((slot) => slot.startsAt)).not.toContain(
      '2026-07-13T07:00:00.000Z'
    )
    expect(result.readiness.ready).toBe(true)
    expect(result.page.publicName).toBe('Live Schedule Studio')
    expect(result.page.bookingPath).toBe('/live-schedule-studio/booking')
    expect(result.page.closingTime).toBe('12:00')
    expect(result.page.teamMembers).toEqual([
      { id: 'prv_live_schedule', displayName: 'Live Provider' }
    ])
    expect(result.page.location).toEqual({
      label: 'Strada Test 10, București',
      latitude: 44.43,
      longitude: 26.1
    })
    expect(result.rules).toHaveLength(1)
    expect(
      await runDb(Effect.flatMap(Database, (db) => db.select().from(scheduleRules)))
    ).toHaveLength(1)
  })

  it('fails Merchant Availability closed for malformed persisted Service buffers', async () => {
    await runDb(
      Effect.flatMap(Database, (db) =>
        db
          .update(services)
          .set({
            bookingConfigJson: {
              beforeBufferMinutes: 7,
              afterBufferMinutes: 0
            }
          })
          .where(eq(services.id, 'svc_live_schedule'))
      )
    )
    const availability = await run(
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.availability({
          providerId: 'prv_live_schedule',
          serviceId: 'svc_live_schedule',
          from: '2026-07-10T09:30:00.000Z',
          days: 7
        })
      )
    )
    expect(availability.slots).toEqual([])
    await runDb(
      Effect.flatMap(Database, (db) =>
        db
          .update(services)
          .set({ bookingConfigJson: null })
          .where(eq(services.id, 'svc_live_schedule'))
      )
    )
  })

  it('preserves Published intent but fails closed when Notification Readiness is lost', async () => {
    await test.d1
      .prepare(`UPDATE public_booking_pages SET status='published' WHERE merchant_id=?`)
      .bind(merchant.id)
      .run()

    await test.d1
      .prepare(`DELETE FROM transactional_email_evidence WHERE merchant_id=?`)
      .bind(merchant.id)
      .run()

    const denied = await run(
      Effect.flatMap(BookingPublication, (publication) =>
        Effect.flip(publication.resolvePublished(merchant.slug))
      )
    )
    expect(denied.reason).toBe('unpublished')
    expect(
      await test.d1
        .prepare(`SELECT status FROM public_booking_pages WHERE merchant_id=?`)
        .bind(merchant.id)
        .first()
    ).toEqual({ status: 'published' })

    await test.d1
      .prepare(
        `INSERT INTO transactional_email_evidence
         (id,merchant_id,owner_user_id,idempotency_key,purpose,locale,template_key,masked_destination,sender_identity,status,attempted_at,attempt_count,retryable,accepted_at,updated_at)
         VALUES ('tee_scheduling_live_restored',?,'usr_scheduling_live','scheduling-live-restored','owner_activation_test','en','owner_activation_test_en_v1','o***@scheduling.test','no-reply@beesolo.test','accepted',?,1,0,?,?)`
      )
      .bind(
        merchant.id,
        '2026-07-10T09:30:00.000Z',
        '2026-07-10T09:30:00.000Z',
        '2026-07-10T09:30:00.000Z'
      )
      .run()
  })

  it('atomically invalidates an affected hold and exposes immutable change and conflict facts', async () => {
    const session: BookingSession = {
      id: 'bsn_schedule_change',
      merchantSlug: merchant.slug,
      checkoutPath: 'pay_in_person',
      lifecycle: 'active',
      createdAt: '2026-08-03T00:00:00.000Z',
      lastActivityAt: '2026-08-03T00:00:00.000Z',
      idleExpiresAt: '2099-01-01T00:00:00.000Z',
      absoluteExpiresAt: '2099-01-01T00:00:00.000Z'
    }
    await test.d1
      .prepare(
        `INSERT INTO booking_sessions
         (id,merchant_id,capability_hash,checkout_path,lifecycle,locale,embedding_profile,created_at,last_activity_at,idle_expires_at,absolute_expires_at)
         VALUES (?,?,?,'pay_in_person','active','en','standalone',?,?,?,?)`
      )
      .bind(
        session.id,
        merchant.id,
        'hash_schedule_change',
        session.createdAt,
        session.lastActivityAt,
        session.idleExpiresAt,
        session.absoluteExpiresAt
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO appointments
         (id,merchant_id,provider_id,status,starts_at,ends_at,created_at,updated_at)
         VALUES ('apt_schedule_change',?,?,'scheduled','2098-12-01T10:00:00.000Z','2098-12-01T11:00:00.000Z',?,?)`
      )
      .bind(merchant.id, 'prv_live_schedule', session.createdAt, session.createdAt)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO time_slot_holds
         (id,merchant_id,booking_session_id,provider_id,starts_at,ends_at,created_at,expires_at,quote)
         VALUES ('hld_schedule_change',?,?,?,'2098-12-01T10:00:00.000Z','2098-12-01T11:00:00.000Z',?,'2098-12-01T12:00:00.000Z',?)`
      )
      .bind(
        merchant.id,
        session.id,
        'prv_live_schedule',
        session.createdAt,
        JSON.stringify({
          startsAt: '2098-12-01T10:00:00.000Z',
          endsAt: '2098-12-01T11:00:00.000Z',
          occupiedStartsAt: '2098-12-01T10:00:00.000Z',
          occupiedEndsAt: '2098-12-01T11:00:00.000Z',
          providerPreference: { kind: 'specific', providerId: 'prv_live_schedule' },
          assignedProvider: { id: 'prv_live_schedule', displayName: 'Live Provider' },
          services: [],
          durationMinutes: 60,
          currency: 'RON',
          totalMinor: 0
        })
      )
      .run()

    const unconfirmed = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        return yield* Effect.flip(
          scheduling.saveProviderRules('prv_live_schedule', [
            { weekday: 0, startTime: '09:00', endTime: '10:00' }
          ])
        )
      })
    )
    expect(unconfirmed).toMatchObject({
      _tag: 'SchedulingValidationError',
      reason: 'confirmation_required'
    })

    const changed = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        const result = yield* scheduling.addBlockedTime({
          startsAt: '2098-12-01T10:00:00.000Z',
          endsAt: '2098-12-01T11:00:00.000Z',
          reason: 'Building maintenance'
        })
        return { result, controls: yield* scheduling.listControls() }
      })
    )
    const currentHold = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.currentHold(session, { now: '2026-08-03T00:00:00.000Z' })
        ),
        LiveBookingScheduling.pipe(Layer.provide(layerFromD1(test.d1)))
      )
    )

    expect(currentHold).toBeNull()
    expect(changed.result.conflictingAppointmentIds).toEqual(['apt_schedule_change'])
    expect(changed.controls.scheduleConflicts).toContainEqual({
      appointmentId: 'apt_schedule_change',
      reason: 'outside_current_schedule'
    })
    expect(changed.controls.recentChanges[0]).toMatchObject({
      kind: 'blocked_time',
      actorId: 'usr_scheduling_live',
      reason: 'Building maintenance',
      beforeJson: 'null'
    })
    expect(JSON.parse(changed.controls.recentChanges[0]!.afterJson)).toMatchObject({
      startsAt: '2098-12-01T10:00:00.000Z',
      endsAt: '2098-12-01T11:00:00.000Z'
    })
  })

  it('keeps publication preference but makes the page unavailable while restricted', async () => {
    await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db
          .update(publicBookingPages)
          .set({ status: 'published' })
          .where(eq(publicBookingPages.merchantId, merchant.id))
        yield* db
          .update(merchantSubscriptions)
          .set({
            status: 'restricted',
            restrictedAt: '2026-07-15T00:00:00.000Z',
            retentionEndsAt: '2027-07-15T00:00:00.000Z',
            updatedAt: '2026-07-15T00:00:00.000Z'
          })
          .where(eq(merchantSubscriptions.merchantId, merchant.id))
      })
    )
    const denied = await run(
      Effect.flatMap(BookingPublication, (publication) =>
        Effect.flip(publication.resolvePublished(merchant.slug))
      )
    )
    expect(denied.reason).toBe('unpublished')
    const restrictedAvailability = await run(
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.availability({
          providerId: 'prv_live_schedule',
          serviceId: 'svc_live_schedule',
          from: '2026-07-10T09:30:00.000Z',
          days: 7
        })
      )
    )
    expect(restrictedAvailability.slots).toEqual([])
    await expect(
      run(
        Effect.flatMap(Scheduling, (scheduling) =>
          scheduling.saveProviderRules('prv_live_schedule', [
            { weekday: 1, startTime: '10:00', endTime: '12:00' }
          ])
        )
      )
    ).rejects.toMatchObject({
      _tag: 'CapabilityDenied',
      reason: 'restricted_access'
    })
    const preferred = await runDb(
      Effect.flatMap(Database, (db) =>
        db
          .select({ status: publicBookingPages.status })
          .from(publicBookingPages)
          .where(eq(publicBookingPages.merchantId, merchant.id))
          .limit(1)
      )
    )
    expect(preferred[0]?.status).toBe('published')
  })
})
