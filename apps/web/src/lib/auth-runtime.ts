import { createDb } from '@b2b-saas-starter/db/src/client.ts'
import { Auth, AuthConfig } from '@b2b-saas-starter/auth'
import { env } from 'cloudflare:workers'
import { Layer, ManagedRuntime, Schema } from 'effect'
import { makeAuthEmailSender } from './server/auth-emails'

/**
 * Defect raised when something reaches for the D1 binding that the local
 * workers shim does not provide. Tagged so the wide-event logger reports
 * `errorTag` instead of an opaque message.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class MissingD1Binding extends Schema.TaggedError<MissingD1Binding>()(
  'MissingD1Binding',
  { property: Schema.String }
) {}

// Under the local workers shim there is no D1 binding. Auth stays importable
// (getSession without a cookie never queries), and any query that does run
// fails with a descriptive defect instead of a deep drizzle TypeError. A Proxy
// trap has no Effect error channel of its own — throwing is the only way it can
// signal, and the throw surfaces as a defect in whichever Effect touches it.
// SAFETY: no property of this value is ever read successfully — the `get` trap throws on
// every access — so nothing downstream can observe the difference between it and a real
// D1Database. The assertion only satisfies the binding's declared type.
// oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- a Proxy sentinel has no structural D1Database to decode from, and narrowing the empty target is the point; every property access throws MissingD1Binding by design
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
  // The lifecycle-email adapter (reset + verification), built on the same
  // provider-light dispatcher selector as the invitation flow: log mode when
  // no `EMAIL` binding is configured, so the flows stay demoable locally.
  emails: makeAuthEmailSender()
}))

export const AuthLive = Auth.layer.pipe(Layer.provide(AuthConfigLive))

/**
 * Per-isolate runtime for auth work: the Auth service, memoized by the layer
 * so one better-auth instance serves the whole isolate.
 *
 * Observability is deliberately absent here. The loggers, tracer, and OTLP
 * exporters belong to a single request (`src/lib/observability.ts`), and this
 * runtime outlives every one of them; callers layer the request's telemetry on
 * top with `withWebRequestScope`.
 */
export const authRuntime = ManagedRuntime.make(AuthLive)
