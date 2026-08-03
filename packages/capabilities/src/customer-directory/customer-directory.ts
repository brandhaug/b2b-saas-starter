import { Context, Effect, Layer, Schema } from 'effect'
import {
  CapabilityConflict,
  CapabilityNotFound,
  CapabilityUnavailable
} from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import {
  normalizeCustomerDetails,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  CustomerDetailsSchema,
  type NormalizedCustomerDetails
} from './customer-contact-normalization.ts'

export const DirectoryCustomerDetailsSchema = CustomerDetailsSchema
export type DirectoryCustomerDetails = NormalizedCustomerDetails
export const CustomerObservationSchema = Schema.Struct({
  id: Schema.String,
  appointmentId: Schema.NullOr(Schema.String),
  details: DirectoryCustomerDetailsSchema,
  observedAt: Schema.String,
  source: Schema.Literals(['appointment', 'import'])
})
export type CustomerObservation = typeof CustomerObservationSchema.Type

export const CustomerContactSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(['email', 'phone']),
  value: Schema.String,
  status: Schema.Literals(['active', 'disputed', 'superseded']),
  preferred: Schema.Boolean,
  createdAt: Schema.optional(Schema.String)
})
export type CustomerContact = typeof CustomerContactSchema.Type

export const MerchantNoteSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  actorId: Schema.String,
  createdAt: Schema.String,
  editedAt: Schema.NullOr(Schema.String)
})
export type MerchantNote = typeof MerchantNoteSchema.Type

export const CustomerBanSchema = Schema.Struct({
  reason: Schema.String,
  actorId: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String)
})
export type CustomerBan = typeof CustomerBanSchema.Type

export const ConsentEvidenceSchema = Schema.Struct({
  id: Schema.String,
  purpose: Schema.Literals(['operational_mobile', 'marketing']),
  destination: Schema.String,
  wordingVersion: Schema.String,
  source: Schema.String,
  grantedAt: Schema.String,
  withdrawnAt: Schema.NullOr(Schema.String)
})
export type ConsentEvidence = typeof ConsentEvidenceSchema.Type

export const CustomerHistorySchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    'created',
    'edited',
    'note_added',
    'banned',
    'ban_lifted',
    'merged',
    'split',
    'archived',
    'restored',
    'erased',
    'imported',
    'appointment_observed'
  ]),
  actorId: Schema.String,
  impersonatedBy: Schema.optional(Schema.NullOr(Schema.String)),
  reason: Schema.NullOr(Schema.String),
  at: Schema.String,
  revision: Schema.Number
})
export type CustomerHistory = typeof CustomerHistorySchema.Type

export const CustomerRecordSchema = Schema.Struct({
  id: Schema.String,
  merchantId: Schema.String,
  status: Schema.Literals(['active', 'archived', 'merged', 'erased']),
  displayName: Schema.String,
  preferredEmail: Schema.NullOr(Schema.String),
  preferredPhone: Schema.NullOr(Schema.String),
  contacts: Schema.Array(CustomerContactSchema),
  observations: Schema.Array(CustomerObservationSchema),
  notes: Schema.Array(MerchantNoteSchema),
  consent: Schema.Array(ConsentEvidenceSchema),
  ban: Schema.NullOr(CustomerBanSchema),
  possibleDuplicateOf: Schema.Array(Schema.String),
  mergedInto: Schema.NullOr(Schema.String),
  revision: Schema.Number,
  lastActivityAt: Schema.String,
  history: Schema.Array(CustomerHistorySchema)
})
export type CustomerRecord = typeof CustomerRecordSchema.Type

type CustomerSearchEvidence = {
  readonly value: string | null
  readonly kind: 'text' | 'phone'
}

const customerSearchEvidence = (
  record: CustomerRecord
): readonly CustomerSearchEvidence[] => [
  { value: record.displayName, kind: 'text' },
  { value: record.preferredEmail, kind: 'text' },
  { value: record.preferredPhone, kind: 'phone' },
  ...record.contacts
    .filter((contact) => contact.status === 'active')
    .map((contact) => ({
      value: contact.value,
      kind: contact.kind === 'phone' ? ('phone' as const) : ('text' as const)
    })),
  ...record.observations.map((observation) => ({
    value: observation.details.name,
    kind: 'text' as const
  }))
]

export const customerRecordMatchesQuery = (
  record: CustomerRecord,
  query: string
): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  const queryDigits = normalizedQuery.replace(/\D/g, '')
  const isPhoneQuery = /^[\d\s()+.-]+$/.test(normalizedQuery) && queryDigits.length >= 3

  return customerSearchEvidence(record)
    .filter(
      (evidence): evidence is CustomerSearchEvidence & { readonly value: string } =>
        Boolean(evidence.value)
    )
    .some(
      (evidence) =>
        evidence.value.toLocaleLowerCase().includes(normalizedQuery) ||
        (evidence.kind === 'phone' &&
          isPhoneQuery &&
          evidence.value.replace(/\D/g, '').includes(queryDigits))
    )
}

export class CustomerDirectoryInvalid extends Schema.TaggedErrorClass<CustomerDirectoryInvalid>()(
  'CustomerDirectoryInvalid',
  {
    reason: Schema.Literals([
      'invalid_name',
      'invalid_email',
      'invalid_phone',
      'reason_required',
      'invalid_record_status',
      'merge_records_must_be_distinct',
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
const MutationFields = {
  expectedRevision: Schema.Number,
  idempotencyKey: Schema.String,
  actorId: Schema.String,
  now: Schema.String
} as const
export const CustomerMutationSchema = Schema.Struct(MutationFields)
type Mutation = typeof CustomerMutationSchema.Type

export const MatchCustomerInputSchema = Schema.Struct({
  appointmentId: Schema.NullOr(Schema.String),
  details: DirectoryCustomerDetailsSchema,
  now: Schema.String,
  source: Schema.optional(Schema.Literals(['appointment', 'import'])),
  actorId: Schema.optional(Schema.String)
})
type MatchInput = typeof MatchCustomerInputSchema.Type

export const EditCustomerPreferredInputSchema = Schema.Struct({
  ...MutationFields,
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String)
})
type EditPreferredInput = typeof EditCustomerPreferredInputSchema.Type

export const AddCustomerNoteInputSchema = Schema.Struct({
  ...MutationFields,
  text: Schema.String
})
type AddNoteInput = typeof AddCustomerNoteInputSchema.Type

export const SetCustomerContactStatusInputSchema = Schema.Struct({
  ...MutationFields,
  kind: Schema.Literals(['email', 'phone']),
  value: Schema.String,
  status: Schema.Literals(['active', 'disputed', 'superseded']),
  preferred: Schema.Boolean
})
type SetContactStatusInput = typeof SetCustomerContactStatusInputSchema.Type

export const RecordCustomerConsentInputSchema = Schema.Struct({
  ...MutationFields,
  purpose: Schema.Literals(['operational_mobile', 'marketing']),
  destination: Schema.String,
  wordingVersion: Schema.String,
  source: Schema.String,
  withdrawn: Schema.Boolean
})
type RecordConsentInput = typeof RecordCustomerConsentInputSchema.Type

export const SetCustomerBanInputSchema = Schema.Struct({
  ...MutationFields,
  reason: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1)),
  expiresAt: Schema.NullOr(Schema.String)
})
type SetBanInput = typeof SetCustomerBanInputSchema.Type

export const LiftCustomerBanInputSchema = Schema.Struct({
  ...MutationFields,
  reason: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1))
})
type LiftBanInput = typeof LiftCustomerBanInputSchema.Type

export const ArchiveCustomerInputSchema = Schema.Struct({
  ...MutationFields,
  archived: Schema.Boolean
})
type ArchiveInput = typeof ArchiveCustomerInputSchema.Type

export const MergeCustomerInputSchema = Schema.Struct({
  survivorId: Schema.String,
  absorbedId: Schema.String,
  expectedSurvivorRevision: Schema.Number,
  expectedAbsorbedRevision: Schema.Number,
  idempotencyKey: Schema.String,
  actorId: Schema.String,
  preferredDetailsSourceId: Schema.optional(Schema.String),
  reason: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1)),
  now: Schema.String
}).check(
  Schema.makeFilter((input) =>
    input.survivorId === input.absorbedId
      ? { path: ['absorbedId'], issue: 'merge records must be distinct' }
      : undefined
  )
)
type MergeInput = typeof MergeCustomerInputSchema.Type

export const CustomerContactKeySchema = Schema.Struct({
  kind: Schema.Literals(['email', 'phone']),
  value: Schema.String
})
export const SplitCustomerInputSchema = Schema.Struct({
  sourceId: Schema.String,
  observationIds: Schema.Array(Schema.String),
  expectedRevision: Schema.Number,
  idempotencyKey: Schema.String,
  actorId: Schema.String,
  createdDetails: Schema.optional(DirectoryCustomerDetailsSchema),
  contactKeys: Schema.optional(Schema.Array(CustomerContactKeySchema)),
  noteIds: Schema.optional(Schema.Array(Schema.String)),
  consentIds: Schema.optional(Schema.Array(Schema.String)),
  reason: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1)),
  now: Schema.String
})
type SplitInput = typeof SplitCustomerInputSchema.Type

export const CustomerSearchOptionsSchema = Schema.Struct({
  includeArchived: Schema.optional(Schema.Boolean)
})
type CustomerSearchOptions = typeof CustomerSearchOptionsSchema.Type

export const CustomerImportRowSchema = Schema.Struct({
  ...DirectoryCustomerDetailsSchema.fields,
  externalReference: Schema.optional(Schema.String)
})
export type CustomerImportRow = typeof CustomerImportRowSchema.Type
export const ImportCustomerRowsInputSchema = Schema.Struct({
  fileId: Schema.String,
  idempotencyKey: Schema.String,
  expectedRevisions: Schema.Record(Schema.String, Schema.Number),
  rows: Schema.Array(CustomerImportRowSchema),
  actorId: Schema.String,
  now: Schema.String
})
type ImportRowsInput = typeof ImportCustomerRowsInputSchema.Type

export const EraseExpiredCustomersInputSchema = Schema.Struct({
  idempotencyKey: Schema.String,
  expectedRevisions: Schema.Record(Schema.String, Schema.Number),
  now: Schema.String,
  inactiveBefore: Schema.String,
  actorId: Schema.String,
  protectedRecordIds: Schema.optional(Schema.Array(Schema.String))
})
type EraseExpiredInput = typeof EraseExpiredCustomersInputSchema.Type

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
    query: string,
    options?: CustomerSearchOptions
  ) => Effect.Effect<readonly CustomerRecord[], CustomerDirectoryError, MerchantContext>
  readonly get: (
    recordId: string
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly editPreferred: (
    recordId: string,
    input: EditPreferredInput
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly addNote: (
    recordId: string,
    input: AddNoteInput
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly setContactStatus: (
    recordId: string,
    input: SetContactStatusInput
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly recordConsent: (
    recordId: string,
    input: RecordConsentInput
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly setBan: (
    recordId: string,
    input: SetBanInput
  ) => Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext>
  readonly liftBan: (
    recordId: string,
    input: LiftBanInput
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
    input: ArchiveInput
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
  readonly importRows: (
    input: ImportRowsInput
  ) => Effect.Effect<
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
  readonly eraseExpired: (
    input: EraseExpiredInput
  ) => Effect.Effect<number, CustomerDirectoryError, MerchantContext>
}

export class CustomerDirectory extends Context.Service<
  CustomerDirectory,
  CustomerDirectoryShape
>()('@b2b-saas-starter/capabilities/CustomerDirectory') {}

export type StoredCommandResult =
  | { readonly _tag: 'record'; readonly recordId: string }
  | {
      readonly _tag: 'split'
      readonly sourceId: string
      readonly createdId: string
    }
  | {
      readonly _tag: 'import'
      readonly created: number
      readonly matched: number
      readonly rejected: number
    }
  | { readonly _tag: 'count'; readonly value: number }
export type StoredCustomerDirectoryCommand = {
  readonly fingerprint: string
  readonly result: StoredCommandResult
}
export type CustomerDirectoryState = {
  readonly records: Map<string, CustomerRecord>
  readonly commands: Map<string, StoredCustomerDirectoryCommand>
  readonly imports: Set<string>
  fingerprintKey: string
}
export const emptyCustomerDirectoryState = (): CustomerDirectoryState => ({
  records: new Map(),
  commands: new Map(),
  imports: new Set(),
  fingerprintKey: 'customer-directory-seed-fingerprint-key'
})
export type SeedCustomerDirectoryStore = CustomerDirectoryState
export const emptySeedCustomerDirectoryStore = emptyCustomerDirectoryState
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
const matchableMerchantRecords = (store: CustomerDirectoryState, merchantId: string) =>
  [...store.records.values()].filter(
    (record) =>
      record.merchantId === merchantId &&
      record.status !== 'merged' &&
      record.status !== 'erased'
  )
const recordsMatchingDetails = (
  records: readonly CustomerRecord[],
  details: DirectoryCustomerDetails
) => {
  const supplied = values(details)
  return {
    supplied,
    matching: records.filter((record) =>
      supplied.some((value) => recordValues(record).has(value))
    )
  }
}
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
const canonicalValue = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(canonicalValue)
  if (input && typeof input === 'object')
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, canonicalValue(value)])
    )
  return input
}
const hmacFingerprint = async (key: string, input: unknown) => {
  const imported = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    imported,
    new TextEncoder().encode(JSON.stringify(canonicalValue(input)))
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}
const fingerprint = (store: CustomerDirectoryState, input: unknown) =>
  Effect.promise(() => hmacFingerprint(store.fingerprintKey, input))
const hasReason = (reason: string) => reason.trim().length > 0
const mutableRecord = (record: CustomerRecord) =>
  record.status === 'active' || record.status === 'archived'

export const makeCustomerDirectoryService = (
  store: CustomerDirectoryState,
  fingerprintKey = 'customer-directory-seed-fingerprint-key'
): CustomerDirectoryShape => {
  store.fingerprintKey = fingerprintKey
  const self: CustomerDirectoryShape = {
    matchOrCreate: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const details = normalizeCustomerDetails(input.details)
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
        const candidates = matchableMerchantRecords(store, merchant.id)
        const { supplied, matching } = recordsMatchingDetails(candidates, details)
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
        const details = normalizeCustomerDetails(raw)
        const { matching: matches } = recordsMatchingDetails(
          matchableMerchantRecords(store, merchant.id),
          details
        )
        return matches.length === 1 && activeBan(matches[0]!, now)
          ? { kind: 'unavailable' as const }
          : { kind: 'eligible' as const }
      }),
    search: (query, options) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        return [...store.records.values()]
          .filter(
            (record) =>
              record.merchantId === merchant.id &&
              (record.status === 'active' ||
                (options?.includeArchived === true && record.status === 'archived')) &&
              customerRecordMatchesQuery(record, query)
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
        const details = normalizeCustomerDetails({
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
        input.kind === 'email'
          ? normalizeCustomerEmail(input.value)
          : normalizeCustomerPhone(input.value)
      const becomesPreferred = input.preferred && input.status === 'active'
      return mutate(
        store,
        recordId,
        input,
        'edited',
        () => ({
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
        }),
        null,
        (record) =>
          record.contacts.some(
            (contact) =>
              contact.kind === input.kind && contact.value === normalizedValue
          )
            ? null
            : new CapabilityNotFound({ resource: 'customer-contact' })
      )
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
      hasReason(input.reason)
        ? mutate(store, recordId, input, 'banned', (input) => ({
            ban: {
              reason: input.reason,
              actorId: input.actorId,
              createdAt: input.now,
              expiresAt: input.expiresAt
            }
          }))
        : Effect.fail(new CustomerDirectoryInvalid({ reason: 'reason_required' })),
    liftBan: (recordId, input) =>
      hasReason(input.reason)
        ? mutate(
            store,
            recordId,
            input,
            'ban_lifted',
            () => ({ ban: null }),
            input.reason
          )
        : Effect.fail(new CustomerDirectoryInvalid({ reason: 'reason_required' })),
    merge: (input) =>
      hasReason(input.reason)
        ? mergeRecords(store, input)
        : Effect.fail(new CustomerDirectoryInvalid({ reason: 'reason_required' })),
    split: (input) =>
      hasReason(input.reason)
        ? splitRecord(store, input)
        : Effect.fail(new CustomerDirectoryInvalid({ reason: 'reason_required' })),
    archive: (recordId, input) =>
      mutate(
        store,
        recordId,
        input,
        input.archived ? 'archived' : 'restored',
        () => ({ status: input.archived ? 'archived' : 'active' }),
        null,
        (record) =>
          record.status === (input.archived ? 'active' : 'archived')
            ? null
            : new CustomerDirectoryInvalid({ reason: 'invalid_record_status' })
      ),
    previewImport: (rows) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const candidates = matchableMerchantRecords(store, merchant.id)
        return rows.map((row, index) => {
          const normalized = normalizeCustomerDetails(row)
          if (validateDetails(normalized))
            return { row: index + 1, normalized, outcome: 'invalid' as const }
          const { supplied, matching } = recordsMatchingDetails(candidates, normalized)
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
        const importKey = `${merchant.id}:import-file:${input.fileId}`
        const commandFingerprint = yield* fingerprint(store, {
          fileId: input.fileId,
          rows: input.rows,
          actorId: input.actorId
        })
        const replay = store.commands.get(importKey)
        if (replay) {
          if (replay.fingerprint !== commandFingerprint)
            return yield* Effect.fail(
              new CapabilityConflict({ reason: 'idempotency_key_reused' })
            )
          if (replay.result._tag !== 'import')
            return yield* Effect.fail(
              new CapabilityConflict({ reason: 'idempotency_key_reused' })
            )
          return {
            created: replay.result.created,
            matched: replay.result.matched,
            rejected: replay.result.rejected
          }
        }
        let created = 0,
          matched = 0,
          rejected = 0
        for (let index = 0; index < input.rows.length; index++) {
          const row = input.rows[index]!
          const normalized = normalizeCustomerDetails(row)
          const rowKey = row.externalReference
            ? `${merchant.id}:import-row:${yield* fingerprint(store, {
                externalReference: row.externalReference
              })}`
            : null
          const rowFingerprint = yield* fingerprint(store, {
            name: normalized.name,
            email: normalized.email,
            phone: normalized.phone
          })
          const rowMappingPrefix = rowKey ? `${rowKey}=>` : null
          const existingRowMapping = rowMappingPrefix
            ? [...store.imports].find((entry) => entry.startsWith(rowMappingPrefix))
            : undefined
          if (existingRowMapping && rowMappingPrefix) {
            const [storedFingerprint, existingRecordId] = existingRowMapping
              .slice(rowMappingPrefix.length)
              .split('=>')
            const existingRecord = existingRecordId
              ? store.records.get(existingRecordId)
              : undefined
            if (!existingRecord || storedFingerprint !== rowFingerprint)
              return yield* Effect.fail(
                new CapabilityConflict({ reason: 'idempotency_key_reused' })
              )
            matched += 1
            continue
          }
          const { matching } = recordsMatchingDetails(
            matchableMerchantRecords(store, merchant.id),
            normalized
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
          else {
            if (result.success.matched) matched += 1
            else created += 1
            if (rowMappingPrefix)
              store.imports.add(
                `${rowMappingPrefix}${rowFingerprint}=>${result.success.record.id}`
              )
          }
        }
        store.imports.add(importKey)
        const result = { created, matched, rejected }
        store.commands.set(importKey, {
          fingerprint: commandFingerprint,
          result: { _tag: 'import', ...result }
        })
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
        const commandFingerprint = yield* fingerprint(store, {
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
          if (replay.result._tag !== 'count')
            return yield* Effect.fail(
              new CapabilityConflict({ reason: 'idempotency_key_reused' })
            )
          return replay.result.value
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
              observations: record.observations.map((observation) => ({
                ...observation,
                details: { name: 'Erased customer', email: null, phone: null }
              })),
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
          result: { _tag: 'count', value: count }
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
  store: CustomerDirectoryState,
  recordId: string,
  input: I,
  kind: CustomerHistory['kind'],
  change: (input: I) => Patch,
  reason: string | null = null,
  precondition?: (record: CustomerRecord, input: I) => CustomerDirectoryError | null
): Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext> =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    const record = store.records.get(recordId)
    if (!record || record.merchantId !== merchant.id)
      return yield* Effect.fail(new CapabilityNotFound({ resource: 'customer-record' }))
    const key = `${merchant.id}:${input.idempotencyKey}`,
      fp = yield* fingerprint(store, input),
      replay = store.commands.get(key)
    if (replay) {
      if (replay.fingerprint !== fp)
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      if (replay.result._tag !== 'record')
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      const current = store.records.get(replay.result.recordId)
      if (!current || current.merchantId !== merchant.id)
        return yield* Effect.fail(
          new CapabilityNotFound({ resource: 'customer-record' })
        )
      return current
    }
    if (!mutableRecord(record))
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'invalid_record_status' })
      )
    if (record.revision !== input.expectedRevision)
      return yield* Effect.fail(
        new CapabilityConflict({
          reason: 'stale_revision',
          currentRevision: record.revision
        })
      )
    const preconditionError = precondition?.(record, input)
    if (preconditionError) return yield* Effect.fail(preconditionError)
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
    store.commands.set(key, {
      fingerprint: fp,
      result: { _tag: 'record', recordId: next.id }
    })
    return next
  })

const mergeRecords = (
  store: CustomerDirectoryState,
  input: MergeInput
): Effect.Effect<CustomerRecord, CustomerDirectoryError, MerchantContext> =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    if (input.survivorId === input.absorbedId)
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'merge_records_must_be_distinct' })
      )
    const commandKey = `${merchant.id}:${input.idempotencyKey}`
    const commandFingerprint = yield* fingerprint(store, input)
    const replay = store.commands.get(commandKey)
    if (replay) {
      if (replay.fingerprint !== commandFingerprint)
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      if (replay.result._tag !== 'record')
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      const current = store.records.get(replay.result.recordId)
      if (!current || current.merchantId !== merchant.id)
        return yield* Effect.fail(
          new CapabilityNotFound({ resource: 'customer-record' })
        )
      return current
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
    if (survivor.status !== 'active' || absorbed.status !== 'active')
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'invalid_record_status' })
      )
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
      result: { _tag: 'record', recordId: merged.id }
    })
    return merged
  })

const splitRecord = (
  store: CustomerDirectoryState,
  input: SplitInput
): Effect.Effect<
  { source: CustomerRecord; created: CustomerRecord },
  CustomerDirectoryError,
  MerchantContext
> =>
  Effect.gen(function* () {
    const merchant = yield* MerchantContext
    const commandKey = `${merchant.id}:${input.idempotencyKey}`
    const commandFingerprint = yield* fingerprint(store, input)
    const replay = store.commands.get(commandKey)
    if (replay) {
      if (replay.fingerprint !== commandFingerprint)
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      if (replay.result._tag !== 'split')
        return yield* Effect.fail(
          new CapabilityConflict({ reason: 'idempotency_key_reused' })
        )
      const replayedSource = store.records.get(replay.result.sourceId)
      const replayedCreated = store.records.get(replay.result.createdId)
      if (!replayedSource || !replayedCreated)
        return yield* Effect.fail(
          new CapabilityNotFound({ resource: 'customer-record' })
        )
      return { source: replayedSource, created: replayedCreated }
    }
    const source = store.records.get(input.sourceId)
    if (!source || source.merchantId !== merchant.id)
      return yield* Effect.fail(new CapabilityNotFound({ resource: 'customer-record' }))
    if (source.status !== 'active')
      return yield* Effect.fail(
        new CustomerDirectoryInvalid({ reason: 'invalid_record_status' })
      )
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
    const details = normalizeCustomerDetails(input.createdDetails ?? first.details)
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
      result: {
        _tag: 'split',
        sourceId: result.source.id,
        createdId: result.created.id
      }
    })
    return result
  })
