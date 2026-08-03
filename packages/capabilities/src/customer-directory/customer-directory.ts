import { Context, Effect, Layer, Schema } from 'effect'
import {
  CapabilityConflict,
  CapabilityNotFound,
  CapabilityUnavailable
} from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'

export type DirectoryCustomerDetails = {
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
}
export type CustomerObservation = {
  readonly id: string
  readonly appointmentId: string | null
  readonly details: DirectoryCustomerDetails
  readonly observedAt: string
  readonly source: 'appointment' | 'import'
}
export type CustomerContact = {
  readonly kind: 'email' | 'phone'
  readonly value: string
  readonly status: 'active' | 'disputed' | 'superseded'
  readonly preferred: boolean
}
export type MerchantNote = {
  readonly id: string
  readonly text: string
  readonly actorId: string
  readonly createdAt: string
  readonly editedAt: string | null
}
export type CustomerBan = {
  readonly reason: string
  readonly actorId: string
  readonly createdAt: string
  readonly expiresAt: string | null
}
export type ConsentEvidence = {
  readonly id: string
  readonly purpose: 'operational_mobile' | 'marketing'
  readonly destination: string
  readonly wordingVersion: string
  readonly source: string
  readonly grantedAt: string
  readonly withdrawnAt: string | null
}
export type CustomerHistory = {
  readonly id: string
  readonly kind:
    | 'created'
    | 'edited'
    | 'note_added'
    | 'banned'
    | 'ban_lifted'
    | 'merged'
    | 'split'
    | 'archived'
    | 'restored'
    | 'erased'
    | 'imported'
    | 'appointment_observed'
  readonly actorId: string
  readonly impersonatedBy?: string | null
  readonly reason: string | null
  readonly at: string
  readonly revision: number
}
export type CustomerRecord = {
  readonly id: string
  readonly merchantId: string
  readonly status: 'active' | 'archived' | 'merged' | 'erased'
  readonly displayName: string
  readonly preferredEmail: string | null
  readonly preferredPhone: string | null
  readonly contacts: readonly CustomerContact[]
  readonly observations: readonly CustomerObservation[]
  readonly notes: readonly MerchantNote[]
  readonly consent: readonly ConsentEvidence[]
  readonly ban: CustomerBan | null
  readonly possibleDuplicateOf: readonly string[]
  readonly mergedInto: string | null
  readonly revision: number
  readonly lastActivityAt: string
  readonly history: readonly CustomerHistory[]
}

export class CustomerDirectoryInvalid extends Schema.TaggedErrorClass<CustomerDirectoryInvalid>()(
  'CustomerDirectoryInvalid',
  {
    reason: Schema.Literals([
      'invalid_name',
      'invalid_email',
      'invalid_phone',
      'empty_split',
      'invalid_split_assignment',
      'invalid_import'
    ])
  }
) {}

export type CustomerDirectoryError =
  | CustomerDirectoryInvalid
  | CapabilityConflict
  | CapabilityNotFound
  | CapabilityUnavailable
type Mutation = {
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly actorId: string
  readonly now: string
}
type MatchInput = {
  readonly appointmentId: string | null
  readonly details: DirectoryCustomerDetails
  readonly now: string
  readonly source?: 'appointment' | 'import'
  readonly actorId?: string
}
type MergeInput = {
  readonly survivorId: string
  readonly absorbedId: string
  readonly expectedSurvivorRevision: number
  readonly expectedAbsorbedRevision: number
  readonly idempotencyKey: string
  readonly actorId: string
  readonly preferredDetailsSourceId?: string
  readonly reason: string
  readonly now: string
}
type SplitInput = {
  readonly sourceId: string
  readonly observationIds: readonly string[]
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly actorId: string
  readonly createdDetails?: DirectoryCustomerDetails
  readonly contactKeys?: readonly {
    readonly kind: 'email' | 'phone'
    readonly value: string
  }[]
  readonly noteIds?: readonly string[]
  readonly consentIds?: readonly string[]
  readonly reason: string
  readonly now: string
}

export type CustomerDirectoryShape = {
  readonly matchOrCreate: (
    input: MatchInput
  ) => Effect.Effect<
    { readonly record: CustomerRecord; readonly matched: boolean },
    CustomerDirectoryError,
    MerchantContext
  >
  readonly checkPublicEligibility: (
    details: DirectoryCustomerDetails,
    now: string
  ) => Effect.Effect<
    { readonly kind: 'eligible' } | { readonly kind: 'unavailable' },
    CustomerDirectoryError,
    MerchantContext
  >
  readonly search: (
    query: string
  ) => Effect.Effect<readonly CustomerRecord[], CustomerDirectoryError, MerchantContext>
  readonly get: (
    recordId: string
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly editPreferred: (
    recordId: string,
    input: Mutation & {
      readonly name: string
      readonly email: string | null
      readonly phone: string | null
    }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly addNote: (
    recordId: string,
    input: Mutation & { readonly text: string }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly setContactStatus: (
    recordId: string,
    input: Mutation & {
      readonly kind: 'email' | 'phone'
      readonly value: string
      readonly status: 'active' | 'disputed' | 'superseded'
      readonly preferred: boolean
    }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly recordConsent: (
    recordId: string,
    input: Mutation & {
      readonly purpose: ConsentEvidence['purpose']
      readonly destination: string
      readonly wordingVersion: string
      readonly source: string
      readonly withdrawn: boolean
    }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly setBan: (
    recordId: string,
    input: Mutation & { readonly reason: string; readonly expiresAt: string | null }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly liftBan: (
    recordId: string,
    input: Mutation & { readonly reason: string }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly merge: (
    input: MergeInput
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly split: (
    input: SplitInput
  ) => Effect.Effect<
    { readonly source: CustomerRecord; readonly created: CustomerRecord },
    CustomerDirectoryError,
    MerchantContext
  >
  readonly archive: (
    recordId: string,
    input: Mutation & { readonly archived: boolean }
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly previewImport: (rows: readonly DirectoryCustomerDetails[]) => Effect.Effect<
    readonly {
      readonly row: number
      readonly normalized: DirectoryCustomerDetails
      readonly outcome: 'create' | 'exact_match' | 'possible_duplicate' | 'invalid'
    }[],
    CustomerDirectoryError,
    MerchantContext
  >
  readonly importRows: (input: {
    readonly fileId: string
    readonly idempotencyKey: string
    readonly expectedRevisions: Readonly<Record<string, number>>
    readonly rows: readonly (DirectoryCustomerDetails & {
      readonly externalReference?: string
    })[]
    readonly actorId: string
    readonly now: string
  }) => Effect.Effect<
    { readonly created: number; readonly matched: number; readonly rejected: number },
    CustomerDirectoryError,
    MerchantContext
  >
  readonly exportMinimized: () => Effect.Effect<
    readonly {
      readonly id: string
      readonly name: string
      readonly email: string | null
      readonly phone: string | null
      readonly status: string
      readonly appointmentIds: readonly string[]
    }[],
    CustomerDirectoryError,
    MerchantContext
  >
  readonly eraseExpired: (input: {
    readonly idempotencyKey: string
    readonly expectedRevisions: Readonly<Record<string, number>>
    readonly now: string
    readonly inactiveBefore: string
    readonly actorId: string
    readonly protectedRecordIds?: readonly string[]
  }) => Effect.Effect<number, CustomerDirectoryError, MerchantContext>
}

export class CustomerDirectory extends Context.Service<
  CustomerDirectory,
  CustomerDirectoryShape
>()('@b2b-saas-starter/capabilities/CustomerDirectory') {}

type StoredCommand = { readonly fingerprint: string; readonly result: unknown }
export type SeedCustomerDirectoryStore = {
  readonly records: Map<string, CustomerRecord>
  readonly commands: Map<string, StoredCommand>
  readonly imports: Set<string>
}
export const emptySeedCustomerDirectoryStore = (): SeedCustomerDirectoryStore => ({
  records: new Map(),
  commands: new Map(),
  imports: new Set()
})

const email = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value.trim().toLowerCase()
const phone = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : `+${value.replace(/\D/g, '')}`
const normalize = (details: DirectoryCustomerDetails): DirectoryCustomerDetails => ({
  name: details.name.trim(),
  email: email(details.email),
  phone: phone(details.phone)
})
const validateDetails = (
  details: DirectoryCustomerDetails
): CustomerDirectoryError | null => {
  if (!details.name || details.name.length > 120)
    return new CustomerDirectoryInvalid({ reason: 'invalid_name' })
  if (details.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email))
    return new CustomerDirectoryInvalid({ reason: 'invalid_email' })
  if (details.phone && !/^\+[1-9]\d{6,14}$/.test(details.phone))
    return new CustomerDirectoryInvalid({ reason: 'invalid_phone' })
  return null
}
const activeBan = (record: CustomerRecord, now: string) =>
  record.ban && (!record.ban.expiresAt || record.ban.expiresAt > now)
const strictestBan = (
  left: CustomerBan | null,
  right: CustomerBan | null,
  now: string
) => {
  const active = [left, right].filter((ban): ban is CustomerBan =>
    Boolean(ban && (!ban.expiresAt || ban.expiresAt > now))
  )
  return (
    active.sort((a, b) => {
      if (a.expiresAt === null) return -1
      if (b.expiresAt === null) return 1
      return b.expiresAt.localeCompare(a.expiresAt)
    })[0] ?? null
  )
}
const values = (details: DirectoryCustomerDetails) =>
  [
    details.email && `email:${details.email}`,
    details.phone && `phone:${details.phone}`
  ].filter((value): value is string => Boolean(value))
const recordValues = (record: CustomerRecord) =>
  new Set(
    record.contacts
      .filter((item) => item.status === 'active')
      .map((item) => `${item.kind}:${item.value}`)
  )
const history = (
  kind: CustomerHistory['kind'],
  actorId: string,
  reason: string | null,
  at: string,
  revision: number
): CustomerHistory => ({
  id: newCapabilityId('cuh'),
  kind,
  actorId,
  reason,
  at,
  revision
})
const contactsFrom = (details: DirectoryCustomerDetails): CustomerContact[] => {
  const result: CustomerContact[] = []
  if (details.email)
    result.push({
      kind: 'email',
      value: details.email,
      status: 'active',
      preferred: true
    })
  if (details.phone)
    result.push({
      kind: 'phone',
      value: details.phone,
      status: 'active',
      preferred: true
    })
  return result
}
const fingerprint = (input: unknown) => JSON.stringify(input)

export const makeCustomerDirectoryService = (
  store: SeedCustomerDirectoryStore
): CustomerDirectoryShape => {
  const self: CustomerDirectoryShape = {
    matchOrCreate: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const details = normalize(input.details)
        const invalid = validateDetails(details)
        if (invalid) return yield* Effect.fail(invalid)
        const replay = input.appointmentId
          ? [...store.records.values()].find(
              (record) =>
                record.merchantId === merchant.id &&
                record.observations.some(
                  (observation) => observation.appointmentId === input.appointmentId
                )
            )
          : undefined
        if (replay) return { record: replay, matched: true }
        const candidates = [...store.records.values()].filter(
          (record) =>
            record.merchantId === merchant.id &&
            record.status !== 'merged' &&
            record.status !== 'erased'
        )
        const supplied = values(details)
        const matching = candidates.filter((record) =>
          supplied.some((value) => recordValues(record).has(value))
        )
        const match =
          supplied.length > 0 && matching.length === 1 ? matching[0] : undefined
        if (match) {
          const observation: CustomerObservation = {
            id: newCapabilityId('cuo'),
            appointmentId: input.appointmentId,
            details,
            observedAt: input.now,
            source: input.source ?? 'appointment'
          }
          const additional = contactsFrom(details)
            .filter(
              (contact) => !recordValues(match).has(`${contact.kind}:${contact.value}`)
            )
            .map((contact) => ({ ...contact, preferred: false }))
          const revision = match.revision + 1
          const next = {
            ...match,
            status: 'active' as const,
            contacts: [...match.contacts, ...additional],
            observations: [...match.observations, observation],
            lastActivityAt: input.now,
            revision,
            history: [
              ...match.history,
              history(
                input.source === 'import' ? 'imported' : 'edited',
                input.actorId ?? 'system',
                input.source === 'import' ? 'import_match' : 'appointment_observation',
                input.now,
                revision
              )
            ]
          }
          store.records.set(next.id, next)
          return { record: next, matched: true }
        }
        const id = newCapabilityId('cur')
        const observation: CustomerObservation = {
          id: newCapabilityId('cuo'),
          appointmentId: input.appointmentId,
          details,
          observedAt: input.now,
          source: input.source ?? 'appointment'
        }
        const record: CustomerRecord = {
          id,
          merchantId: merchant.id,
          status: 'active',
          displayName: details.name,
          preferredEmail: details.email,
          preferredPhone: details.phone,
          contacts: contactsFrom(details).map((contact) =>
            matching.length > 1
              ? { ...contact, status: 'disputed' as const, preferred: false }
              : contact
          ),
          observations: [observation],
          notes: [],
          consent: [],
          ban: null,
          possibleDuplicateOf: matching.map((item) => item.id),
          mergedInto: null,
          revision: 1,
          lastActivityAt: input.now,
          history: [
            history(
              input.source === 'import' ? 'imported' : 'created',
              input.actorId ?? 'system',
              input.source === 'import' ? 'import_create' : null,
              input.now,
              1
            )
          ]
        }
        store.records.set(id, record)
        return { record, matched: false }
      }),
    checkPublicEligibility: (raw, now) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const details = normalize(raw)
        const supplied = values(details)
        const matches = [...store.records.values()].filter(
          (record) =>
            record.merchantId === merchant.id &&
            record.status !== 'merged' &&
            supplied.some((value) => recordValues(record).has(value))
        )
        return matches.length === 1 && activeBan(matches[0]!, now)
          ? { kind: 'unavailable' as const }
          : { kind: 'eligible' as const }
      }),
    search: (query) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const normalizedQuery = query.trim().toLowerCase()
        const needle = normalizedQuery.replace(/[\s()-]/g, '')
        const matchesDetails = (details: DirectoryCustomerDetails) =>
          details.name.toLowerCase().includes(normalizedQuery) ||
          [details.email, details.phone].some((value) =>
            value?.replace(/[\s()-]/g, '').includes(needle)
          )
        return [...store.records.values()]
          .filter(
            (record) =>
              record.merchantId === merchant.id &&
              record.status === 'active' &&
              (record.displayName.toLowerCase().includes(normalizedQuery) ||
                record.contacts.some((contact) =>
                  contact.value.replace(/[\s()-]/g, '').includes(needle)
                ) ||
                record.observations.some((observation) =>
                  matchesDetails(observation.details)
                ))
          )
          .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      }),
    get: (recordId) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const record = store.records.get(recordId)
        if (!record || record.merchantId !== merchant.id)
          return yield* Effect.fail(
            new CapabilityNotFound({ resource: 'customer-record' })
          )
        return record
      }),
    editPreferred: (recordId, input) =>
      Effect.gen(function* () {
        const details = normalize({
          name: input.name,
          email: input.email,
          phone: input.phone
        })
        const invalid = validateDetails(details)
        if (invalid) return yield* Effect.fail(invalid)
        return yield* mutate(store, recordId, input, 'edited', () => ({
          displayName: details.name,
          preferredEmail: details.email,
          preferredPhone: details.phone,
          contacts: (record: CustomerRecord) => {
            const desired = contactsFrom(details)
            const desiredKeys = new Set(
              desired.map((contact) => `${contact.kind}:${contact.value}`)
            )
            const historical = record.contacts.map((contact) =>
              contact.preferred && !desiredKeys.has(`${contact.kind}:${contact.value}`)
                ? { ...contact, preferred: false, status: 'superseded' as const }
                : desired.some(
                      (item) =>
                        item.kind === contact.kind && item.value === contact.value
                    )
                  ? { ...contact, preferred: true, status: 'active' as const }
                  : contact
            )
            const existing = new Set(
              historical.map((contact) => `${contact.kind}:${contact.value}`)
            )
            return [
              ...historical,
              ...desired.filter(
                (contact) => !existing.has(`${contact.kind}:${contact.value}`)
              )
            ]
          }
        }))
      }),
    addNote: (recordId, input) =>
      mutate(store, recordId, input, 'note_added', (input) => ({
        notes: (record: CustomerRecord) => [
          ...record.notes,
          {
            id: newCapabilityId('cun'),
            text: input.text,
            actorId: input.actorId,
            createdAt: input.now,
            editedAt: null
          }
        ]
      })),
    setContactStatus: (recordId, input) => {
      const normalizedValue =
        input.kind === 'email' ? email(input.value) : phone(input.value)
      const becomesPreferred = input.preferred && input.status === 'active'
      return mutate(store, recordId, input, 'edited', () => ({
        contacts: (record: CustomerRecord) =>
          record.contacts.map((contact) =>
            contact.kind === input.kind && contact.value === normalizedValue
              ? {
                  ...contact,
                  status: input.status,
                  preferred: becomesPreferred
                }
              : becomesPreferred && contact.kind === input.kind
                ? { ...contact, preferred: false }
                : contact
          ),
        ...(input.kind === 'email'
          ? {
              preferredEmail: (record: CustomerRecord) =>
                becomesPreferred
                  ? normalizedValue
                  : record.preferredEmail === normalizedValue
                    ? null
                    : record.preferredEmail
            }
          : {
              preferredPhone: (record: CustomerRecord) =>
                becomesPreferred
                  ? normalizedValue
                  : record.preferredPhone === normalizedValue
                    ? null
                    : record.preferredPhone
            })
      }))
    },
    recordConsent: (recordId, input) =>
      mutate(store, recordId, input, 'edited', (input) => ({
        consent: (record: CustomerRecord) =>
          input.withdrawn
            ? record.consent.map((item) =>
                item.purpose === input.purpose &&
                item.destination === input.destination &&
                !item.withdrawnAt
                  ? { ...item, withdrawnAt: input.now }
                  : item
              )
            : [
                ...record.consent,
                {
                  id: newCapabilityId('cue'),
                  purpose: input.purpose,
                  destination: input.destination,
                  wordingVersion: input.wordingVersion,
                  source: input.source,
                  grantedAt: input.now,
                  withdrawnAt: null
                }
              ]
      })),
    setBan: (recordId, input) =>
      mutate(store, recordId, input, 'banned', (input) => ({
        ban: {
          reason: input.reason,
          actorId: input.actorId,
          createdAt: input.now,
          expiresAt: input.expiresAt
        }
      })),
    liftBan: (recordId, input) =>
      mutate(store, recordId, input, 'ban_lifted', () => ({ ban: null }), input.reason),
    merge: (input) => mergeRecords(store, input),
    split: (input) => splitRecord(store, input),
    archive: (recordId, input) =>
      mutate(store, recordId, input, input.archived ? 'archived' : 'restored', () => ({
        status: input.archived ? 'archived' : 'active'
      })),
    previewImport: (rows) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const candidates = [...store.records.values()].filter(
          (record) =>
            record.merchantId === merchant.id &&
            record.status !== 'merged' &&
            record.status !== 'erased'
        )
        return rows.map((row, index) => {
          const normalized = normalize(row)
          if (validateDetails(normalized))
            return { row: index + 1, normalized, outcome: 'invalid' as const }
          const supplied = values(normalized),
            matching = candidates.filter((record) =>
              supplied.some((value) => recordValues(record).has(value))
            )
          const exact = matching.length === 1 && supplied.length > 0
          return {
            row: index + 1,
            normalized,
            outcome: exact
              ? ('exact_match' as const)
              : matching.length
                ? ('possible_duplicate' as const)
                : ('create' as const)
          }
        })
      }),
    importRows: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const importKey = `${merchant.id}:${input.idempotencyKey}`
        const commandFingerprint = fingerprint(input)
        const replay = store.commands.get(importKey)
        if (replay) {
          if (replay.fingerprint !== commandFingerprint)
            return yield* Effect.fail(
              new CapabilityConflict({ reason: 'idempotency_key_reused' })
            )
          return replay.result as {
            readonly created: number
            readonly matched: number
            readonly rejected: number
          }
        }
        let created = 0,
          matched = 0,
          rejected = 0
        for (let index = 0; index < input.rows.length; index++) {
          const row = input.rows[index]!
          const normalized = normalize(row)
          const supplied = values(normalized)
          const matching = [...store.records.values()].filter(
            (record) =>
              record.merchantId === merchant.id &&
              record.status !== 'merged' &&
              record.status !== 'erased' &&
              supplied.some((value) => recordValues(record).has(value))
          )
          if (
            matching.length === 1 &&
            input.expectedRevisions[matching[0]!.id] !== matching[0]!.revision
          )
            return yield* Effect.fail(
              new CapabilityConflict({
                reason: 'stale_revision',
                currentRevision: matching[0]!.revision
              })
            )
          const result = yield* Effect.result(
            self.matchOrCreate({
              appointmentId: null,
              details: row,
              now: input.now,
              source: 'import',
              actorId: input.actorId
            })
          )
          if (result._tag === 'Failure') rejected += 1
          else if (result.success.matched) matched += 1
          else created += 1
        }
        store.imports.add(importKey)
        const result = { created, matched, rejected }
        store.commands.set(importKey, { fingerprint: commandFingerprint, result })
        return result
      }),
    exportMinimized: () =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        return [...store.records.values()]
          .filter(
            (record) => record.merchantId === merchant.id && record.status !== 'merged'
          )
          .map((record) => ({
            id: record.id,
            name: record.displayName,
            email: record.preferredEmail,
            phone: record.preferredPhone,
            status: record.status,
            appointmentIds: record.observations.flatMap((item) =>
              item.appointmentId && !item.appointmentId.startsWith('import:')
                ? [item.appointmentId]
                : []
            )
          }))
      }),
    eraseExpired: ({
      now,
      inactiveBefore,
      actorId,
      protectedRecordIds = [],
      idempotencyKey,
      expectedRevisions
    }) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const commandKey = `${merchant.id}:${idempotencyKey}`
        const commandFingerprint = fingerprint({
          now,
          inactiveBefore,
          actorId,
          protectedRecordIds,
          expectedRevisions
        })
        const replay = store.commands.get(commandKey)
        if (replay) {
          if (replay.fingerprint !== commandFingerprint)
            return yield* Effect.fail(
              new CapabilityConflict({ reason: 'idempotency_key_reused' })
            )
          return replay.result as number
        }
        const protectedIds = new Set(protectedRecordIds)
        let count = 0
        for (const record of store.records.values())
          if (
            record.merchantId === merchant.id &&
            record.status !== 'erased' &&
            record.lastActivityAt < inactiveBefore &&
            !protectedIds.has(record.id) &&
            !activeBan(record, now)
          ) {
            if (expectedRevisions[record.id] !== record.revision)
              return yield* Effect.fail(
                new CapabilityConflict({
                  reason: 'stale_revision',
                  currentRevision: record.revision
                })
              )
            const revision = record.revision + 1
            store.records.set(record.id, {
              ...record,
              status: 'erased',
              displayName: 'Erased customer',
              preferredEmail: null,
              preferredPhone: null,
              contacts: [],
              notes: [],
              consent: [],
              ban: null,
              revision,
              history: [
                ...record.history,
                history('erased', actorId, 'retention', now, revision)
              ]
            })
            count += 1
          }
        store.commands.set(commandKey, {
          fingerprint: commandFingerprint,
          result: count
        })
        return count
      })
  }
  return self
}

export const SeedCustomerDirectory = (
  store: SeedCustomerDirectoryStore
): Layer.Layer<CustomerDirectory> =>
  Layer.succeed(CustomerDirectory)(makeCustomerDirectoryService(store))

type Patch = Record<string, unknown | ((record: CustomerRecord) => unknown)>
const mutate = <I extends Mutation>(
  store: SeedCustomerDirectoryStore,
  recordId: string,
  input: I,
  kind: CustomerHistory['kind'],
  change: (input: I) => Patch,
  reason: string | null = null
): Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext> =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    const record = store.records.get(recordId)
    if (!record || record.merchantId !== merchant.id)
      return yield* Effect.fail(new CapabilityNotFound({ resource: 'customer-record' }))
    const key = `${merchant.id}:${input.idempotencyKey}`,
      fp = fingerprint(input),
      replay = store.commands.get(key)
    if (replay) {
      if (replay.fingerprint !== fp)
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      return replay.result as CustomerRecord
    }
    if (record.revision !== input.expectedRevision)
      return yield* Effect.fail(
        new CapabilityConflict({
          reason: 'stale_revision',
          currentRevision: record.revision
        })
      )
    const revision = record.revision + 1
    const raw = change(input)
    const resolved = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        typeof value === 'function' ? value(record) : value
      ])
    )
    const next = {
      ...record,
      ...resolved,
      revision,
      history: [
        ...record.history,
        history(kind, input.actorId, reason, input.now, revision)
      ]
    } as CustomerRecord
    store.records.set(recordId, next)
    store.commands.set(key, { fingerprint: fp, result: next })
    return next
  })

const mergeRecords = (
  store: SeedCustomerDirectoryStore,
  input: MergeInput
): Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext> =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    const commandKey = `${merchant.id}:${input.idempotencyKey}`
    const commandFingerprint = fingerprint(input)
    const replay = store.commands.get(commandKey)
    if (replay) {
      if (replay.fingerprint !== commandFingerprint)
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      return replay.result as CustomerRecord
    }
    const survivor = store.records.get(input.survivorId),
      absorbed = store.records.get(input.absorbedId)
    if (
      !survivor ||
      !absorbed ||
      survivor.merchantId !== merchant.id ||
      absorbed.merchantId !== merchant.id
    )
      return yield* Effect.fail(new CapabilityNotFound({ resource: 'customer-record' }))
    if (
      survivor.revision !== input.expectedSurvivorRevision ||
      absorbed.revision !== input.expectedAbsorbedRevision
    )
      return yield* Effect.fail(
        new CapabilityConflict({
          reason: 'stale_revision',
          currentRevision: Math.max(survivor.revision, absorbed.revision)
        })
      )
    const revision = survivor.revision + 1
    if (
      input.preferredDetailsSourceId &&
      input.preferredDetailsSourceId !== survivor.id &&
      input.preferredDetailsSourceId !== absorbed.id
    )
      return yield* Effect.fail(
        new CapabilityConflict({ reason: 'invalid_preferred_details_source' })
      )
    const preferred =
      input.preferredDetailsSourceId === absorbed.id ? absorbed : survivor
    const statusRank: Record<CustomerContact['status'], number> = {
      active: 3,
      disputed: 2,
      superseded: 1
    }
    const contactsByDestination = new Map<string, CustomerContact>()
    for (const contact of [...survivor.contacts, ...absorbed.contacts]) {
      const key = `${contact.kind}:${contact.value}`
      const existing = contactsByDestination.get(key)
      if (!existing || statusRank[contact.status] > statusRank[existing.status])
        contactsByDestination.set(key, contact)
    }
    const combinedContacts = [...contactsByDestination.values()]
    const merged: CustomerRecord = {
      ...survivor,
      displayName: preferred.displayName,
      preferredEmail: preferred.preferredEmail,
      preferredPhone: preferred.preferredPhone,
      contacts: combinedContacts.map((contact) => ({
        ...contact,
        preferred:
          contact.status === 'active' &&
          (contact.value === preferred.preferredEmail ||
            contact.value === preferred.preferredPhone)
      })),
      observations: [...survivor.observations, ...absorbed.observations].sort((a, b) =>
        a.observedAt.localeCompare(b.observedAt)
      ),
      notes: [...survivor.notes, ...absorbed.notes].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      ),
      consent: [...survivor.consent, ...absorbed.consent],
      ban: strictestBan(survivor.ban, absorbed.ban, input.now),
      possibleDuplicateOf: [],
      revision,
      lastActivityAt:
        survivor.lastActivityAt > absorbed.lastActivityAt
          ? survivor.lastActivityAt
          : absorbed.lastActivityAt,
      history: [
        ...survivor.history,
        history('merged', input.actorId, input.reason, input.now, revision)
      ]
    }
    store.records.set(merged.id, merged)
    store.records.set(absorbed.id, {
      ...absorbed,
      status: 'merged',
      mergedInto: survivor.id,
      possibleDuplicateOf: [],
      revision: absorbed.revision + 1,
      history: [
        ...absorbed.history,
        history('merged', input.actorId, input.reason, input.now, absorbed.revision + 1)
      ]
    })
    store.commands.set(commandKey, {
      fingerprint: commandFingerprint,
      result: merged
    })
    return merged
  })

const splitRecord = (
  store: SeedCustomerDirectoryStore,
  input: SplitInput
): Effect.Effect<
  { source: CustomerRecord; created: CustomerRecord },
  CustomerDirectoryError,
  MerchantContext
> =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    const commandKey = `${merchant.id}:${input.idempotencyKey}`
    const commandFingerprint = fingerprint(input)
    const replay = store.commands.get(commandKey)
    if (replay) {
      if (replay.fingerprint !== commandFingerprint)
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      return replay.result as {
        source: CustomerRecord
        created: CustomerRecord
      }
    }
    const source = store.records.get(input.sourceId)
    if (!source || source.merchantId !== merchant.id)
      return yield* Effect.fail(new CapabilityNotFound({ resource: 'customer-record' }))
    if (source.revision !== input.expectedRevision)
      return yield* Effect.fail(
        new CapabilityConflict({
          reason: 'stale_revision',
          currentRevision: source.revision
        })
      )
    const selected = new Set(input.observationIds)
    const moved = source.observations.filter((item) => selected.has(item.id))
    if (moved.length === 0 || moved.length === source.observations.length)
      return yield* Effect.fail(new CustomerDirectoryInvalid({ reason: 'empty_split' }))
    const first = moved[0]!,
      id = newCapabilityId('cur')
    const details = normalize(input.createdDetails ?? first.details)
    const invalid = validateDetails(details)
    if (invalid) return yield* Effect.fail(invalid)
    const explicitlyAssigned = input.createdDetails !== undefined
    if (!explicitlyAssigned && (input.contactKeys?.length ?? 0) > 0)
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'invalid_split_assignment' })
      )
    const movedContactKeys = new Set(
      (input.contactKeys ?? []).map((contact) => `${contact.kind}:${contact.value}`)
    )
    if (
      explicitlyAssigned &&
      ((details.email && !movedContactKeys.has(`email:${details.email}`)) ||
        (details.phone && !movedContactKeys.has(`phone:${details.phone}`)))
    )
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'invalid_split_assignment' })
      )
    const movedNoteIds = new Set(input.noteIds ?? [])
    const movedConsentIds = new Set(input.consentIds ?? [])
    const movedDestinations = new Set(
      (input.contactKeys ?? []).map((contact) => contact.value)
    )
    const requiredConsentIds = source.consent
      .filter((evidence) => movedDestinations.has(evidence.destination))
      .map((evidence) => evidence.id)
    if (
      requiredConsentIds.some((id) => !movedConsentIds.has(id)) ||
      source.consent.some(
        (evidence) =>
          movedConsentIds.has(evidence.id) &&
          !movedDestinations.has(evidence.destination)
      )
    )
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'invalid_split_assignment' })
      )
    const created: CustomerRecord = {
      ...source,
      id,
      displayName: details.name,
      preferredEmail: explicitlyAssigned ? details.email : null,
      preferredPhone: explicitlyAssigned ? details.phone : null,
      contacts: explicitlyAssigned
        ? source.contacts
            .filter((contact) =>
              movedContactKeys.has(`${contact.kind}:${contact.value}`)
            )
            .map((contact) => ({
              ...contact,
              preferred:
                contact.status === 'active' &&
                (contact.value === details.email || contact.value === details.phone)
            }))
        : contactsFrom(details).map((contact) => ({
            ...contact,
            status: 'disputed' as const,
            preferred: false
          })),
      observations: moved,
      notes: source.notes.filter((item) => movedNoteIds.has(item.id)),
      consent: source.consent.filter((item) => movedConsentIds.has(item.id)),
      possibleDuplicateOf: [],
      mergedInto: null,
      revision: 1,
      history: [history('split', input.actorId, input.reason, input.now, 1)]
    }
    const revision = source.revision + 1
    const remaining = {
      ...source,
      preferredEmail:
        source.preferredEmail && movedContactKeys.has(`email:${source.preferredEmail}`)
          ? null
          : source.preferredEmail,
      preferredPhone:
        source.preferredPhone && movedContactKeys.has(`phone:${source.preferredPhone}`)
          ? null
          : source.preferredPhone,
      contacts: source.contacts.filter(
        (contact) => !movedContactKeys.has(`${contact.kind}:${contact.value}`)
      ),
      observations: source.observations.filter((item) => !selected.has(item.id)),
      notes: source.notes.filter((item) => !movedNoteIds.has(item.id)),
      consent: source.consent.filter((item) => !movedConsentIds.has(item.id)),
      revision,
      history: [
        ...source.history,
        history('split', input.actorId, input.reason, input.now, revision)
      ]
    }
    store.records.set(source.id, remaining)
    store.records.set(id, created)
    const result = { source: remaining, created }
    store.commands.set(commandKey, {
      fingerprint: commandFingerprint,
      result
    })
    return result
  })
