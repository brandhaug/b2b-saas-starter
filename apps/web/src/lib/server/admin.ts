import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect } from 'effect'
import { Auth } from '@b2b-saas-starter/auth'
import { annotateWide } from '@b2b-saas-starter/logger'
import { authRuntime } from '../auth-runtime'
import { withWebRequestScope } from '../observability'

export type SystemUser = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: 'admin' | 'user'
}

/**
 * System-level user list for `/admin`, via the Better Auth admin plugin —
 * not a workspace member list. Better Auth enforces the admin role from the
 * request's own session, so this endpoint fails closed for non-admins even
 * though it is a public server-function URL.
 *
 * `authRuntime` carries the `Auth` service only, so the read joins the
 * request's scope through `withWebRequestScope`: a child span under the request
 * span, folded into that request's one wide event. The count goes on the event;
 * no user identity does.
 */
export const listSystemUsersServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<readonly SystemUser[]> => {
    const request = getRequest()
    const { users } = await authRuntime.runPromise(
      withWebRequestScope(
        { event: 'admin.system_users' },
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const listed = yield* auth.api.listUsers({
            headers: request.headers,
            query: { limit: 100 }
          })
          yield* annotateWide({ userCount: listed.users.length })
          return listed
        })
      )
    )
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role === 'admin' ? 'admin' : 'user'
    }))
  }
)
