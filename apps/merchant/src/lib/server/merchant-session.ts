import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { Effect, Schema } from 'effect'
import type { ImpersonatedMerchantAction } from '@b2b-saas-starter/capabilities/operations'
import {
  OperationsImpersonationAuthority,
  makeOperationsImpersonationAuthorityLayer
} from '@b2b-saas-starter/capabilities/operations'
import { createMerchantServerContext } from '../server-context.ts'
import { merchantSessionOrRedirect } from './merchant-navigation-session.ts'
import { makeMerchantRequestAuthority } from './merchant-request-authority.ts'

const readSession = createServerOnlyFn(() => {
  const request = getRequest()
  return createMerchantServerContext().auth().api.getSession({
    headers: request.headers
  })
})

const merchantRequests = () => {
  const context = createMerchantServerContext()
  const layer = makeOperationsImpersonationAuthorityLayer(context.db(), {
    securityContact: env.OPERATIONS_SECURITY_CONTACT ?? ''
  })
  return makeMerchantRequestAuthority({
    readSession,
    authority: {
      authorize: (input) =>
        Effect.runPromise(
          Effect.flatMap(OperationsImpersonationAuthority, (authority) =>
            authority.authorize(input)
          ).pipe(Effect.provide(layer))
        ),
      recordMutation: (input) =>
        Effect.runPromise(
          Effect.flatMap(OperationsImpersonationAuthority, (authority) =>
            authority.recordMutation(input)
          ).pipe(Effect.provide(layer))
        )
    },
    unauthorized: () =>
      new MerchantUnauthorizedError({
        message: 'Your Merchant App session has expired. Sign in and retry.'
      })
  })
}

const getSession = createServerFn({ method: 'GET' }).handler(
  async () =>
    (await merchantRequests().authorizeOptional('merchant.navigate'))?.session ?? null
)

export const getMerchantViewer = createServerFn({ method: 'GET' }).handler(async () => {
  const authorized = await merchantRequests().authorizeOptional('merchant.navigate')
  const name = authorized?.session.user.name?.trim()
  return name ? { name } : null
})

/** Navigation uses a redirect; server mutations must use UnauthorizedError. */
export const requireMerchantSession = async (redirectTo: string) => {
  return merchantSessionOrRedirect(await getSession(), redirectTo)
}

export class MerchantUnauthorizedError extends Schema.TaggedErrorClass<MerchantUnauthorizedError>()(
  'MerchantUnauthorizedError',
  { message: Schema.String }
) {}

export const requireMerchantRequestSession = async (
  action: ImpersonatedMerchantAction = 'merchant.navigate'
) => (await merchantRequests().authorize(action)).session

export const runMerchantRequest = <Result>(
  action: ImpersonatedMerchantAction,
  use: (session: Awaited<ReturnType<typeof readSession>> & {}) => Promise<Result>
): Promise<Result> => merchantRequests().run(action, use)

export const runMerchantRequestWithSession = <Result>(
  session: Awaited<ReturnType<typeof readSession>> & {},
  action: ImpersonatedMerchantAction,
  use: (session: Awaited<ReturnType<typeof readSession>> & {}) => Promise<Result>
): Promise<Result> => merchantRequests().runSession(session, action, use)
