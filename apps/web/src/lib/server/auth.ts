import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { Session } from '@b2b-saas-starter/auth'
import { createServerContext } from '../server-context'

const readSession = createServerOnlyFn((): Promise<Session | null> => {
  const request = getRequest()
  const auth = createServerContext().auth()
  return auth.api.getSession({ headers: request.headers })
})

const getSessionServerFn = createServerFn({ method: 'GET' }).handler(readSession)

/**
 * Route gate for `beforeLoad`. Redirects unauthenticated visitors to
 * `/sign-in` and returns the session so loaders can pass the actor to
 * `runWorkspaceCapabilities`.
 */
export async function requireSession(redirectTo: string): Promise<Session> {
  const session = await getSessionServerFn()
  if (!session) {
    throw redirect({ to: '/sign-in', search: { redirect: redirectTo } })
  }
  return session
}

/**
 * Route gate for admin-only routes. Requires a session AND the Better Auth
 * admin role (`user.role === 'admin'`, see `admin({ adminRoles })` in
 * packages/auth). Non-admins get a 404 rather than a 403 so the route's
 * existence is not disclosed.
 */
export async function requireAdmin(redirectTo: string): Promise<Session> {
  const session = await requireSession(redirectTo)
  if (session.user.role !== 'admin') {
    throw notFound()
  }
  return session
}

/**
 * Typed failure for server-function handlers on session expiry. XHR
 * mutations must not be redirected — redirects belong to navigation gates
 * (`requireSession`/`requireAdmin`) only. Server functions serialize thrown
 * errors back to the caller with `name`/`message` intact, so form callers
 * surface `message` directly (see `api-token-form.tsx`).
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('Your session has expired — sign in again and retry.')
    this.name = 'UnauthorizedError'
  }
}

/**
 * Session gate for server-function handlers (already on the server, so it
 * reads the request directly instead of round-tripping through a server fn).
 * Every mutating or workspace-data server function must call this and thread
 * `{ userId: session.user.id }` into `runWorkspaceCapabilities`. Fails with
 * `UnauthorizedError` (typed, displayed by the calling form) instead of a
 * redirect.
 */
export async function requireRequestSession(): Promise<Session> {
  const session = await readSession()
  if (!session) {
    throw new UnauthorizedError()
  }
  return session
}
