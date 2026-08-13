import { env } from 'cloudflare:workers'
import { Layer, ManagedRuntime, Schema } from 'effect'
import { Auth, AuthConfig } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db/client'
import { WideEventLoggerLive } from '@b2b-saas-starter/logger'

/**
 * Defect raised when something reaches for the D1 binding that the local
 * workers shim does not provide. Tagged so the wide-event logger reports
 * `errorTag` instead of an opaque message.
 */
export class MissingD1Binding extends Schema.TaggedError<MissingD1Binding>()(
  'MissingD1Binding',
  { property: Schema.String }
) {}

// Under the local workers shim there is no D1 binding. Auth stays importable
// (getSession without a cookie never queries), and any query that does run
// fails with a descriptive defect instead of a deep drizzle TypeError. A Proxy
// trap has no Effect error channel of its own — throwing is the only way it can
// signal, and the throw surfaces as a defect in whichever Effect touches it.
// oxlint-disable-next-line effect/noAs -- a Proxy sentinel has no structural D1Database to decode from; every property access throws MissingD1Binding by design
const missingD1 = new Proxy(
  {},
  {
    get(_target, property) {
      // oxlint-disable-next-line effect/noThrowStatement -- a Proxy get trap can only signal by throwing; the value surfaces as an Effect defect upstream
      throw new MissingD1Binding({ property: String(property) })
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
