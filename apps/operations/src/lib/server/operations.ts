import { env } from 'cloudflare:workers'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import type {
  MerchantDetail,
  MerchantMemberDetail,
  MerchantMemberSearchResult,
  MerchantSearchResult,
  OperationsAuditEventDetail,
  OperationsAuditEventSummary,
  OperatorPrincipal
} from '@b2b-saas-starter/capabilities/operations'
import { createOperationsWorker, type OperationsWorkerEnv } from '@/index.ts'

export type ScreenResult<A> =
  | { readonly state: 'ready'; readonly data: A }
  | { readonly state: 'unauthenticated' }
  | { readonly state: 'forbidden' }
  | { readonly state: 'not-found' }
  | { readonly state: 'unavailable' }

export type ManagedOperatorView = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly enabled: boolean
  readonly enrollmentState: 'complete' | 'incomplete'
  readonly roles: readonly string[]
  readonly activeSession: {
    readonly active: boolean
    readonly absoluteExpiresAt: string | null
  }
  readonly lastSignInAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

type AuditPage = {
  readonly events: readonly OperationsAuditEventSummary[]
  readonly nextCursor: string | null
}

const worker = createOperationsWorker()

export type MutationResult<A = never> =
  | { readonly state: 'ready'; readonly data: A }
  | { readonly state: 'redirect'; readonly location: string }
  | { readonly state: 'rejected'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string }

const read = createServerOnlyFn(async <A>(path: string): Promise<ScreenResult<A>> => {
  const incoming = getRequest()
  const response = await worker.fetch(
    new Request(new URL(path, incoming.url), {
      method: 'GET',
      headers: incoming.headers,
      redirect: 'manual'
    }),
    env as unknown as OperationsWorkerEnv
  )
  if (response.status === 303 || response.status === 401)
    return { state: 'unauthenticated' }
  if (response.status === 403) return { state: 'forbidden' }
  if (response.status === 404) return { state: 'not-found' }
  if (!response.ok) return { state: 'unavailable' }
  return { state: 'ready', data: (await response.json()) as A }
})

const queryString = (values: Record<string, string | undefined>): string => {
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) if (value) query.set(name, value)
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

const submit = createServerOnlyFn(
  async <A>(
    path: string,
    values: Record<string, string | readonly string[]>
  ): Promise<MutationResult<A>> => {
    const incoming = getRequest()
    const form = new FormData()
    for (const [name, value] of Object.entries(values)) {
      if (Array.isArray(value)) value.forEach((item) => form.append(name, item))
      else form.set(name, value as string)
    }
    const response = await worker.fetch(
      new Request(new URL(path, incoming.url), {
        method: 'POST',
        headers: {
          cookie: incoming.headers.get('cookie') ?? '',
          accept: 'application/json'
        },
        body: form,
        redirect: 'manual'
      }),
      env as unknown as OperationsWorkerEnv
    )
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) setResponseHeader('set-cookie', cookies)
    if (response.status === 303)
      return { state: 'redirect', location: response.headers.get('location') ?? '/' }
    if (!response.ok)
      return {
        state: response.status >= 500 ? 'unavailable' : 'rejected',
        message:
          response.status >= 500
            ? 'Operations is temporarily unavailable.'
            : 'The request was not accepted.'
      }
    return { state: 'ready', data: (await response.json()) as A }
  }
)

export const getOperationsSession = createServerFn({ method: 'GET' }).handler(() =>
  read<{ readonly principal: OperatorPrincipal }>('/api/operations/session')
)

export const searchOperations = createServerFn({ method: 'GET' })
  .validator(
    (input: { readonly kind: 'merchant' | 'member'; readonly query: string }) => input
  )
  .handler(({ data }) =>
    read<{
      readonly results: readonly (MerchantSearchResult | MerchantMemberSearchResult)[]
    }>(
      `${data.kind === 'merchant' ? '/api/merchants/search' : '/api/members/search'}${queryString({ q: data.query, limit: '20' })}`
    )
  )

export const getMerchant = createServerFn({ method: 'GET' })
  .validator((merchantId: string) => merchantId)
  .handler(({ data }) =>
    read<MerchantDetail>(`/api/merchants/${encodeURIComponent(data)}`)
  )

export const getMerchantMember = createServerFn({ method: 'GET' })
  .validator(
    (input: { readonly merchantId: string; readonly memberId: string }) => input
  )
  .handler(({ data }) =>
    read<MerchantMemberDetail>(
      `/api/merchants/${encodeURIComponent(data.merchantId)}/members/${encodeURIComponent(data.memberId)}`
    )
  )

export const getManagedOperators = createServerFn({ method: 'GET' }).handler(() =>
  read<{
    readonly actorOperatorId: string
    readonly operators: readonly ManagedOperatorView[]
  }>('/api/operations/operators')
)

export const getAuditEvents = createServerFn({ method: 'GET' })
  .validator((input: Record<string, string | undefined>) => input)
  .handler(({ data }) => read<AuditPage>(`/api/operations/audit${queryString(data)}`))

export const getAuditEvent = createServerFn({ method: 'GET' })
  .validator((eventId: string) => eventId)
  .handler(({ data }) =>
    read<{ readonly event: OperationsAuditEventDetail }>(
      `/api/operations/audit/${encodeURIComponent(data)}`
    )
  )

export const signInOperator = createServerFn({ method: 'POST' })
  .validator((input: { readonly email: string; readonly password: string }) => input)
  .handler(({ data }) => submit<null>('/sign-in', data))

export const verifyOperatorTotp = createServerFn({ method: 'POST' })
  .validator((input: { readonly code: string }) => input)
  .handler(({ data }) => submit<null>('/verify-totp', data))

export const acceptOperatorInvitation = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      readonly token: string
      readonly name: string
      readonly password: string
    }) => input
  )
  .handler(({ data }) => submit<null>('/enroll/accept', data))

export const startOperatorSecurityEnrollment = createServerFn({ method: 'POST' })
  .validator((input: { readonly password: string }) => input)
  .handler(({ data }) =>
    submit<{ readonly totpURI: string; readonly backupCodes: readonly string[] }>(
      '/enroll/security/start',
      data
    )
  )

export const completeOperatorSecurityEnrollment = createServerFn({ method: 'POST' })
  .validator(
    (input: { readonly code: string; readonly backupCodesConfirmed: string }) => input
  )
  .handler(({ data }) => submit<null>('/enroll/security/complete', data))

export const inviteOperator = createServerFn({ method: 'POST' })
  .validator(
    (input: { readonly email: string; readonly roles: readonly string[] }) => input
  )
  .handler(({ data }) =>
    submit<{
      readonly invitation: {
        readonly id: string
        readonly email: string
        readonly expiresAt: string
      }
    }>('/operators/invitations', data)
  )

export const startImpersonation = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      readonly merchantId: string
      readonly memberId: string
      readonly reason: string
      readonly supportReference: string
      readonly code: string
    }) => input
  )
  .handler(({ data }) =>
    submit<{
      readonly handoffTicket: string
      readonly expiresAt: string
      readonly merchantAppOrigin: string
    }>(
      `/merchants/${encodeURIComponent(data.merchantId)}/members/${encodeURIComponent(data.memberId)}/impersonations`,
      data
    )
  )
