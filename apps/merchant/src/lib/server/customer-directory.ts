import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { type CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { liveMerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import {
  makeCustomerDirectoryRequestHandler,
  type CustomerDirectoryRunner
} from './customer-directory-handler.ts'
import { runMerchantRequest } from './merchant-session.ts'

const RecordId = Schema.Struct({ recordId: Schema.String })
const Mutation = {
  recordId: Schema.String,
  expectedRevision: Schema.Number,
  idempotencyKey: Schema.String
} as const
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
  reason: Schema.String,
  expiresAt: Schema.NullOr(Schema.String)
})
const LiftBan = Schema.Struct({ ...Mutation, reason: Schema.String })
const Archive = Schema.Struct({ ...Mutation, archived: Schema.Boolean })
const Merge = Schema.Struct({
  survivorId: Schema.String,
  absorbedId: Schema.String,
  expectedSurvivorRevision: Schema.Number,
  expectedAbsorbedRevision: Schema.Number,
  idempotencyKey: Schema.String,
  preferredDetailsSourceId: Schema.optional(Schema.String),
  reason: Schema.String
})
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
  noteIds: Schema.optional(Schema.Array(Schema.String)),
  consentIds: Schema.optional(Schema.Array(Schema.String)),
  reason: Schema.String
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

const run: CustomerDirectoryRunner = async (userId, effect) => {
  if (!env.DB) throw new Error('Customer Directory requires D1.')
  const context = liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(selectCapabilitiesLayer({ DB: env.DB }), context)
    )
  )
}

const requestsFor = (userId: string) =>
  makeCustomerDirectoryRequestHandler({
    currentUserId: async () => userId,
    run,
    now: () => new Date().toISOString()
  })

export const searchCustomerRecords = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String })))
  .handler(
    ({ data }): Promise<readonly CustomerRecord[]> =>
      runMerchantRequest('customer.read', (session) =>
        requestsFor(session.user.id).search(data.query)
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
  .handler(({ data }) => mutate((requests) => requests.merge(data)))

export const splitCustomer = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Split))
  .handler(({ data }) => mutate((requests) => requests.split(data)))

export const importCustomers = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ImportRows))
  .handler(({ data }) =>
    mutate((requests) =>
      requests.importRows({
        ...data,
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
  )

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
