import { env } from 'cloudflare:workers'
import { Layer, ManagedRuntime } from 'effect'
import { Auth, AuthConfig } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db/client'
import { WideEventLoggerLive } from '@b2b-saas-starter/logger'

// Under the local workers shim there is no D1 binding. Auth stays importable
// (getSession without a cookie never queries), and any query that does run
// fails with a descriptive error instead of a deep drizzle TypeError.
const missingD1 = new Proxy(
  {},
  {
    get() {
      throw new Error('D1 binding is unavailable in the local workers shim')
    }
  }
) as D1Database

// Layer.sync defers env access until first use, so importing this module in
// environments without bindings (browser bundle in dev) stays inert.
const AuthConfigLive = Layer.sync(AuthConfig)(() => ({
  db: createDb(env.DB ?? missingD1),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins:
    env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean) ?? [],
  github:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : null
}))

export const AuthLive = Auth.layer.pipe(Layer.provide(AuthConfigLive))

/**
 * Per-isolate runtime for auth work: the Auth service (memoized by the
 * layer, so one better-auth instance per isolate) plus the wide-event
 * logger used by the /api/auth/$ handler.
 */
export const authRuntime = ManagedRuntime.make(
  Layer.mergeAll(AuthLive, WideEventLoggerLive)
)
