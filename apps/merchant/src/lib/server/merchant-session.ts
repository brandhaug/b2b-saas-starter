import { redirect } from '@tanstack/react-router'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import { createMerchantServerContext } from '../server-context.ts'

const readSession = createServerOnlyFn(() => {
  const request = getRequest()
  return createMerchantServerContext().auth().api.getSession({
    headers: request.headers
  })
})

const getSession = createServerFn({ method: 'GET' }).handler(readSession)

/** Navigation uses a redirect; server mutations must use UnauthorizedError. */
export const requireMerchantSession = async (redirectTo: string) => {
  const session = await getSession()
  if (!session) {
    throw redirect({ to: '/sign-in', search: { redirect: redirectTo } })
  }
  return session
}

export class MerchantUnauthorizedError extends Schema.TaggedErrorClass<MerchantUnauthorizedError>()(
  'MerchantUnauthorizedError',
  { message: Schema.String }
) {}

export const requireMerchantRequestSession = async () => {
  const session = await readSession()
  if (!session) {
    throw new MerchantUnauthorizedError({
      message: 'Your Merchant App session has expired. Sign in and retry.'
    })
  }
  return session
}
