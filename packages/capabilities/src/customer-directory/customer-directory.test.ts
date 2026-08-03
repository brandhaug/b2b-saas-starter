import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import {
  CustomerDirectory,
  SeedCustomerDirectory,
  emptySeedCustomerDirectoryStore
} from './customer-directory.ts'

const merchantContext = (id: string) =>
  Layer.succeed(MerchantContext)({
    id,
    publicName: id,
    slug: id,
    timezone: 'Europe/Bucharest',
    currency: 'RON',
    plan: 'solo'
  })
const run = <A, E>(
  merchantId: string,
  effect: Effect.Effect<A, E, CustomerDirectory | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(
        SeedCustomerDirectory(emptySeedCustomerDirectoryStore()),
        merchantContext(merchantId)
      )
    )
  )

const observation = (
  overrides: Partial<{ name: string; email: string | null; phone: string | null }> = {}
) => ({
  name: 'Ana Popescu',
  email: ' ANA@Example.COM ',
  phone: '+40 721 234 567',
  ...overrides
})

describe('Customer Directory contract', () => {
  it('matches only one exact non-conflicting contact inside one Merchant', async () => {
    const store = emptySeedCustomerDirectoryStore()
    const layer = SeedCustomerDirectory(store)
    const execute = <A, E>(
      merchantId: string,
      effect: Effect.Effect<A, E, CustomerDirectory | MerchantContext>
    ) =>
      Effect.runPromise(
        Effect.provide(effect, Layer.merge(layer, merchantContext(merchantId)))
      )

    const first = await execute(
      'mer_one',
      Effect.flatMap(CustomerDirectory, (service) =>
        service.matchOrCreate({
          appointmentId: 'apt_1',
          details: observation(),
          now: '2026-08-02T10:00:00.000Z'
        })
      )
    )
    const matched = await execute(
      'mer_one',
      Effect.flatMap(CustomerDirectory, (service) =>
        service.matchOrCreate({
          appointmentId: 'apt_2',
          details: observation({ name: 'Ana P.' }),
          now: '2026-08-03T10:00:00.000Z'
        })
      )
    )
    const phoneOwner = await execute(
      'mer_one',
      Effect.flatMap(CustomerDirectory, (service) =>
        service.matchOrCreate({
          appointmentId: 'apt_phone',
          details: observation({ email: null, phone: '+40 722 000 000' }),
          now: '2026-08-04T09:00:00.000Z'
        })
      )
    )
    const conflict = await execute(
      'mer_one',
      Effect.flatMap(CustomerDirectory, (service) =>
        service.matchOrCreate({
          appointmentId: 'apt_3',
          details: observation({ phone: '+40 722 000 000' }),
          now: '2026-08-04T10:00:00.000Z'
        })
      )
    )
    const otherMerchant = await execute(
      'mer_two',
      Effect.flatMap(CustomerDirectory, (service) =>
        service.matchOrCreate({
          appointmentId: 'apt_4',
          details: observation(),
          now: '2026-08-04T10:00:00.000Z'
        })
      )
    )

    expect(matched.record.id).toBe(first.record.id)
    expect(conflict.record.id).not.toBe(first.record.id)
    expect(conflict.record.possibleDuplicateOf).toEqual([
      first.record.id,
      phoneOwner.record.id
    ])
    expect(otherMerchant.record.id).not.toBe(first.record.id)
    expect(first.record.observations[0]?.details).toEqual({
      name: 'Ana Popescu',
      email: 'ana@example.com',
      phone: '+40721234567'
    })
  })

  it('never matches name-only observations and preserves appointment snapshots externally', async () => {
    const result = await run(
      'mer_name',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const first = yield* service.matchOrCreate({
          appointmentId: 'apt_a',
          details: observation({ email: null, phone: null }),
          now: '2026-08-02T10:00:00.000Z'
        })
        const second = yield* service.matchOrCreate({
          appointmentId: 'apt_b',
          details: observation({ email: null, phone: null }),
          now: '2026-08-03T10:00:00.000Z'
        })
        return { first, second }
      })
    )
    expect(result.second.record.id).not.toBe(result.first.record.id)
  })

  it('enforces bans generically and keeps private reasons owner-only', async () => {
    const result = await run(
      'mer_ban',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_ban',
          details: observation(),
          now: '2026-08-02T10:00:00.000Z'
        })
        yield* service.setBan(created.record.id, {
          expectedRevision: 1,
          idempotencyKey: 'ban-1',
          actorId: 'usr_owner',
          reason: 'Repeated abuse',
          expiresAt: null,
          now: '2026-08-02T11:00:00.000Z'
        })
        return {
          publicResult: yield* service.checkPublicEligibility(
            observation(),
            '2026-08-02T12:00:00.000Z'
          ),
          search: yield* service.search('ana@example.com')
        }
      })
    )
    expect(result.publicResult).toEqual({ kind: 'unavailable' })
    expect(result.search[0]?.ban?.reason).toBe('Repeated abuse')
  })

  it('merges and splits with provenance without changing observations', async () => {
    const result = await run(
      'mer_merge',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const left = yield* service.matchOrCreate({
          appointmentId: 'apt_left',
          details: observation({ phone: null }),
          now: '2026-08-01T10:00:00.000Z'
        })
        const right = yield* service.matchOrCreate({
          appointmentId: 'apt_right',
          details: observation({ email: null, phone: '+40722000000' }),
          now: '2026-08-02T10:00:00.000Z'
        })
        const merged = yield* service.merge({
          survivorId: left.record.id,
          absorbedId: right.record.id,
          expectedSurvivorRevision: 1,
          expectedAbsorbedRevision: 1,
          idempotencyKey: 'merge-1',
          actorId: 'usr_owner',
          reason: 'Same customer confirmed',
          now: '2026-08-03T10:00:00.000Z'
        })
        const split = yield* service.split({
          sourceId: merged.id,
          observationIds: [right.record.observations[0]!.id],
          expectedRevision: merged.revision,
          idempotencyKey: 'split-1',
          actorId: 'usr_owner',
          reason: 'Merge was mistaken',
          now: '2026-08-04T10:00:00.000Z'
        })
        const replayedSplit = yield* service.split({
          sourceId: merged.id,
          observationIds: [right.record.observations[0]!.id],
          expectedRevision: merged.revision,
          idempotencyKey: 'split-1',
          actorId: 'usr_owner',
          reason: 'Merge was mistaken',
          now: '2026-08-04T10:00:00.000Z'
        })
        return { merged, split, replayedSplit }
      })
    )
    expect(result.merged.observations).toHaveLength(2)
    expect(result.split.source.observations.map((item) => item.appointmentId)).toEqual([
      'apt_left'
    ])
    expect(result.split.created.observations.map((item) => item.appointmentId)).toEqual(
      ['apt_right']
    )
    expect(result.split.created.history[0]?.kind).toBe('split')
    expect(result.replayedSplit).toEqual(result.split)
  })

  it('previews idempotent imports and rejects stale owner mutations safely', async () => {
    const result = await run(
      'mer_import',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const rows = [
          observation({ name: 'Imported One', phone: null }),
          observation({ name: '', email: 'invalid', phone: null })
        ]
        const preview = yield* service.previewImport(rows)
        const committed = yield* service.importRows({
          fileId: 'file-1',
          idempotencyKey: 'import-file-1',
          expectedRevisions: {},
          rows,
          actorId: 'usr_owner',
          now: '2026-08-02T10:00:00.000Z'
        })
        const replay = yield* service.importRows({
          fileId: 'file-1',
          idempotencyKey: 'import-file-1',
          expectedRevisions: {},
          rows,
          actorId: 'usr_owner',
          now: '2026-08-02T10:00:00.000Z'
        })
        const record = (yield* service.search('imported one'))[0]!
        const changed = yield* service.addNote(record.id, {
          expectedRevision: record.revision,
          idempotencyKey: 'note-import',
          actorId: 'usr_owner',
          text: 'Private',
          now: '2026-08-02T11:00:00.000Z'
        })
        const stale = yield* Effect.result(
          service.setBan(record.id, {
            expectedRevision: record.revision,
            idempotencyKey: 'stale-ban',
            actorId: 'usr_owner',
            reason: 'Must not apply',
            expiresAt: null,
            now: '2026-08-02T12:00:00.000Z'
          })
        )
        return {
          preview,
          committed,
          replay,
          changed,
          stale,
          exported: yield* service.exportMinimized()
        }
      })
    )

    expect(result.preview.map((row) => row.outcome)).toEqual(['create', 'invalid'])
    expect(result.committed).toEqual({ created: 1, matched: 0, rejected: 1 })
    expect(result.replay).toEqual(result.committed)
    expect(result.stale._tag).toBe('Failure')
    expect(result.changed.ban).toBeNull()
    expect(result.exported[0]).not.toHaveProperty('notes')
    expect(result.changed.observations[0]).toMatchObject({
      appointmentId: null,
      source: 'import'
    })
  })
})
