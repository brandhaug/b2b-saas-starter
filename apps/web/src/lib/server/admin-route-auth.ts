import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { notFound, redirect } from '@tanstack/react-router'
import { requireSession, type RouteSession } from './auth'
import { strongAuthenticationStatusServerFn } from './strong-authentication'

/**
 * Route gate for admin-only routes. Requires a session AND the privileged
 * system role — `adminSystemRole` from `@b2b-saas-starter/db/enums`, the same
 * constant `admin({ adminRoles })` in packages/auth and the server-fn gate in
 * `admin.ts` read, so the literal lives in exactly one place. Non-admins get a
 * 404 rather than a 403 so the route's existence is not disclosed.
 */
export async function requireAdmin(redirectTo: string): Promise<RouteSession> {
  const session = await requireSession(redirectTo)
  if (session.user.role !== adminSystemRole) {
    // oxlint-disable-next-line effect/noThrowStatement -- `throw notFound()` is TanStack Router's 404 control-flow API
    throw notFound()
  }
  const authentication = await strongAuthenticationStatusServerFn()
  if (!authentication.qualified) {
    // oxlint-disable-next-line effect/noThrowStatement -- navigation gates redirect to an accessible verification flow
    throw redirect({ to: '/verify-authentication', search: { redirect: redirectTo } })
  }
  return session
}
