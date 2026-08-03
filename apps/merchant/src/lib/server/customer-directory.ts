import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { type CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import {
  makeCustomerDirectoryRequestHandler,
  type CustomerDirectoryRunner
} from './customer-directory-handler.ts'
import { runCustomerDirectoryRequest } from './customer-directory-runner.ts'
import { runMerchantRequest } from './merchant-session.ts'
import { customerImportFileId } from './customer-import-id.ts'

const directoryFingerprintKey = () => {
  const key = env.CUSTOMER_DIRECTORY_FINGERPRINT_KEY?.trim()
  if (!key) throw new Error('CUSTOMER_DIRECTORY_FINGERPRINT_KEY is required.')
  return key
}

const RecordId = Schema.Struct({ recordId: Schema.String })
const Mutation = {
  recordId: Schema.String,
  expectedRevision: Schema.Number,
  idempotencyKey: Schema.String
} as const
const AuditReason = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1))
const EditPreferred = Schema.Struct({
  ...Mutation,
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String)
})
const AddNote = Schema.Struct({ ...Mutation, text: Schema.String })
const SetContactStatus = Schema.Struct({
  ...Mutation,
  kind: Schema.Literals(['email', 'phone']),
  value: Schema.String,
  status: Schema.Literals(['active', 'disputed', 'superseded']),
  preferred: Schema.Boolean
})
const RecordConsent = Schema.Struct({
  ...Mutation,
  purpose: Schema.Literals(['operational_mobile', 'marketing']),
  destination: Schema.String,
  wordingVersion: Schema.String,
  source: Schema.String,
  withdrawn: Schema.Boolean
})
const SetBan = Schema.Struct({
  ...Mutation,
  reason: AuditReason,
  expiresAt: Schema.NullOr(Schema.String)
})
const LiftBan = Schema.Struct({ ...Mutation, reason: AuditReason })
const Archive = Schema.Struct({ ...Mutation, archived: Schema.Boolean })
const Merge = Schema.Struct({
  survivorId: Schema.String,
  absorbedId: Schema.String,
  expectedSurvivorRevision: Schema.Number,
  expectedAbsorbedRevision: Schema.Number,
  idempotencyKey: Schema.String,
  preferredDetailsSourceId: Schema.optional(Schema.String),
  reason: AuditReason
}).check(
  Schema.makeFilter((input) =>
    input.survivorId === input.absorbedId
      ? { path: ['absorbedId'], issue: 'merge records must be distinct' }
      : undefined
  )
)
const Split = Schema.Struct({
  sourceId: Schema.String,
  observationIds: Schema.Array(Schema.String),
  expectedRevision: Schema.Number,
  idempotencyKey: Schema.String,
  createdDetails: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      email: Schema.NullOr(Schema.String),
      phone: Schema.NullOr(Schema.String)
    })
  ),
  contactKeys: Schema.optional(
    Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(['email', 'phone']),
        value: Schema.String
      })
    )
  ),
  noteIds: Schema.optional(Schema.Array(Schema.String)),
  consentIds: Schema.optional(Schema.Array(Schema.String)),
  reason: AuditReason
})
const ImportRow = Schema.Struct({
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  externalReference: Schema.optional(Schema.String)
})
const ImportRows = Schema.Struct({
  fileId: Schema.String,
  idempotencyKey: Schema.String,
  expectedRevisions: Schema.Record(Schema.String, Schema.Number),
  rows: Schema.Array(ImportRow)
})

const run: CustomerDirectoryRunner = (userId, effect) =>
  runCustomerDirectoryRequest({
    db: env.DB,
    userId,
    fingerprintKey: directoryFingerprintKey(),
    effect
  })

const requestsFor = (userId: string) =>
  makeCustomerDirectoryRequestHandler({
    currentUserId: async () => userId,
    run,
    now: () => new Date().toISOString()
  })

export const searchCustomerRecords = createServerFn({ method: 'GET' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        query: Schema.String,
        includeArchived: Schema.optional(Schema.Boolean)
      })
    )
  )
  .handler(
    ({ data }): Promise<readonly CustomerRecord[]> =>
      runMerchantRequest('customer.read', (session) =>
        requestsFor(session.user.id).search(data.query, {
          includeArchived: data.includeArchived === true
        })
      )
  )

export const getCustomerRecord = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(RecordId))
  .handler(
    ({ data }): Promise<CustomerRecord> =>
      runMerchantRequest('customer.read', (session) =>
        requestsFor(session.user.id).get(data.recordId)
      )
  )

const mutate = <A>(use: (requests: ReturnType<typeof requestsFor>) => Promise<A>) =>
  runMerchantRequest('customer.update', (session) => use(requestsFor(session.user.id)))

export const editCustomerPreferred = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(EditPreferred))
  .handler(({ data }) =>
    mutate((requests) => requests.editPreferred(data.recordId, data))
  )

export const addCustomerNote = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(AddNote))
  .handler(({ data }) => mutate((requests) => requests.addNote(data.recordId, data)))

export const setCustomerContactStatus = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SetContactStatus))
  .handler(({ data }) =>
    mutate((requests) => requests.setContactStatus(data.recordId, data))
  )

export const recordCustomerConsent = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RecordConsent))
  .handler(({ data }) =>
    mutate((requests) => requests.recordConsent(data.recordId, data))
  )

export const banCustomer = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SetBan))
  .handler(({ data }) => mutate((requests) => requests.setBan(data.recordId, data)))

export const liftCustomerBan = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(LiftBan))
  .handler(({ data }) => mutate((requests) => requests.liftBan(data.recordId, data)))

export const archiveCustomer = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Archive))
  .handler(({ data }) => mutate((requests) => requests.archive(data.recordId, data)))

export const mergeCustomers = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Merge))
  .handler(({ data }) =>
    mutate((requests) =>
      requests.merge({
        survivorId: data.survivorId,
        absorbedId: data.absorbedId,
        expectedSurvivorRevision: data.expectedSurvivorRevision,
        expectedAbsorbedRevision: data.expectedAbsorbedRevision,
        idempotencyKey: data.idempotencyKey,
        reason: data.reason,
        ...(data.preferredDetailsSourceId === undefined
          ? {}
          : { preferredDetailsSourceId: data.preferredDetailsSourceId })
      })
    )
  )

export const splitCustomer = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Split))
  .handler(({ data }) =>
    mutate((requests) =>
      requests.split({
        sourceId: data.sourceId,
        observationIds: data.observationIds,
        expectedRevision: data.expectedRevision,
        idempotencyKey: data.idempotencyKey,
        reason: data.reason,
        ...(data.createdDetails === undefined
          ? {}
          : { createdDetails: data.createdDetails }),
        ...(data.contactKeys === undefined ? {} : { contactKeys: data.contactKeys }),
        ...(data.noteIds === undefined ? {} : { noteIds: data.noteIds }),
        ...(data.consentIds === undefined ? {} : { consentIds: data.consentIds })
      })
    )
  )

export const importCustomers = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ImportRows))
  .handler(async ({ data }) => {
    const fileId = await customerImportFileId(data.rows, directoryFingerprintKey())
    return mutate((requests) =>
      requests.importRows({
        ...data,
        fileId,
        rows: data.rows.map((row) => ({
          name: row.name,
          email: row.email,
          phone: row.phone,
          ...(row.externalReference === undefined
            ? {}
            : { externalReference: row.externalReference })
        }))
      })
    )
  })

export const previewCustomerImport = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(ImportRow) })))
  .handler(({ data }) =>
    runMerchantRequest('customer.read', (session) =>
      requestsFor(session.user.id).previewImport(
        data.rows.map((row) => ({
          name: row.name,
          email: row.email,
          phone: row.phone
        }))
      )
    )
  )

export const exportCustomers = createServerFn({ method: 'GET' }).handler(() =>
  runMerchantRequest('customer.read', (session) =>
    requestsFor(session.user.id).exportMinimized()
  )
)
