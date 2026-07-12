import { Effect } from 'effect'
import type {
  CustomerAccountSession,
  VerifiedContinuation,
  VerifiedCustomerPrincipal
} from '@b2b-saas-starter/capabilities/customer-identity'

export type CustomerContinuationDependencies = {
  readonly principal: (headers: Headers) => Promise<VerifiedCustomerPrincipal | null>
  readonly establishSession: (input: {
    readonly principal: VerifiedCustomerPrincipal
    readonly now: string
    readonly expiresAt: string
  }) => Effect.Effect<CustomerAccountSession, unknown>
  readonly recover: (input: {
    readonly session: CustomerAccountSession
    readonly merchantId: string
    readonly confirmationRouteId: string
    readonly now: string
  }) => Effect.Effect<VerifiedContinuation, unknown>
  readonly reissue: (
    input: VerifiedContinuation & { readonly now: string }
  ) => Effect.Effect<
    { readonly routeId: string; readonly cookieCredential: string },
    unknown
  >
}

const hidden = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'private, no-store' }
  })

export const recoverVerifiedContinuation = async (
  request: Request,
  input: {
    readonly merchantId: string
    readonly merchantSlug: string
    readonly routeId: string
  },
  dependencies: CustomerContinuationDependencies
): Promise<Response> => {
  if (request.method !== 'POST')
    return new Response('Method not allowed', { status: 405 })
  const principal = await dependencies.principal(request.headers)
  if (!principal) return hidden()
  const now = new Date().toISOString()
  const result = await Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const session = yield* dependencies.establishSession({
          principal,
          now,
          expiresAt: new Date(Date.parse(now) + 30 * 24 * 60 * 60_000).toISOString()
        })
        const continuation = yield* dependencies.recover({
          session,
          merchantId: input.merchantId,
          confirmationRouteId: input.routeId,
          now
        })
        return yield* dependencies.reissue({ ...continuation, now })
      })
    )
  )
  if (result._tag === 'Failure') return hidden()
  const canonicalPath = `/${encodeURIComponent(input.merchantSlug)}/booking/confirmations/${encodeURIComponent(result.success.routeId)}`
  const headers = new Headers({
    location: canonicalPath,
    'cache-control': 'private, no-store'
  })
  headers.append(
    'set-cookie',
    [
      `confirmation_${result.success.routeId}=${result.success.cookieCredential}`,
      `Path=${canonicalPath}`,
      'Max-Age=86400',
      'HttpOnly',
      new URL(request.url).protocol === 'https:' ? 'Secure' : null,
      'SameSite=Lax'
    ]
      .filter((part): part is string => part !== null)
      .join('; ')
  )
  return new Response(null, { status: 303, headers })
}
