// The account-deletion hooks below reach the Better Auth server instance
// through `plugin-call` (the session headers), so their import graph closes a
// cycle back into this module on paper. At runtime the edge is lazy and safe:
// the hooks import resolves on first auth use, long after every module in the
// cycle has finished evaluating, and the browser bundle never resolves it.
// fallow-ignore-file circular-dependencies
import { createDrizzleDb } from '@b2b-saas-starter/db/client'
import { Auth, AuthConfig } from '@b2b-saas-starter/auth'
import {
  activeSocialProviders,
  requireEmailVerification
} from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { causeMessage } from './cause-message'
import { defaultUserDeleteHooks } from './server/account-delete-hooks'
import { makeAuthEmailSender } from './server/auth-emails'
import { socialAccountAuditHooks } from './server/social-account-audit'
import { fetchClientMetadataResource } from './server/client-metadata-fetch'

/**
 * The MCP resource identifier when `MCP_RESOURCE_URL` is unset: the local API
 * dev server. A deployment sets the real URL (ADR 0054); the default exists so
 * the consent flow works with nothing configured, like every other provider.
 */
const LOCAL_MCP_RESOURCE = 'http://localhost:8787/mcp'

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
  db: createDrizzleDb(env.DB ?? missingD1),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins:
    env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean) ?? [],
  // The lifecycle-email adapter (reset + verification), built on the same
  // provider-light dispatcher selector as the invitation flow: log mode when
  // no `EMAIL` binding is configured, so the flows stay demoable locally.
  emails: makeAuthEmailSender(),
  // Social sign-in providers, resolved by the shared env decision: a provider
  // is present only when both its client id and secret are set, and an unset
  // provider is absent from the Better Auth config entirely (never
  // half-configured). The Local Auth Path is untouched either way.
  socialProviders: activeSocialProviders(env),
  // The account-linking audit adapter: social link/unlink records Audit
  // Events through the governance capability (see
  // server/social-account-audit.ts).
  accountHooks: socialAccountAuditHooks,
  // Production requires verified mailboxes; local dev and previews stay open
  // because lifecycle emails land in the log there (provider-light rule).
  requireEmailVerification: requireEmailVerification(env.ENVIRONMENT),
  // TanStack Start's server handlers do not surface the Worker's
  // `ExecutionContext`, so there is no `ctx.waitUntil` to hand Better Auth's
  // `advanced.backgroundTasks.handler`. `AuthConfig` makes the runner
  // required rather than defaulting one, so the decision is stated here: run
  // the detached send inline (correct, just not crash-proof past the
  // response) and log a rejection instead of discarding it — a lifecycle
  // email that never left is worth a line in the log. A fork whose server
  // entry reaches the execution context should replace this with
  // `(promise) => ctx.waitUntil(promise)`.
  runBackground: (promise: Promise<unknown>) => {
    Effect.runFork(
      Effect.tryPromise({
        try: () => promise,
        catch: (thrown) => causeMessage(thrown, 'no reason given')
      }).pipe(
        Effect.catch((error: string) =>
          Effect.logError(`auth background task failed: ${error}`)
        )
      )
    )
  },
  // The account-deletion hooks: without them the `/delete-user` endpoint
  // stays disabled (see `packages/auth`), so this supply is what turns
  // self-service deletion on, with the workspace teardown riding the
  // capability layer.
  userDeleteHooks: defaultUserDeleteHooks(),
  // The OAuth 2.1 server MCP clients connect through (ADR 0055): tokens are
  // bound to the API worker's `/mcp`, and client metadata documents are
  // fetched through the Workers-safe transport.
  mcp: {
    resource: env.MCP_RESOURCE_URL ?? LOCAL_MCP_RESOURCE,
    fetchClientMetadataResource
  }
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
