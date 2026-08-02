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
  readonly actorId: string
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
  readonly appointmentId: string
  readonly details: DirectoryCustomerDetails
  readonly now: string
}
type MergeInput = {
  readonly survivorId: string
  readonly absorbedId: string
  readonly expectedSurvivorRevision: number
  readonly expectedAbsorbedRevision: number
  readonly idempotencyKey: string
  readonly actorId: string
  readonly reason: string
  readonly now: string
}
type SplitInput = {
  readonly sourceId: string
  readonly observationIds: readonly string[]
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly actorId: string
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
    readonly now: string
    readonly inactiveBefore: string
    readonly actorId: string
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

export const SeedCustomerDirectory = (
  store: SeedCustomerDirectoryStore
): Layer.Layer<CustomerDirectory> => {
  const self: CustomerDirectoryShape = {
    matchOrCreate: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const details = normalize(input.details)
        const invalid = validateDetails(details)
        if (invalid) return yield* Effect.fail(invalid)
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
        const exact = matching.filter((record) =>
          supplied.every((value) => recordValues(record).has(value))
        )
        const match =
          supplied.length > 0 && matching.length === 1 && exact.length === 1
            ? exact[0]
            : undefined
        if (match) {
          const observation: CustomerObservation = {
            id: newCapabilityId('cuo'),
            appointmentId: input.appointmentId,
            details,
            observedAt: input.now,
            source: 'appointment'
          }
          const additional = contactsFrom(details)
            .filter(
              (contact) => !recordValues(match).has(`${contact.kind}:${contact.value}`)
            )
            .map((contact) => ({ ...contact, preferred: false }))
          const next = {
            ...match,
            status: 'active' as const,
            contacts: [...match.contacts, ...additional],
            observations: [...match.observations, observation],
            lastActivityAt: input.now
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
          source: 'appointment'
        }
        const record: CustomerRecord = {
          id,
          merchantId: merchant.id,
          status: 'active',
          displayName: details.name,
          preferredEmail: details.email,
          preferredPhone: details.phone,
          contacts: contactsFrom(details),
          observations: [observation],
          notes: [],
          consent: [],
          ban: null,
          possibleDuplicateOf: matching.map((item) => item.id),
          mergedInto: null,
          revision: 1,
          lastActivityAt: input.now,
          history: [history('created', 'system', null, input.now, 1)]
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
        const needle = query
          .trim()
          .toLowerCase()
          .replace(/[\s()-]/g, '')
        return [...store.records.values()]
          .filter(
            (record) =>
              record.merchantId === merchant.id &&
              record.status === 'active' &&
              (record.displayName.toLowerCase().includes(query.trim().toLowerCase()) ||
                record.contacts.some(
                  (contact) =>
                    contact.status === 'active' &&
                    contact.value.replace(/[\s()-]/g, '').includes(needle)
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
      mutate(store, recordId, input, 'edited', (input) => {
        const details = normalize({
          name: input.name,
          email: input.email,
          phone: input.phone
        })
        const invalid = validateDetails(details)
        if (invalid) throw invalid
        return {
          displayName: details.name,
          preferredEmail: details.email,
          preferredPhone: details.phone,
          contacts: contactsFrom(details)
        }
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
    setContactStatus: (recordId, input) =>
      mutate(store, recordId, input, 'edited', (input) => ({
        contacts: (record: CustomerRecord) =>
          record.contacts.map((contact) =>
            contact.kind === input.kind &&
            contact.value ===
              (input.kind === 'email' ? email(input.value) : phone(input.value))
              ? { ...contact, status: input.status, preferred: input.preferred }
              : input.preferred && contact.kind === input.kind
                ? { ...contact, preferred: false }
                : contact
          )
      })),
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
          const exact =
            matching.length === 1 &&
            supplied.length > 0 &&
            supplied.every((value) => recordValues(matching[0]!).has(value))
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
        const importKey = `${merchant.id}:${input.fileId}`
        if (store.imports.has(importKey)) return { created: 0, matched: 0, rejected: 0 }
        let created = 0,
          matched = 0,
          rejected = 0
        for (let index = 0; index < input.rows.length; index++) {
          const row = input.rows[index]!
          const result = yield* Effect.result(
            self.matchOrCreate({
              appointmentId: `import:${input.fileId}:${index}`,
              details: row,
              now: input.now
            })
          )
          if (result._tag === 'Failure') rejected += 1
          else if (result.success.matched) matched += 1
          else created += 1
        }
        store.imports.add(importKey)
        return { created, matched, rejected }
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
    eraseExpired: ({ now, inactiveBefore, actorId }) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        let count = 0
        for (const record of store.records.values())
          if (
            record.merchantId === merchant.id &&
            record.status !== 'erased' &&
            record.lastActivityAt < inactiveBefore &&
            !activeBan(record, now)
          ) {
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
        return count
      })
  }
  return Layer.succeed(CustomerDirectory)(self)
}

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
    const contactKeys = new Set(
      survivor.contacts.map((item) => `${item.kind}:${item.value}:${item.status}`)
    )
    const merged: CustomerRecord = {
      ...survivor,
      contacts: [
        ...survivor.contacts,
        ...absorbed.contacts
          .filter(
            (item) => !contactKeys.has(`${item.kind}:${item.value}:${item.status}`)
          )
          .map((item) => ({ ...item, preferred: false }))
      ],
      observations: [...survivor.observations, ...absorbed.observations].sort((a, b) =>
        a.observedAt.localeCompare(b.observedAt)
      ),
      notes: [...survivor.notes, ...absorbed.notes].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      ),
      consent: [...survivor.consent, ...absorbed.consent],
      ban:
        activeBan(absorbed, input.now) && !activeBan(survivor, input.now)
          ? absorbed.ban
          : survivor.ban,
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
      revision: absorbed.revision + 1,
      history: [
        ...absorbed.history,
        history('merged', input.actorId, input.reason, input.now, absorbed.revision + 1)
      ]
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
    const created: CustomerRecord = {
      ...source,
      id,
      displayName: first.details.name,
      preferredEmail: first.details.email,
      preferredPhone: first.details.phone,
      contacts: contactsFrom(first.details),
      observations: moved,
      notes: [],
      consent: source.consent.filter((item) =>
        values(first.details).some((value) => value.endsWith(item.destination))
      ),
      possibleDuplicateOf: [],
      mergedInto: null,
      revision: 1,
      history: [history('split', input.actorId, input.reason, input.now, 1)]
    }
    const revision = source.revision + 1
    const remaining = {
      ...source,
      observations: source.observations.filter((item) => !selected.has(item.id)),
      revision,
      history: [
        ...source.history,
        history('split', input.actorId, input.reason, input.now, revision)
      ]
    }
    store.records.set(source.id, remaining)
    store.records.set(id, created)
    return { source: remaining, created }
  })
