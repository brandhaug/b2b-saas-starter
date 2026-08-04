import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import {
  Database,
  layerFromD1,
  merchantMemberships,
  merchants,
  merchantSubscriptions,
  providers,
  scheduleRules,
  services,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  AppointmentOperations,
  LiveAppointmentOperations
} from './appointment-operations.ts'
import {
  LiveMerchantAppointmentCommands,
  MerchantAppointmentCommands,
  type MerchantAppointmentCommand
} from './merchant-appointment-commands.ts'
import { testMerchantContext } from '../merchant-catalog/merchant-context.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'

let test: TestD1
const fixtureNow = '2026-08-03T10:00:00.000Z'

const run = <A>(
  effect: Effect.Effect<A, unknown, MerchantAppointmentCommands | MerchantContext>
) => {
  const database = layerFromD1(test.d1)
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(
        LiveMerchantAppointmentCommands.pipe(Layer.provide(database)),
        testMerchantContext({
          id: 'mer_operations',
          actorUserId: 'usr_operations_owner',
          publicName: 'Operations Studio',
          slug: 'operations-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo'
        })
      )
    )
  )
}

const execute = (command: MerchantAppointmentCommand) =>
  run(
    Effect.flatMap(MerchantAppointmentCommands, (service) => service.execute(command))
  )

const detail = (appointmentId: string) => {
  const database = layerFromD1(test.d1)
  return Effect.runPromise(
    Effect.provide(
      Effect.flatMap(AppointmentOperations, (service) => service.detail(appointmentId)),
      Layer.merge(
        LiveAppointmentOperations.pipe(Layer.provide(database)),
        testMerchantContext({
          id: 'mer_operations',
          actorUserId: 'usr_operations_owner',
          publicName: 'Operations Studio',
          slug: 'operations-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo'
        })
      )
    )
  )
}

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(user).values({
          id: 'usr_operations_owner',
          name: 'Operations Owner',
          email: 'owner@operations.test',
          emailVerified: true,
          identityClass: 'merchant_member',
          createdAt: new Date(fixtureNow),
          updatedAt: new Date(fixtureNow)
        })
        yield* db.insert(merchants).values({
          id: 'mer_operations',
          publicName: 'Operations Studio',
          slug: 'operations-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo',
          createdAt: fixtureNow,
          updatedAt: fixtureNow
        })
        yield* db.insert(merchantMemberships).values({
          merchantId: 'mer_operations',
          userId: 'usr_operations_owner',
          role: 'owner',
          createdAt: fixtureNow
        })
        yield* db.insert(merchantSubscriptions).values({
          id: 'sub_operations',
          merchantId: 'mer_operations',
          ownerUserId: 'usr_operations_owner',
          plan: 'solo',
          interval: 'monthly',
          status: 'active',
          createdAt: fixtureNow,
          updatedAt: fixtureNow
        })
        yield* db.insert(providers).values({
          id: 'prv_operations_owner',
          merchantId: 'mer_operations',
          linkedUserId: 'usr_operations_owner',
          displayName: 'Operations Owner',
          status: 'active',
          bookingAccess: 'public',
          isDefault: true,
          createdAt: fixtureNow,
          updatedAt: fixtureNow
        })
        yield* db.insert(services).values({
          id: 'svc_operations_cut',
          merchantId: 'mer_operations',
          name: 'Haircut',
          priceMinor: 9000,
          currency: 'RON',
          durationMinutes: 45,
          status: 'active',
          bookingConfigJson: { beforeBufferMinutes: 0, afterBufferMinutes: 0 },
          createdAt: fixtureNow,
          updatedAt: fixtureNow
        })
        yield* db.insert(scheduleRules).values({
          id: 'scr_operations_monday',
          merchantId: 'mer_operations',
          providerId: 'prv_operations_owner',
          weekday: 1,
          startTime: '09:00',
          endTime: '18:00',
          createdAt: fixtureNow,
          updatedAt: fixtureNow
        })
      }),
      layerFromD1(test.d1)
    )
  )
})

afterAll(async () => test?.dispose())

describe('Live Merchant Appointment commands', () => {
  it('creates one Merchant-scoped Appointment atomically and replays idempotently', async () => {
    const command = {
      kind: 'create',
      idempotencyKey: 'create-once',
      appointmentId: 'apt_operations_one',
      startsAt: '2026-08-10T09:00:00.000Z',
      endsAt: '2026-08-10T09:45:00.000Z',
      serviceIds: ['svc_operations_cut'],
      customer: {
        name: 'Alex Customer',
        email: 'alex@example.com',
        phone: '+40700000000'
      },
      notification: { kind: 'notify', locale: 'en' }
    } as const satisfies MerchantAppointmentCommand

    const first = await execute(command)
    const replay = await execute(command)
    const history = await run(
      Effect.flatMap(MerchantAppointmentCommands, (service) =>
        service.history('apt_operations_one')
      )
    )

    expect(first).toMatchObject({
      appointmentIds: ['apt_operations_one'],
      revisions: { apt_operations_one: 1 },
      replayed: false
    })
    expect(replay).toEqual({ ...first, replayed: true })
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ command: 'create', resultingRevision: 1 })
  })

  it('rejects stale commands and keeps append-only collection net within the Price Snapshot', async () => {
    await expect(
      execute({
        kind: 'edit',
        idempotencyKey: 'stale-edit',
        appointmentId: 'apt_operations_one',
        expectedRevision: 0,
        customer: { name: 'Alex Customer', email: null, phone: null }
      })
    ).rejects.toMatchObject({
      reason: 'stale_revision',
      currentRevision: 1,
      current: {
        id: 'apt_operations_one',
        revision: 1,
        status: 'scheduled'
      }
    })

    await execute({
      kind: 'append_collection',
      idempotencyKey: 'collect-full',
      appointmentId: 'apt_operations_one',
      expectedRevision: 1,
      entry: {
        kind: 'collection',
        amountMinor: 9000,
        method: 'cash',
        recordedAt: '2026-08-10T09:45:00.000Z'
      }
    })
    await expect(
      execute({
        kind: 'append_collection',
        idempotencyKey: 'collect-over',
        appointmentId: 'apt_operations_one',
        expectedRevision: 2,
        entry: {
          kind: 'collection',
          amountMinor: 1,
          method: 'cash',
          recordedAt: '2026-08-10T09:46:00.000Z'
        }
      })
    ).rejects.toMatchObject({ reason: 'collection_net_out_of_bounds' })

    await expect(
      execute({
        kind: 'complete',
        idempotencyKey: 'complete-without-collection-choice',
        appointmentId: 'apt_operations_one',
        expectedRevision: 2
      })
    ).rejects.toMatchObject({ reason: 'outcome_not_available' })
  })

  it('rotates Confirmation access when the customer destination changes', async () => {
    await test.d1
      .prepare(
        `INSERT INTO confirmation_access
          (route_id, appointment_id, purpose, token_version, signing_key_id, expires_at, created_at)
         VALUES (?, ?, 'appointment_confirmation', 1, ?, ?, ?)`
      )
      .bind(
        'cnf_operations_old',
        'apt_operations_one',
        'key-test',
        '2026-09-10T00:00:00.000Z',
        fixtureNow
      )
      .run()

    await execute({
      kind: 'edit',
      idempotencyKey: 'change-destination',
      appointmentId: 'apt_operations_one',
      expectedRevision: 2,
      customer: {
        name: 'Alex Customer',
        email: 'alex.changed@example.com',
        phone: '+40700000000'
      },
      notification: { kind: 'notify', locale: 'en' }
    })

    const access = await test.d1
      .prepare(
        `SELECT token_version tokenVersion, revoked_at revokedAt FROM confirmation_access WHERE route_id = ?`
      )
      .bind('cnf_operations_old')
      .first<{ tokenVersion: number; revokedAt: string | null }>()
    expect(access).toEqual({ tokenVersion: 2, revokedAt: null })
  })

  it('materializes a finite weekly Series atomically and cancels remaining Scheduled members', async () => {
    const created = await execute({
      kind: 'create_series',
      idempotencyKey: 'series-once',
      seriesId: 'aps_operations',
      intervalWeeks: 1,
      localStartDate: '2026-08-17',
      localStartTime: '12:00',
      occurrences: [
        {
          appointmentId: 'apt_series_one',
          cadencePosition: 0,
          adjusted: true,
          startsAt: '2026-08-18T09:00:00.000Z',
          endsAt: '2026-08-18T09:45:00.000Z'
        },
        {
          appointmentId: 'apt_series_two',
          cadencePosition: 2,
          startsAt: '2026-08-31T09:00:00.000Z',
          endsAt: '2026-08-31T09:45:00.000Z'
        }
      ],
      serviceIds: ['svc_operations_cut'],
      customer: { name: 'Series Customer', email: null, phone: null },
      warningAcknowledged: true,
      overrideReason: 'The first occurrence was moved at the customer request.',
      notification: {
        kind: 'suppress',
        reason: 'Customer booked in person.',
        locale: 'en'
      }
    })

    const persistedMembers = await test.d1
      .prepare(
        `SELECT a.id, a.status, f.series_id seriesId
         FROM appointments a JOIN appointment_foundations f ON f.appointment_id = a.id
         WHERE a.merchant_id = ? AND f.series_id = ? ORDER BY f.series_position`
      )
      .bind('mer_operations', 'aps_operations')
      .all<{ id: string; status: string; seriesId: string }>()
    expect(persistedMembers.results).toEqual([
      { id: 'apt_series_one', status: 'scheduled', seriesId: 'aps_operations' },
      { id: 'apt_series_two', status: 'scheduled', seriesId: 'aps_operations' }
    ])
    const persistedSeries = await test.d1
      .prepare(`SELECT weekday FROM appointment_series WHERE id = ?`)
      .bind('aps_operations')
      .first<{ weekday: number }>()
    expect(persistedSeries?.weekday).toBe(1)

    const cancelled = await execute({
      kind: 'cancel_remaining_series',
      idempotencyKey: 'series-cancel',
      seriesId: 'aps_operations',
      expectedRevisions: { apt_series_one: 1, apt_series_two: 1 },
      category: 'merchant_unavailable',
      notification: { kind: 'notify', locale: 'en' }
    })

    expect(created.appointmentIds).toEqual(['apt_series_one', 'apt_series_two'])
    expect(cancelled.revisions).toEqual({ apt_series_one: 2, apt_series_two: 2 })
  })

  it('rolls back an entire Series when one member overlaps a current commitment', async () => {
    await expect(
      run(
        Effect.flatMap(MerchantAppointmentCommands, (service) =>
          service.previewSeries({
            serviceIds: ['svc_operations_cut'],
            occurrences: [
              {
                cadencePosition: 0,
                startsAt: '2026-08-10T09:00:00.000Z',
                endsAt: '2026-08-10T09:45:00.000Z'
              },
              {
                cadencePosition: 1,
                startsAt: '2026-08-17T09:00:00.000Z',
                endsAt: '2026-08-17T09:45:00.000Z'
              }
            ]
          })
        )
      )
    ).resolves.toEqual([
      { cadencePosition: 0, status: 'conflict' },
      { cadencePosition: 1, status: 'available' }
    ])

    await expect(
      run(
        Effect.flatMap(MerchantAppointmentCommands, (service) =>
          service.previewSeries({
            serviceIds: ['svc_operations_cut'],
            occurrences: [
              {
                cadencePosition: 0,
                startsAt: '2026-08-24T09:00:00.000Z',
                endsAt: '2026-08-24T09:45:00.000Z'
              },
              {
                cadencePosition: 1,
                startsAt: '2026-08-24T09:30:00.000Z',
                endsAt: '2026-08-24T10:15:00.000Z'
              }
            ]
          })
        )
      )
    ).resolves.toEqual([
      { cadencePosition: 0, status: 'conflict' },
      { cadencePosition: 1, status: 'conflict' }
    ])

    await expect(
      execute({
        kind: 'create_series',
        idempotencyKey: 'series-conflict',
        intervalWeeks: 1,
        localStartDate: '2026-08-10',
        localStartTime: '12:00',
        occurrences: [
          {
            appointmentId: 'apt_series_conflict',
            cadencePosition: 0,
            startsAt: '2026-08-10T09:00:00.000Z',
            endsAt: '2026-08-10T09:45:00.000Z'
          },
          {
            appointmentId: 'apt_series_rolled_back',
            cadencePosition: 1,
            startsAt: '2026-08-17T09:00:00.000Z',
            endsAt: '2026-08-17T09:45:00.000Z'
          }
        ],
        serviceIds: ['svc_operations_cut'],
        customer: { name: 'Conflict Customer', email: null, phone: null },
        notification: { kind: 'notify', locale: 'en' }
      })
    ).rejects.toMatchObject({ reason: 'concurrent_appointment_conflict' })

    await expect(detail('apt_series_rolled_back')).resolves.toEqual({
      kind: 'not_found'
    })
  })

  it('rejects a new scheduled Series when any member starts in the past', async () => {
    await expect(
      execute({
        kind: 'create_series',
        idempotencyKey: 'past-series',
        intervalWeeks: 1,
        localStartDate: '2026-07-20',
        localStartTime: '12:00',
        occurrences: [
          {
            cadencePosition: 0,
            startsAt: '2026-07-20T09:00:00.000Z',
            endsAt: '2026-07-20T09:45:00.000Z'
          },
          {
            cadencePosition: 1,
            startsAt: '2026-07-27T09:00:00.000Z',
            endsAt: '2026-07-27T09:45:00.000Z'
          }
        ],
        serviceIds: ['svc_operations_cut'],
        customer: { name: 'Past Series Customer', email: null, phone: null },
        notification: { kind: 'notify', locale: 'en' }
      })
    ).rejects.toMatchObject({ reason: 'appointment_start_in_past' })
  })

  it('records a past completed visit and its optional collection in one transaction', async () => {
    const result = await execute({
      kind: 'record_completed',
      idempotencyKey: 'record-completed-once',
      appointmentId: 'apt_completed_visit',
      startsAt: '2026-08-03T06:00:00.000Z',
      endsAt: '2026-08-03T06:45:00.000Z',
      serviceIds: ['svc_operations_cut'],
      customer: { name: 'Past Customer', email: null, phone: null },
      completionReason: 'Imported from the paper ledger.',
      completionCollection: {
        kind: 'collected',
        amountMinor: 9000,
        method: 'cash',
        recordedAt: '2026-08-03T06:45:00.000Z'
      },
      notification: {
        kind: 'suppress',
        reason: 'Historical visit.',
        locale: 'en'
      }
    })

    const stored = await test.d1
      .prepare(
        `SELECT a.status, COALESCE(SUM(CASE WHEN ec.kind = 'collection' THEN ec.amount_minor ELSE -ec.amount_minor END), 0) net
         FROM appointments a LEFT JOIN external_collections ec
           ON ec.merchant_id = a.merchant_id AND ec.appointment_id = a.id
         WHERE a.merchant_id = ? AND a.id = ? GROUP BY a.status`
      )
      .bind('mer_operations', 'apt_completed_visit')
      .first<{ status: string; net: number }>()

    expect(result.revisions).toEqual({ apt_completed_visit: 1 })
    expect(stored).toEqual({ status: 'completed', net: 9000 })
  })

  it('blocks new demand under Restricted Access but permits safe existing-commitment handling', async () => {
    await test.d1
      .prepare(
        `UPDATE merchant_subscriptions SET status = 'restricted' WHERE merchant_id = ?`
      )
      .bind('mer_operations')
      .run()

    await expect(
      execute({
        kind: 'create',
        idempotencyKey: 'restricted-create',
        startsAt: '2026-09-10T09:00:00.000Z',
        endsAt: '2026-09-10T09:45:00.000Z',
        serviceIds: ['svc_operations_cut'],
        customer: { name: 'Restricted Customer', email: null, phone: null },
        notification: { kind: 'notify', locale: 'en' }
      })
    ).rejects.toMatchObject({ reason: 'restricted_access' })

    await expect(
      execute({
        kind: 'cancel',
        idempotencyKey: 'restricted-cancel',
        appointmentId: 'apt_operations_one',
        expectedRevisions: { apt_operations_one: 3 },
        category: 'customer_requested',
        notification: {
          kind: 'suppress',
          reason: 'Customer already knows.',
          locale: 'en'
        }
      })
    ).resolves.toMatchObject({ revisions: { apt_operations_one: 4 } })
  })
})
