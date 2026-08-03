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
    const formattedPhoneSearch = await execute(
      'mer_one',
      Effect.flatMap(CustomerDirectory, (service) => service.search('+40.721.234.567'))
    )

    expect(matched.record.id).toBe(first.record.id)
    expect(conflict.record.id).not.toBe(first.record.id)
    expect(conflict.record.possibleDuplicateOf).toEqual([
      first.record.id,
      phoneOwner.record.id
    ])
    expect(otherMerchant.record.id).not.toBe(first.record.id)
    expect(formattedPhoneSearch.map(({ id }) => id)).toContain(first.record.id)
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

  it('keeps archived records discoverable only for Owner restore workflows', async () => {
    const result = await run(
      'mer_archived_restore',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_archived_restore',
          details: observation(),
          now: '2026-08-02T10:00:00.000Z'
        })
        const archived = yield* service.archive(created.record.id, {
          expectedRevision: created.record.revision,
          idempotencyKey: 'archive-for-restore',
          actorId: 'usr_owner',
          archived: true,
          now: '2026-08-02T11:00:00.000Z'
        })
        return {
          archived,
          activeSearch: yield* service.search('ana@example.com'),
          ownerSearch: yield* service.search('ana@example.com', {
            includeArchived: true
          })
        }
      })
    )

    expect(result.activeSearch).toEqual([])
    expect(result.ownerSearch).toEqual([result.archived])
  })

  it('searches prior names without exposing superseded destinations', async () => {
    const result = await run(
      'mer_historical_search',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_historical_search',
          details: observation({
            name: 'Previous Name',
            email: 'previous@example.com',
            phone: null
          }),
          now: '2026-08-02T10:00:00.000Z'
        })
        const edited = yield* service.editPreferred(created.record.id, {
          expectedRevision: created.record.revision,
          idempotencyKey: 'edit-historical-search',
          actorId: 'usr_owner',
          name: 'Current Name',
          email: 'current@example.com',
          phone: null,
          now: '2026-08-03T10:00:00.000Z'
        })
        return {
          edited,
          byPriorName: yield* service.search('previous name'),
          byPriorEmail: yield* service.search('previous@example.com')
        }
      })
    )

    expect(result.byPriorName.map(({ id }) => id)).toEqual([result.edited.id])
    expect(result.byPriorEmail).toEqual([])
    expect(
      result.edited.contacts.find(({ value }) => value === 'previous@example.com')
    ).toMatchObject({ status: 'superseded', preferred: false })
  })

  it('keeps preferred fields aligned when a historical contact is reactivated', async () => {
    const result = await run(
      'mer_contact_preference',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_contact_preference',
          details: observation({ email: 'old@example.com', phone: null }),
          now: '2026-08-01T10:00:00.000Z'
        })
        const edited = yield* service.editPreferred(created.record.id, {
          expectedRevision: created.record.revision,
          idempotencyKey: 'edit-contact-preference',
          actorId: 'usr_owner',
          name: 'Ana Popescu',
          email: 'new@example.com',
          phone: null,
          now: '2026-08-02T10:00:00.000Z'
        })
        return yield* service.setContactStatus(created.record.id, {
          expectedRevision: edited.revision,
          idempotencyKey: 'reactivate-contact-preference',
          actorId: 'usr_owner',
          kind: 'email',
          value: 'old@example.com',
          status: 'active',
          preferred: true,
          now: '2026-08-03T10:00:00.000Z'
        })
      })
    )

    expect(result.preferredEmail).toBe('old@example.com')
    expect(
      result.contacts.find((contact) => contact.value === 'old@example.com')
    ).toMatchObject({ status: 'active', preferred: true })
    expect(
      result.contacts.find((contact) => contact.value === 'new@example.com')
    ).toMatchObject({ preferred: false })
  })

  it('rejects preferring a destination without contact evidence', async () => {
    const result = await run(
      'mer_missing_contact_preference',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_missing_contact_preference',
          details: observation({ email: 'known@example.com', phone: null }),
          now: '2026-08-01T10:00:00.000Z'
        })
        const failure = yield* Effect.flip(
          service.setContactStatus(created.record.id, {
            expectedRevision: created.record.revision,
            idempotencyKey: 'prefer-missing-contact',
            actorId: 'usr_owner',
            kind: 'email',
            value: 'invented@example.com',
            status: 'active',
            preferred: true,
            now: '2026-08-02T10:00:00.000Z'
          })
        )
        return {
          failure,
          record: yield* service.get(created.record.id)
        }
      })
    )

    expect(result.failure).toMatchObject({
      _tag: 'CapabilityNotFound',
      resource: 'customer-contact'
    })
    expect(result.record).toMatchObject({
      revision: 1,
      preferredEmail: 'known@example.com'
    })
  })

  it('replays a contact-status command after the contact moves in a split', async () => {
    const result = await run(
      'mer_contact_status_replay_after_split',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_contact_status_source',
          details: observation({ email: 'ana@example.com', phone: null }),
          now: '2026-08-01T10:00:00.000Z'
        })
        const matched = yield* service.matchOrCreate({
          appointmentId: 'apt_contact_status_moved',
          details: observation({ email: 'ana@example.com', phone: '+40722000000' }),
          now: '2026-08-02T10:00:00.000Z'
        })
        const command = {
          expectedRevision: matched.record.revision,
          idempotencyKey: 'prefer-phone-before-split',
          actorId: 'usr_owner',
          kind: 'phone' as const,
          value: '+40722000000',
          status: 'active' as const,
          preferred: true,
          now: '2026-08-02T11:00:00.000Z'
        }
        const first = yield* service.setContactStatus(created.record.id, command)
        const split = yield* service.split({
          sourceId: created.record.id,
          observationIds: [matched.record.observations.at(-1)!.id],
          expectedRevision: first.revision,
          idempotencyKey: 'move-phone-contact',
          actorId: 'usr_owner',
          createdDetails: {
            ...matched.record.observations.at(-1)!.details,
            email: null
          },
          contactKeys: [{ kind: 'phone', value: '+40722000000' }],
          reason: 'Observation belongs to another customer',
          now: '2026-08-03T10:00:00.000Z'
        })
        return {
          first,
          replay: yield* service.setContactStatus(created.record.id, command),
          source: split.source
        }
      })
    )

    expect(result.replay).toEqual(result.source)
    expect(result.source.contacts).not.toContainEqual(
      expect.objectContaining({ kind: 'phone', value: '+40722000000' })
    )
  })

  it('reconciles same-destination contact statuses before merge persistence', async () => {
    const result = await run(
      'mer_merge_contact_statuses',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const survivor = yield* service.matchOrCreate({
          appointmentId: 'apt_merge_contact_survivor',
          details: observation({ email: 'shared@example.com', phone: null }),
          now: '2026-08-01T10:00:00.000Z'
        })
        const absorbed = yield* service.matchOrCreate({
          appointmentId: 'apt_merge_contact_absorbed',
          details: observation({ email: 'absorbed@example.com', phone: null }),
          now: '2026-08-01T11:00:00.000Z'
        })
        const shared = yield* service.editPreferred(absorbed.record.id, {
          expectedRevision: absorbed.record.revision,
          idempotencyKey: 'edit-absorbed-shared-contact',
          actorId: 'usr_owner',
          name: 'Ana Duplicate',
          email: 'shared@example.com',
          phone: null,
          now: '2026-08-02T10:00:00.000Z'
        })
        const disputed = yield* service.setContactStatus(absorbed.record.id, {
          expectedRevision: shared.revision,
          idempotencyKey: 'dispute-absorbed-shared-contact',
          actorId: 'usr_owner',
          kind: 'email',
          value: 'shared@example.com',
          status: 'disputed',
          preferred: false,
          now: '2026-08-02T11:00:00.000Z'
        })
        return yield* service.merge({
          survivorId: survivor.record.id,
          absorbedId: absorbed.record.id,
          expectedSurvivorRevision: survivor.record.revision,
          expectedAbsorbedRevision: disputed.revision,
          idempotencyKey: 'merge-same-contact-statuses',
          actorId: 'usr_owner',
          reason: 'Same customer confirmed',
          now: '2026-08-03T10:00:00.000Z'
        })
      })
    )

    expect(
      result.contacts.filter(
        (contact) => contact.kind === 'email' && contact.value === 'shared@example.com'
      )
    ).toEqual([expect.objectContaining({ status: 'active', preferred: true })])
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
        const noted = yield* service.addNote(right.record.id, {
          expectedRevision: right.record.revision,
          idempotencyKey: 'note-right',
          actorId: 'usr_owner',
          text: 'Belongs with the phone observation',
          now: '2026-08-02T11:00:00.000Z'
        })
        const consented = yield* service.recordConsent(right.record.id, {
          expectedRevision: noted.revision,
          idempotencyKey: 'consent-right',
          actorId: 'usr_owner',
          purpose: 'operational_mobile',
          destination: '+40722000000',
          wordingVersion: 'v1',
          source: 'merchant_directory',
          withdrawn: false,
          now: '2026-08-02T12:00:00.000Z'
        })
        const merged = yield* service.merge({
          survivorId: left.record.id,
          absorbedId: right.record.id,
          expectedSurvivorRevision: 1,
          expectedAbsorbedRevision: consented.revision,
          idempotencyKey: 'merge-1',
          actorId: 'usr_owner',
          preferredDetailsSourceId: right.record.id,
          reason: 'Same customer confirmed',
          now: '2026-08-03T10:00:00.000Z'
        })
        const implicitContactSplit = yield* Effect.flip(
          service.split({
            sourceId: merged.id,
            observationIds: [right.record.observations[0]!.id],
            expectedRevision: merged.revision,
            idempotencyKey: 'split-implicit-contact',
            actorId: 'usr_owner',
            contactKeys: [{ kind: 'phone', value: '+40722000000' }],
            consentIds: [consented.consent[0]!.id],
            reason: 'Merge was mistaken',
            now: '2026-08-04T10:00:00.000Z'
          })
        )
        const inconsistentSplit = yield* Effect.flip(
          service.split({
            sourceId: merged.id,
            observationIds: [right.record.observations[0]!.id],
            expectedRevision: merged.revision,
            idempotencyKey: 'split-inconsistent-consent',
            actorId: 'usr_owner',
            createdDetails: right.record.observations[0]!.details,
            contactKeys: [{ kind: 'phone', value: '+40722000000' }],
            consentIds: [],
            reason: 'Merge was mistaken',
            now: '2026-08-04T10:00:00.000Z'
          })
        )
        const split = yield* service.split({
          sourceId: merged.id,
          observationIds: [right.record.observations[0]!.id],
          expectedRevision: merged.revision,
          idempotencyKey: 'split-1',
          actorId: 'usr_owner',
          createdDetails: right.record.observations[0]!.details,
          contactKeys: [{ kind: 'phone', value: '+40722000000' }],
          noteIds: [consented.notes[0]!.id],
          consentIds: [consented.consent[0]!.id],
          reason: 'Merge was mistaken',
          now: '2026-08-04T10:00:00.000Z'
        })
        const replayedSplit = yield* service.split({
          sourceId: merged.id,
          observationIds: [right.record.observations[0]!.id],
          expectedRevision: merged.revision,
          idempotencyKey: 'split-1',
          actorId: 'usr_owner',
          createdDetails: right.record.observations[0]!.details,
          contactKeys: [{ kind: 'phone', value: '+40722000000' }],
          noteIds: [consented.notes[0]!.id],
          consentIds: [consented.consent[0]!.id],
          reason: 'Merge was mistaken',
          now: '2026-08-04T10:00:00.000Z'
        })
        return {
          merged,
          implicitContactSplit,
          inconsistentSplit,
          split,
          replayedSplit
        }
      })
    )
    expect(result.merged.observations).toHaveLength(2)
    expect(result.merged).toMatchObject({
      displayName: 'Ana Popescu',
      preferredEmail: null,
      preferredPhone: '+40722000000'
    })
    expect(result.inconsistentSplit).toMatchObject({
      _tag: 'CustomerDirectoryInvalid',
      reason: 'invalid_split_assignment'
    })
    expect(result.implicitContactSplit).toMatchObject({
      _tag: 'CustomerDirectoryInvalid',
      reason: 'invalid_split_assignment'
    })
    expect(result.split.source.observations.map((item) => item.appointmentId)).toEqual([
      'apt_left'
    ])
    expect(result.split.created.observations.map((item) => item.appointmentId)).toEqual(
      ['apt_right']
    )
    expect(result.split.created.history[0]?.kind).toBe('split')
    expect(result.split.created).toMatchObject({
      preferredEmail: null,
      preferredPhone: '+40722000000'
    })
    expect(result.split.created.notes).toHaveLength(1)
    expect(result.split.created.consent).toHaveLength(1)
    expect(result.split.source.notes).toHaveLength(0)
    expect(result.split.source.consent).toHaveLength(0)
    expect(result.split.source.contacts).toEqual([
      expect.objectContaining({ kind: 'email', value: 'ana@example.com' })
    ])
    expect(result.split.created.contacts).toEqual([
      expect.objectContaining({
        kind: 'phone',
        value: '+40722000000',
        preferred: true
      })
    ])
    expect(result.replayedSplit).toEqual(result.split)
  })

  it('previews idempotent imports and rejects stale owner mutations safely', async () => {
    const result = await run(
      'mer_import',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const rows = [
          {
            ...observation({ name: 'Imported One', phone: null }),
            externalReference: 'crm-row-1'
          },
          observation({ name: '', email: 'invalid', phone: null })
        ]
        const preview = yield* service.previewImport(rows)
        const committed = yield* service.importRows({
          fileId: 'file-1',
          idempotencyKey: 'retry-with-new-command-key',
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
        const rowReplay = yield* service.importRows({
          fileId: 'file-2',
          idempotencyKey: 'second-file-same-row',
          expectedRevisions: { [record.id]: record.revision },
          rows: [rows[0]!],
          actorId: 'usr_owner',
          now: '2026-08-02T10:30:00.000Z'
        })
        const changedRowReplay = yield* Effect.result(
          service.importRows({
            fileId: 'file-3',
            idempotencyKey: 'changed-external-row',
            expectedRevisions: { [record.id]: record.revision },
            rows: [{ ...rows[0]!, name: 'Changed Imported Name' }],
            actorId: 'usr_owner',
            now: '2026-08-02T10:45:00.000Z'
          })
        )
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
          rowReplay,
          changedRowReplay,
          changed,
          stale,
          exported: yield* service.exportMinimized()
        }
      })
    )

    expect(result.preview.map((row) => row.outcome)).toEqual(['create', 'invalid'])
    expect(result.committed).toEqual({ created: 1, matched: 0, rejected: 1 })
    expect(result.replay).toEqual(result.committed)
    expect(result.rowReplay).toEqual({ created: 0, matched: 1, rejected: 0 })
    expect(result.changedRowReplay).toMatchObject({
      _tag: 'Failure',
      failure: expect.objectContaining({ reason: 'idempotency_key_reused' })
    })
    expect(result.stale._tag).toBe('Failure')
    expect(result.changed.ban).toBeNull()
    expect(result.exported[0]).not.toHaveProperty('notes')
    expect(result.changed.observations[0]).toMatchObject({
      appointmentId: null,
      source: 'import'
    })
  })

  it('binds idempotency to immutable payloads and rejects self-merge', async () => {
    const result = await run(
      'mer_idempotency_payloads',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_payload_binding',
          details: observation({ name: 'Current Preferred', phone: null }),
          now: '2026-08-01T10:00:00.000Z'
        })
        const noted = yield* service.addNote(created.record.id, {
          expectedRevision: created.record.revision,
          idempotencyKey: 'same-note-command',
          actorId: 'usr_owner',
          text: 'First note',
          now: '2026-08-01T11:00:00.000Z'
        })
        const changedPayload = yield* Effect.result(
          service.addNote(created.record.id, {
            expectedRevision: created.record.revision,
            idempotencyKey: 'same-note-command',
            actorId: 'usr_owner',
            text: 'Different note',
            now: '2026-08-01T11:00:00.000Z'
          })
        )
        const row = {
          name: 'Old CRM Name',
          email: 'ana@example.com',
          phone: null,
          externalReference: 'crm-customer-42'
        }
        yield* service.importRows({
          fileId: 'crm-file-original',
          idempotencyKey: 'crm-import-original',
          expectedRevisions: { [created.record.id]: noted.revision },
          rows: [row],
          actorId: 'usr_owner',
          now: '2026-08-01T12:00:00.000Z'
        })
        const imported = yield* service.get(created.record.id)
        const edited = yield* service.editPreferred(created.record.id, {
          expectedRevision: imported.revision,
          idempotencyKey: 'edit-after-import',
          actorId: 'usr_owner',
          name: 'Owner Corrected Name',
          email: 'ana@example.com',
          phone: null,
          now: '2026-08-01T13:00:00.000Z'
        })
        const identicalRowReplay = yield* service.importRows({
          fileId: 'crm-file-reupload',
          idempotencyKey: 'crm-import-reupload',
          expectedRevisions: { [created.record.id]: edited.revision },
          rows: [row],
          actorId: 'usr_owner',
          now: '2026-08-01T14:00:00.000Z'
        })
        const selfMerge = yield* Effect.result(
          service.merge({
            survivorId: created.record.id,
            absorbedId: created.record.id,
            expectedSurvivorRevision: edited.revision,
            expectedAbsorbedRevision: edited.revision,
            idempotencyKey: 'self-merge',
            actorId: 'usr_owner',
            reason: 'Invalid duplicate selection',
            now: '2026-08-01T15:00:00.000Z'
          })
        )
        return { changedPayload, identicalRowReplay, selfMerge }
      })
    )

    expect(result.changedPayload).toMatchObject({
      _tag: 'Failure',
      failure: expect.objectContaining({ reason: 'idempotency_key_reused' })
    })
    expect(result.identicalRowReplay).toEqual({ created: 0, matched: 1, rejected: 0 })
    expect(result.selfMerge).toMatchObject({
      _tag: 'Failure',
      failure: expect.objectContaining({ reason: 'merge_records_must_be_distinct' })
    })
  })

  it('keeps erased and merged records terminal and removes directory PII', async () => {
    const result = await run(
      'mer_terminal_records',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_terminal',
          details: observation({ email: 'erase@example.com', phone: '+40722000000' }),
          now: '2026-01-01T10:00:00.000Z'
        })
        const noted = yield* service.addNote(created.record.id, {
          expectedRevision: created.record.revision,
          idempotencyKey: 'terminal-note',
          actorId: 'usr_owner',
          text: 'Sensitive note',
          now: '2026-01-01T11:00:00.000Z'
        })
        yield* service.eraseExpired({
          idempotencyKey: 'erase-terminal',
          expectedRevisions: { [noted.id]: noted.revision },
          now: '2026-08-03T10:00:00.000Z',
          inactiveBefore: '2026-02-01T00:00:00.000Z',
          actorId: 'retention-worker'
        })
        const erased = yield* service.get(noted.id)
        return {
          erased,
          replay: yield* service.addNote(created.record.id, {
            expectedRevision: created.record.revision,
            idempotencyKey: 'terminal-note',
            actorId: 'usr_owner',
            text: 'Sensitive note',
            now: '2026-01-01T11:00:00.000Z'
          }),
          restore: yield* Effect.result(
            service.archive(erased.id, {
              expectedRevision: erased.revision,
              idempotencyKey: 'restore-erased',
              actorId: 'usr_owner',
              archived: false,
              now: '2026-08-03T11:00:00.000Z'
            })
          )
        }
      })
    )

    expect(result.erased).toMatchObject({
      status: 'erased',
      displayName: 'Erased customer',
      contacts: [],
      notes: [],
      consent: []
    })
    expect(result.erased.observations[0]?.details).toEqual({
      name: 'Erased customer',
      email: null,
      phone: null
    })
    expect(result.replay).toEqual(result.erased)
    expect(result.restore).toMatchObject({
      _tag: 'Failure',
      failure: expect.objectContaining({ reason: 'invalid_record_status' })
    })
  })

  it('rejects blank audit reasons at the capability boundary', async () => {
    const result = await run(
      'mer_reason_required',
      Effect.gen(function* () {
        const service = yield* CustomerDirectory
        const created = yield* service.matchOrCreate({
          appointmentId: 'apt_reason_required',
          details: observation(),
          now: '2026-08-03T10:00:00.000Z'
        })
        return yield* Effect.result(
          service.setBan(created.record.id, {
            expectedRevision: created.record.revision,
            idempotencyKey: 'blank-reason',
            actorId: 'usr_owner',
            reason: '   ',
            expiresAt: null,
            now: '2026-08-03T11:00:00.000Z'
          })
        )
      })
    )

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: expect.objectContaining({ reason: 'reason_required' })
    })
  })
})
