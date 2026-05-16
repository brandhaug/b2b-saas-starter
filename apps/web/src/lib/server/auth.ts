import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { Session } from '@b2b-saas-starter/auth'
import { createServerContext } from '../server-context'

const getSessionServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Session | null> => {
    const request = getRequest()
    const auth = createServerContext().auth()
    return auth.api.getSession({ headers: request.headers })
  }
)

export async function requireSession(redirectTo: string): Promise<Session> {
  const session = await getSessionServerFn()
  if (!session) {
    throw redirect({ to: '/sign-in', search: { redirect: redirectTo } })
  }
  return session
}
