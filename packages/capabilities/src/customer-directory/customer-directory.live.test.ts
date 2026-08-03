import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  appointments,
  batch,
  layerFromD1,
  merchants,
  merchantMemberships,
  providers,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import { LiveCustomerDirectory } from './adapters.ts'
import { CustomerDirectory } from './customer-directory.ts'
import {
  prepareAppointmentCustomerAssociation,
  prepareAppointmentCustomerAssociationBatch
} from './appointment-association.ts'

let test: TestD1
const merchant = Layer.succeed(MerchantContext)({
  id: 'mer_customer_live',
  publicName: 'Customer Studio',
  slug: 'customer-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'solo'
})
const layer = () =>
  Layer.merge(LiveCustomerDirectory.pipe(Layer.provide(layerFromD1(test.d1))), merchant)
const run = <A, E>(effect: Effect.Effect<A, E, CustomerDirectory | MerchantContext>) =>
  Effect.runPromise(Effect.provide(effect, layer()))

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(user).values({
          id: 'usr_customer_live_owner',
          name: 'Customer Owner',
          email: 'owner@customer-live.test',
          emailVerified: true,
          identityClass: 'merchant_member',
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
          updatedAt: new Date('2026-08-02T10:00:00.000Z')
        })
        yield* db.insert(merchants).values({
          id: 'mer_customer_live',
          publicName: 'Customer Studio',
          slug: 'customer-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON',
          plan: 'solo',
          createdAt: '2026-08-02T10:00:00.000Z',
          updatedAt: '2026-08-02T10:00:00.000Z'
        })
        yield* db.insert(merchantMemberships).values({
          merchantId: 'mer_customer_live',
          userId: 'usr_customer_live_owner',
          role: 'owner',
          createdAt: '2026-08-02T10:00:00.000Z'
        })
        yield* db.insert(providers).values({
          id: 'prv_customer_live',
          merchantId: 'mer_customer_live',
          linkedUserId: 'usr_customer_live_owner',
          displayName: 'Owner',
          status: 'active',
          isDefault: true,
          createdAt: '2026-08-02T10:00:00.000Z',
          updatedAt: '2026-08-02T10:00:00.000Z'
        })
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Customer Directory contract', () => {
  it('converges same-contact associations prepared from one pre-batch view', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values(
            ['apt_converge_1', 'apt_converge_2'].map((id, index) => ({
              id,
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'scheduled' as const,
              startsAt: `2026-07-0${index + 3}T10:00:00.000Z`,
              endsAt: `2026-07-0${index + 3}T11:00:00.000Z`,
              createdAt: '2026-07-03T10:00:00.000Z',
              updatedAt: '2026-07-03T10:00:00.000Z'
            }))
          )
          const prepared = yield* prepareAppointmentCustomerAssociationBatch(
            db,
            ['apt_converge_1', 'apt_converge_2'].map(
              (id, index) =>
                ({
                  merchantId: 'mer_customer_live',
                  appointment: {
                    id,
                    details: {
                      name: 'Same Customer',
                      email: index === 0 ? 'same@example.com' : null,
                      phone: '+40 700 000 001'
                    }
                  },
                  origin: 'merchant_created',
                  actor: { merchantMemberId: 'usr_owner' },
                  now: '2026-07-03T12:00:00.000Z'
                }) as const
            )
          )
          yield* batch(db, prepared)
        }),
        layerFromD1(test.d1)
      )
    )

    const links = await test.d1
      .prepare(
        `SELECT DISTINCT customer_record_id FROM appointment_foundations
         WHERE appointment_id IN ('apt_converge_1','apt_converge_2')`
      )
      .all<{ customer_record_id: string }>()
    expect(links.results).toHaveLength(1)
    const createdHistory = await test.d1
      .prepare(
        `SELECT kind, revision FROM customer_directory_history
         WHERE customer_record_id = ? ORDER BY revision`
      )
      .bind(links.results[0]!.customer_record_id)
      .all<{ kind: string; revision: number }>()
    expect(createdHistory.results).toEqual([
      { kind: 'created', revision: 1 },
      { kind: 'appointment_observed', revision: 2 }
    ])
  })

  it('uses the contact uniqueness guard to make concurrent preparation retry-safe', async () => {
    const prepared = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values(
            ['apt_concurrent_1', 'apt_concurrent_2'].map((id, index) => ({
              id,
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'scheduled' as const,
              startsAt: `2026-07-1${index}T10:00:00.000Z`,
              endsAt: `2026-07-1${index}T11:00:00.000Z`,
              createdAt: '2026-07-10T09:00:00.000Z',
              updatedAt: '2026-07-10T09:00:00.000Z'
            }))
          )
          const input = (id: string, email: string | null) => ({
            merchantId: 'mer_customer_live',
            appointment: {
              id,
              details: {
                name: 'Concurrent Customer',
                email,
                phone: '+40700000002'
              }
            },
            origin: 'public_booking' as const,
            now: '2026-07-10T12:00:00.000Z'
          })
          return {
            first: yield* prepareAppointmentCustomerAssociation(
              db,
              input('apt_concurrent_1', 'concurrent@example.com')
            ),
            second: yield* prepareAppointmentCustomerAssociation(
              db,
              input('apt_concurrent_2', null)
            ),
            input
          }
        }),
        layerFromD1(test.d1)
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) => batch(db, prepared.first)),
        layerFromD1(test.d1)
      )
    )
    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(Database, (db) => batch(db, prepared.second)),
          layerFromD1(test.d1)
        )
      )
    ).rejects.toBeDefined()
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          const retried = yield* prepareAppointmentCustomerAssociation(
            db,
            prepared.input('apt_concurrent_2', null)
          )
          yield* batch(db, retried)
        }),
        layerFromD1(test.d1)
      )
    )
    const links = await test.d1
      .prepare(
        `SELECT DISTINCT customer_record_id FROM appointment_foundations
         WHERE appointment_id IN ('apt_concurrent_1','apt_concurrent_2')`
      )
      .all<{ customer_record_id: string }>()
    expect(links.results).toHaveLength(1)
  })

  it('persists matching, revisions, attributed history, and idempotent recovery', async () => {
    const created = await run(
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        return yield* service.matchOrCreate({
          appointmentId: 'apt_live_1',
          details: { name: 'Mara Ionescu', email: 'MARA@example.com', phone: null },
          now: '2026-08-02T10:00:00.000Z'
        })
      })
    )
    const contactBefore = await test.d1
      .prepare(
        `SELECT id, created_at FROM customer_contacts
         WHERE customer_record_id = ? AND normalized_value = 'mara@example.com'`
      )
      .bind(created.record.id)
      .first<{ id: string; created_at: string }>()
    expect(contactBefore?.id).not.toContain('mara')
    expect(contactBefore?.id).not.toContain('example')

    const updated = await run(
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const command = {
          expectedRevision: 1,
          idempotencyKey: 'note-live-1',
          actorId: 'usr_owner',
          text: 'Prefers quiet appointments',
          now: '2026-08-02T11:00:00.000Z'
        }
        const first = yield* service.addNote(created.record.id, command)
        const replay = yield* service.addNote(created.record.id, command)
        return { first, replay }
      })
    )

    expect(updated.first.revision).toBe(2)
    expect(updated.replay.notes).toHaveLength(1)
    expect(updated.replay.history.at(-1)).toMatchObject({
      kind: 'note_added',
      actorId: 'usr_owner'
    })
    const contactAfter = await test.d1
      .prepare(
        `SELECT id, created_at FROM customer_contacts
         WHERE customer_record_id = ? AND normalized_value = 'mara@example.com'`
      )
      .bind(created.record.id)
      .first<{ id: string; created_at: string }>()
    expect(contactAfter).toEqual(contactBefore)

    const restored = await run(
      Effect.flatMap(CustomerDirectory, (service) => service.search('mara@example.com'))
    )
    expect(restored[0]?.id).toBe(created.record.id)
    expect(restored[0]?.notes[0]?.text).toBe('Prefers quiet appointments')

    const persistedState = await test.d1
      .prepare(`SELECT state_json FROM customer_directory_states WHERE merchant_id = ?`)
      .bind('mer_customer_live')
      .first<{ state_json: string }>()
    const supplementalRecords = JSON.parse(persistedState!.state_json).records
    expect(
      supplementalRecords.find(
        (record: { readonly id: string }) => record.id === created.record.id
      )
    ).toMatchObject({
      id: created.record.id,
      notes: [expect.objectContaining({ text: 'Prefers quiet appointments' })]
    })
    expect(supplementalRecords[0]).not.toHaveProperty('displayName')
    expect(supplementalRecords[0]).not.toHaveProperty('contacts')
    expect(supplementalRecords[0]).not.toHaveProperty('history')

    await run(
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const allRecords = yield* service.search('', { includeArchived: true })
        return yield* service.eraseExpired({
          idempotencyKey: 'erase-live-customer',
          expectedRevisions: { [created.record.id]: updated.first.revision },
          now: '2027-08-02T10:00:00.000Z',
          inactiveBefore: '2027-01-01T00:00:00.000Z',
          actorId: 'retention-worker',
          protectedRecordIds: allRecords
            .filter((record) => record.id !== created.record.id)
            .map((record) => record.id)
        })
      })
    )
    const retainedRows = await test.d1
      .prepare(
        `SELECT c.id contact_id, c.normalized_value, o.name, o.normalized_email,
                o.normalized_phone, s.state_json
         FROM customer_directory_states s
         LEFT JOIN customer_contacts c ON c.merchant_id = s.merchant_id
         LEFT JOIN customer_observations o ON o.merchant_id = s.merchant_id
         WHERE s.merchant_id = ? AND (o.customer_record_id = ? OR o.id IS NULL)`
      )
      .bind('mer_customer_live', created.record.id)
      .all<Record<string, unknown>>()
    const retainedText = JSON.stringify(retainedRows.results)
    expect(retainedText).not.toContain('mara@example.com')
    expect(retainedText).not.toContain('Prefers quiet appointments')
    const erasedRow = await test.d1
      .prepare(`SELECT display_name, status FROM customer_records WHERE id = ?`)
      .bind(created.record.id)
      .first<{ display_name: string; status: string }>()
    expect(erasedRow).toEqual({ display_name: 'Erased customer', status: 'erased' })

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values({
            id: 'apt_after_erasure',
            merchantId: 'mer_customer_live',
            providerId: 'prv_customer_live',
            status: 'scheduled',
            startsAt: '2027-08-03T10:00:00.000Z',
            endsAt: '2027-08-03T11:00:00.000Z',
            createdAt: '2027-08-02T10:00:00.000Z',
            updatedAt: '2027-08-02T10:00:00.000Z'
          })
          const statements = yield* prepareAppointmentCustomerAssociation(db, {
            merchantId: 'mer_customer_live',
            appointment: {
              id: 'apt_after_erasure',
              details: {
                name: 'Mara Ionescu',
                email: 'mara@example.com',
                phone: null
              }
            },
            origin: 'public_booking',
            now: '2027-08-02T10:00:00.000Z'
          })
          yield* batch(db, statements)
        }),
        layerFromD1(test.d1)
      )
    )
    const recreated = await test.d1
      .prepare(
        `SELECT customer_record_id FROM appointment_foundations
         WHERE appointment_id = 'apt_after_erasure'`
      )
      .first<{ customer_record_id: string }>()
    expect(recreated?.customer_record_id).not.toBe(created.record.id)
  })

  it('moves relational Appointment associations through merge and split', async () => {
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(appointments).values([
            {
              id: 'apt_merge_left',
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'completed',
              startsAt: '2026-07-01T10:00:00.000Z',
              endsAt: '2026-07-01T11:00:00.000Z',
              createdAt: '2026-07-01T10:00:00.000Z',
              updatedAt: '2026-07-01T10:00:00.000Z'
            },
            {
              id: 'apt_merge_right',
              merchantId: 'mer_customer_live',
              providerId: 'prv_customer_live',
              status: 'completed',
              startsAt: '2026-07-02T10:00:00.000Z',
              endsAt: '2026-07-02T11:00:00.000Z',
              createdAt: '2026-07-02T10:00:00.000Z',
              updatedAt: '2026-07-02T10:00:00.000Z'
            }
          ])
          for (const [id, name, email] of [
            ['apt_merge_left', 'Alex Left', 'left@example.com'],
            ['apt_merge_right', 'Alex Right', 'right@example.com']
          ] as const) {
            const statements = yield* prepareAppointmentCustomerAssociation(db, {
              merchantId: 'mer_customer_live',
              appointment: { id, details: { name, email, phone: null } },
              origin: 'record_completed',
              actor: { merchantMemberId: 'usr_owner' },
              now: '2026-08-02T12:00:00.000Z'
            })
            yield* batch(db, statements)
          }
        }),
        layerFromD1(test.d1)
      )
    )

    const initialLinks = await test.d1
      .prepare(
        `SELECT appointment_id, customer_record_id FROM appointment_foundations
         WHERE appointment_id IN ('apt_merge_left','apt_merge_right')
         ORDER BY appointment_id`
      )
      .all<{ appointment_id: string; customer_record_id: string }>()
    await test.d1
      .prepare(
        `INSERT INTO customer_duplicate_suggestions
         (merchant_id, customer_record_id, possible_duplicate_id, created_at)
         VALUES ('mer_customer_live', ?, ?, ?)`
      )
      .bind(
        initialLinks.results[0]!.customer_record_id,
        initialLinks.results[1]!.customer_record_id,
        '2026-08-02T09:00:00.000Z'
      )
      .run()

    const result = await run(
      Effect.gen(function* () {
        const directory = yield* CustomerDirectory
        const left = (yield* directory.search('left@example.com'))[0]!
        const right = (yield* directory.search('right@example.com'))[0]!
        const merged = yield* directory.merge({
          survivorId: left.id,
          absorbedId: right.id,
          expectedSurvivorRevision: left.revision,
          expectedAbsorbedRevision: right.revision,
          idempotencyKey: 'merge-live-links',
          actorId: 'usr_owner',
          reason: 'Confirmed duplicate',
          now: '2026-08-02T13:00:00.000Z'
        })
        const moved = merged.observations.find(
          (observation) => observation.appointmentId === 'apt_merge_right'
        )!
        return yield* directory.split({
          sourceId: merged.id,
          observationIds: [moved.id],
          expectedRevision: merged.revision,
          idempotencyKey: 'split-live-links',
          actorId: 'usr_owner',
          reason: 'Mistaken merge',
          now: '2026-08-02T14:00:00.000Z'
        })
      })
    )

    const links = await test.d1
      .prepare(
        `SELECT appointment_id, customer_record_id FROM appointment_foundations
         WHERE appointment_id IN ('apt_merge_left','apt_merge_right')
         ORDER BY appointment_id`
      )
      .all<{ appointment_id: string; customer_record_id: string }>()
    expect(links.results).toEqual([
      {
        appointment_id: 'apt_merge_left',
        customer_record_id: result.source.id
      },
      {
        appointment_id: 'apt_merge_right',
        customer_record_id: result.created.id
      }
    ])
    const remainingSuggestions = await test.d1
      .prepare(
        `SELECT count(*) AS count FROM customer_duplicate_suggestions
         WHERE merchant_id = 'mer_customer_live'`
      )
      .first<{ count: number }>()
    expect(remainingSuggestions?.count).toBe(0)
  })

  it('rejects a contact whose Merchant does not own its Customer Record', async () => {
    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mer_customer_other', 'Other Studio', 'other-studio',
                 'Europe/Bucharest', 'RON', 'solo', ?, ?)`
      )
      .bind('2026-08-03T10:00:00.000Z', '2026-08-03T10:00:00.000Z')
      .run()
    await test.d1
      .prepare(
        `INSERT INTO customer_records
         (id, merchant_id, display_name, status, preferred_locale, revision,
          last_activity_at, created_at, updated_at)
         VALUES ('cur_customer_other', 'mer_customer_other', 'Other Customer',
                 'active', 'en', 1, ?, ?, ?)`
      )
      .bind(
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z'
      )
      .run()

    await expect(
      test.d1
        .prepare(
          `UPDATE customer_records SET merged_into = id
           WHERE id = 'cur_customer_other'`
        )
        .run()
    ).rejects.toThrow()
    const liveMerchantRecord = await test.d1
      .prepare(
        `SELECT id FROM customer_records
         WHERE merchant_id = 'mer_customer_live' LIMIT 1`
      )
      .first<{ id: string }>()
    await expect(
      test.d1
        .prepare(
          `UPDATE customer_records SET merged_into = ?
           WHERE id = 'cur_customer_other'`
        )
        .bind(liveMerchantRecord!.id)
        .run()
    ).rejects.toThrow()

    await expect(
      test.d1
        .prepare(
          `INSERT INTO customer_contacts
           (id, customer_record_id, merchant_id, kind, normalized_value, status,
            is_preferred, created_at, updated_at)
           VALUES ('cuc_cross_merchant', 'cur_customer_other', 'mer_customer_live',
                   'email', 'cross@example.com', 'active', 1, ?, ?)`
        )
        .bind('2026-08-03T10:00:00.000Z', '2026-08-03T10:00:00.000Z')
        .run()
    ).rejects.toThrow()

    await test.d1
      .prepare(
        `INSERT INTO customer_records
         (id, merchant_id, display_name, status, preferred_locale, revision,
          last_activity_at, created_at, updated_at)
         VALUES ('cur_customer_other_duplicate', 'mer_customer_other', 'Other Duplicate',
                 'active', 'en', 1, ?, ?, ?)`
      )
      .bind(
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z'
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO customer_bans
         (customer_record_id, merchant_id, reason, actor_id, created_at, expires_at)
         VALUES ('cur_customer_other', 'mer_customer_other', 'Private', 'usr_other', ?, NULL)`
      )
      .bind('2026-08-03T10:00:00.000Z')
      .run()
    await test.d1
      .prepare(
        `INSERT INTO customer_directory_history
         (id, merchant_id, customer_record_id, kind, actor_id, reason, revision, occurred_at)
         VALUES ('cuh_customer_other', 'mer_customer_other', 'cur_customer_other',
                 'created', 'usr_other', NULL, 1, ?)`
      )
      .bind('2026-08-03T10:00:00.000Z')
      .run()
    await test.d1
      .prepare(
        `INSERT INTO customer_duplicate_suggestions
         (merchant_id, customer_record_id, possible_duplicate_id, created_at)
         VALUES ('mer_customer_other', 'cur_customer_other',
                 'cur_customer_other_duplicate', ?)`
      )
      .bind('2026-08-03T10:00:00.000Z')
      .run()

    for (const statement of [
      `UPDATE customer_bans SET merchant_id = 'mer_customer_live'
       WHERE customer_record_id = 'cur_customer_other'`,
      `UPDATE customer_directory_history SET merchant_id = 'mer_customer_live'
       WHERE id = 'cuh_customer_other'`,
      `UPDATE customer_duplicate_suggestions SET merchant_id = 'mer_customer_live'
       WHERE customer_record_id = 'cur_customer_other'`
    ])
      await expect(test.d1.prepare(statement).run()).rejects.toThrow()
  })

  it('requires explicit Merchant policy to restore and use a banned archived record', async () => {
    await test.d1
      .prepare(
        `INSERT INTO customer_records
         (id, merchant_id, display_name, status, preferred_locale, revision,
          last_activity_at, created_at, updated_at)
         VALUES ('cur_archived_banned', 'mer_customer_live', 'Archived Customer',
                 'quarantined', 'en', 1, ?, ?, ?)`
      )
      .bind(
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z'
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO customer_contacts
         (id, customer_record_id, merchant_id, kind, normalized_value, status,
          is_preferred, created_at, updated_at)
         VALUES ('cuc_archived_banned', 'cur_archived_banned', 'mer_customer_live',
                 'email', 'archived@example.com', 'active', 1, ?, ?)`
      )
      .bind('2026-08-03T10:00:00.000Z', '2026-08-03T10:00:00.000Z')
      .run()
    await test.d1
      .prepare(
        `INSERT INTO customer_bans
         (customer_record_id, merchant_id, reason, actor_id, created_at, expires_at)
         VALUES ('cur_archived_banned', 'mer_customer_live', 'Private reason',
                 'usr_owner', ?, NULL)`
      )
      .bind('2026-08-03T10:00:00.000Z')
      .run()
    await test.d1
      .prepare(
        `INSERT INTO appointments
         (id, merchant_id, provider_id, status, starts_at, ends_at, created_at, updated_at)
         VALUES ('apt_archived_override', 'mer_customer_live', 'prv_customer_live',
                 'scheduled', ?, ?, ?, ?)`
      )
      .bind(
        '2026-08-04T10:00:00.000Z',
        '2026-08-04T11:00:00.000Z',
        '2026-08-03T10:00:00.000Z',
        '2026-08-03T10:00:00.000Z'
      )
      .run()

    const input = {
      merchantId: 'mer_customer_live',
      appointment: {
        id: 'apt_archived_override',
        details: {
          name: 'Archived Customer',
          email: 'archived@example.com',
          phone: null
        }
      },
      origin: 'merchant_created' as const,
      actor: { merchantMemberId: 'usr_owner' },
      now: '2026-08-03T11:00:00.000Z'
    }
    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const db = yield* Database
            return yield* prepareAppointmentCustomerAssociation(db, input)
          }),
          layerFromD1(test.d1)
        )
      )
    ).rejects.toMatchObject({ _tag: 'CapabilityUnavailable' })
    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const db = yield* Database
            return yield* prepareAppointmentCustomerAssociation(db, {
              ...input,
              merchantPolicy: { restoreArchived: true, allowBanned: true }
            })
          }),
          layerFromD1(test.d1)
        )
      )
    ).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable',
      reason: 'ban override reason is required'
    })

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          const statements = yield* prepareAppointmentCustomerAssociation(db, {
            ...input,
            merchantPolicy: {
              restoreArchived: true,
              allowBanned: true,
              banOverrideReason: 'Owner approved this booking despite the ban'
            }
          })
          yield* batch(db, statements)
        }),
        layerFromD1(test.d1)
      )
    )
    const replayStatements = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          return yield* prepareAppointmentCustomerAssociation(db, {
            ...input,
            merchantPolicy: {
              restoreArchived: true,
              allowBanned: true,
              banOverrideReason: 'Owner approved this booking despite the ban'
            }
          })
        }),
        layerFromD1(test.d1)
      )
    )
    expect(replayStatements).toEqual([])
    const restored = await test.d1
      .prepare(`SELECT status FROM customer_records WHERE id = 'cur_archived_banned'`)
      .first<{ status: string }>()
    expect(restored?.status).toBe('active')
    const overrideHistory = await test.d1
      .prepare(
        `SELECT reason FROM customer_directory_history
         WHERE id = 'cuh_apt_archived_override'`
      )
      .first<{ reason: string }>()
    expect(overrideHistory?.reason).toBe('Owner approved this booking despite the ban')
  })
})
