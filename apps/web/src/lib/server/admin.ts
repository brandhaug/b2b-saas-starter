import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Effect } from 'effect'
import { Auth } from '@b2b-saas-starter/auth'
import { authRuntime } from '../auth-runtime'

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
 */
export const listSystemUsersServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<readonly SystemUser[]> => {
    const request = getRequest()
    const { users } = await authRuntime.runPromise(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        return yield* auth.api.listUsers({
          headers: request.headers,
          query: { limit: 100 }
        })
      })
    )
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role === 'admin' ? 'admin' : 'user'
    }))
  }
)
