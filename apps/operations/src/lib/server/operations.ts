import { env } from 'cloudflare:workers'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import {
  MerchantDetail,
  MerchantMemberDetail,
  MerchantMemberSearchResult,
  MerchantSearchResult,
  OperationsAuditIdentity,
  OperationsAuditRetentionPolicy,
  OperatorRole
} from '@b2b-saas-starter/capabilities/operations'
import { Schema } from 'effect'
import { createOperationsWorker, type OperationsWorkerEnv } from '@/index.ts'

export type ScreenResult<A> =
  | { readonly state: 'ready'; readonly data: A }
  | { readonly state: 'unauthenticated' }
  | { readonly state: 'expired' }
  | { readonly state: 'forbidden' }
  | { readonly state: 'not-found' }
  | { readonly state: 'unavailable' }

const ManagedOperatorView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  enabled: Schema.Boolean,
  enrollmentState: Schema.Literals(['complete', 'incomplete']),
  roles: Schema.Array(OperatorRole),
  activeSession: Schema.Struct({
    active: Schema.Boolean,
    absoluteExpiresAt: Schema.NullOr(Schema.String)
  }),
  lastSignInAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
})
export type ManagedOperatorView = typeof ManagedOperatorView.Type

const AuditEventSummary = Schema.Struct({
  id: Schema.String,
  actor: OperationsAuditIdentity,
  operatorSessionId: Schema.NullOr(Schema.String),
  impersonationId: Schema.NullOr(Schema.String),
  target: Schema.NullOr(OperationsAuditIdentity),
  merchant: Schema.NullOr(OperationsAuditIdentity),
  action: Schema.String,
  result: Schema.Literals(['accepted', 'rejected']),
  occurredAt: Schema.String,
  retentionPolicy: OperationsAuditRetentionPolicy,
  retainUntil: Schema.NullOr(Schema.String)
})

const AuditEventDetail = Schema.Struct({
  ...AuditEventSummary.fields,
  internalReason: Schema.NullOr(Schema.String),
  supportReference: Schema.NullOr(Schema.String)
})

const worker = createOperationsWorker()

const BoundedText = Schema.String.check(Schema.isMaxLength(1_000))
const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
const MutationValues = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Array(Schema.String)])
)

export type MutationResult<A = never> =
  | { readonly state: 'ready'; readonly data: A }
  | { readonly state: 'redirect'; readonly location: string }
  | { readonly state: 'expired'; readonly message: string }
  | { readonly state: 'validation'; readonly message: string }
  | { readonly state: 'forbidden'; readonly message: string }
  | { readonly state: 'conflict'; readonly message: string }
  | { readonly state: 'rate-limited'; readonly message: string }
  | { readonly state: 'rejected'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string }

const read = createServerOnlyFn(
  async <A>(
    path: string,
    schema: Schema.ConstraintDecoder<A>
  ): Promise<ScreenResult<A>> => {
    const incoming = getRequest()
    const headers = new Headers(incoming.headers)
    headers.set('accept', 'application/json')
    const response = await worker.fetch(
      new Request(new URL(path, incoming.url), {
        method: 'GET',
        headers,
        redirect: 'manual'
      }),
      env as unknown as OperationsWorkerEnv
    )
    if (response.status === 303 || response.status === 401)
      return { state: 'unauthenticated' }
    if (response.status === 410) return { state: 'expired' }
    if (response.status === 403) return { state: 'forbidden' }
    if (response.status === 404) return { state: 'not-found' }
    if (!response.ok) return { state: 'unavailable' }
    return {
      state: 'ready',
      data: Schema.decodeUnknownSync(schema)(await response.json())
    }
  }
)

const queryString = (values: Record<string, string | undefined>): string => {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) if (value) query.set(name, value)
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

const submit = createServerOnlyFn(
  async <A>(
    path: string,
    values: typeof MutationValues.Type,
    schema: Schema.ConstraintDecoder<A>
  ): Promise<MutationResult<A>> => {
    const incoming = getRequest()
    const form = new FormData()
    for (const [name, value] of Object.entries(values)) {
      if (Array.isArray(value)) value.forEach((item) => form.append(name, item))
      else form.set(name, value as string)
    }
    const headers = new Headers(incoming.headers)
    headers.set('accept', 'application/json')
    headers.delete('content-length')
    headers.delete('content-type')
    const response = await worker.fetch(
      new Request(new URL(path, incoming.url), {
        method: 'POST',
        headers,
        body: form,
        redirect: 'manual'
      }),
      env as unknown as OperationsWorkerEnv
    )
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) setResponseHeader('set-cookie', cookies)
    if (response.status === 303)
      return { state: 'redirect', location: response.headers.get('location') ?? '/' }
    if (response.status === 401)
      return {
        state: 'expired',
        message: 'This secure interaction has expired. Sign in and try again.'
      }
    if (response.status === 400)
      return {
        state: 'validation',
        message: 'Check the submitted values and try again.'
      }
    if (response.status === 403)
      return {
        state: 'forbidden',
        message: 'Your current Operator Permissions do not allow this action.'
      }
    if (response.status === 409)
      return {
        state: 'conflict',
        message: 'Authoritative state changed or the action conflicts with open work.'
      }
    if (response.status === 429)
      return {
        state: 'rate-limited',
        message: 'Too many attempts. Wait for the retry window before trying again.'
      }
    if (!response.ok)
      return {
        state: response.status >= 500 ? 'unavailable' : 'rejected',
        message:
          response.status >= 500
            ? 'Operations is temporarily unavailable.'
            : 'The request was not accepted.'
      }
    return {
      state: 'ready',
      data: Schema.decodeUnknownSync(schema)(await response.json())
    }
  }
)

export const getOperationsSession = createServerFn({ method: 'GET' }).handler(() =>
  read(
    '/api/operations/session',
    Schema.Struct({
      principal: Schema.Struct({
        id: Schema.String,
        sessionId: Schema.String,
        email: Schema.String,
        name: Schema.String,
        roles: Schema.Array(OperatorRole),
        idleExpiresAt: Schema.String,
        absoluteExpiresAt: Schema.String
      })
    })
  )
)

export const getOperatorEnrollment = createServerFn({ method: 'GET' }).handler(() =>
  read('/api/operations/enrollment', Schema.Struct({ email: Schema.String }))
)

export const searchOperations = createServerFn({ method: 'GET' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        kind: Schema.Literals(['merchant', 'member']),
        query: Schema.String.check(Schema.isMaxLength(100))
      })
    )
  )
  .handler(({ data }) =>
    read(
      `${data.kind === 'merchant' ? '/api/merchants/search' : '/api/members/search'}${queryString({ q: data.query, limit: '20' })}`,
      Schema.Struct({
        results: Schema.Array(
          Schema.Union([MerchantSearchResult, MerchantMemberSearchResult])
        )
      })
    )
  )

export const getMerchant = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(Identifier))
  .handler(({ data }) =>
    read(`/api/merchants/${encodeURIComponent(data)}`, MerchantDetail)
  )

export const getMerchantMember = createServerFn({ method: 'GET' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ merchantId: Identifier, memberId: Identifier })
    )
  )
  .handler(({ data }) =>
    read(
      `/api/merchants/${encodeURIComponent(data.merchantId)}/members/${encodeURIComponent(data.memberId)}`,
      MerchantMemberDetail
    )
  )

export const getManagedOperators = createServerFn({ method: 'GET' }).handler(() =>
  read(
    '/api/operations/operators',
    Schema.Struct({
      actorOperatorId: Schema.String,
      operators: Schema.Array(ManagedOperatorView)
    })
  )
)

export const getAuditEvents = createServerFn({ method: 'GET' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        action: Schema.optional(BoundedText),
        result: Schema.optional(Schema.Literals(['accepted', 'rejected'])),
        operator: Schema.optional(Identifier),
        merchant: Schema.optional(Identifier),
        target: Schema.optional(Identifier),
        cursor: Schema.optional(Schema.String)
      })
    )
  )
  .handler(({ data }) =>
    read(
      `/api/operations/audit${queryString(data)}`,
      Schema.Struct({
        events: Schema.Array(AuditEventSummary),
        nextCursor: Schema.NullOr(Schema.String)
      })
    )
  )

export const getAuditEvent = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(Identifier))
  .handler(({ data }) =>
    read(
      `/api/operations/audit/${encodeURIComponent(data)}`,
      Schema.Struct({ event: AuditEventDetail })
    )
  )

export const signInOperator = createServerFn({ method: 'POST' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ email: Identifier, password: Schema.String })
    )
  )
  .handler(({ data }) => submit('/sign-in', data, Schema.Null))

export const verifyOperatorTotp = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Schema.Struct({ code: Identifier })))
  .handler(({ data }) => submit('/verify-totp', data, Schema.Null))

export const acceptOperatorInvitation = createServerFn({ method: 'POST' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ token: Identifier, name: BoundedText, password: Schema.String })
    )
  )
  .handler(({ data }) => submit('/enroll/accept', data, Schema.Null))

export const startOperatorSecurityEnrollment = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(Schema.Struct({ password: Schema.String })))
  .handler(({ data }) =>
    submit(
      '/enroll/security/start',
      data,
      Schema.Struct({
        totpURI: Schema.String,
        backupCodes: Schema.Array(Schema.String)
      })
    )
  )

export const completeOperatorSecurityEnrollment = createServerFn({ method: 'POST' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ code: Identifier, backupCodesConfirmed: Schema.Literal('yes') })
    )
  )
  .handler(({ data }) => submit('/enroll/security/complete', data, Schema.Null))

export const inviteOperator = createServerFn({ method: 'POST' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ email: Identifier, roles: Schema.Array(OperatorRole) })
    )
  )
  .handler(({ data }) =>
    submit(
      '/operators/invitations',
      data,
      Schema.Struct({
        invitation: Schema.Struct({
          id: Schema.String,
          email: Schema.String,
          expiresAt: Schema.String
        })
      })
    )
  )

export const startImpersonation = createServerFn({ method: 'POST' })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        merchantId: Identifier,
        memberId: Identifier,
        reason: BoundedText,
        supportReference: BoundedText,
        code: Identifier
      })
    )
  )
  .handler(({ data }) =>
    submit(
      `/merchants/${encodeURIComponent(data.merchantId)}/members/${encodeURIComponent(data.memberId)}/impersonations`,
      data,
      Schema.Struct({
        handoffTicket: Schema.String,
        expiresAt: Schema.String,
        merchantAppOrigin: Schema.String
      })
    )
  )
