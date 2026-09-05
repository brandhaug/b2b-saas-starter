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
import { Effect, Layer, ManagedRuntime } from 'effect'
import { causeMessage } from './cause-message'
import { MissingD1Binding, localD1UnavailableResponse } from './server/auth-local-d1'
import { defaultUserDeleteHooks } from './server/account-delete-hooks'
import { makeAuthEmailSender } from './server/auth-emails'
import { socialAccountAuditHooks } from './server/social-account-audit'
import { fetchClientMetadataResource } from './server/client-metadata-fetch'

/**
 * The MCP resource identifier when `MCP_RESOURCE_URL` is unset: the local API
 * dev server. A deployment sets the real URL (ADR 0068); the default exists so
 * the consent flow works with nothing configured, like every other provider.
 */
const LOCAL_MCP_RESOURCE = 'http://localhost:8787/mcp'

// Layer.sync defers env access until first use, so importing this module in
// environments without bindings (browser bundle in dev) stays inert.
const AuthConfigLive = Layer.sync(AuthConfig)(() => {
  const db = env.DB
  if (db === undefined) {
    // Unreachable by construction: `AuthLive`'s suspend below routes the
    // no-binding case to the degraded service, so this layer only ever
    // builds with a real D1. The guard is executable, not a cast — if a
    // future refactor breaks that invariant, this names the break instead
    // of handing drizzle an undefined binding.
    // oxlint-disable-next-line effect/noThrowStatement -- the invariant's failure channel; unreachable under AuthLive's suspend guard
    throw new MissingD1Binding({ property: 'DB' })
  }
  return {
    db: createDrizzleDb(db),
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
    // The OAuth 2.1 server MCP clients connect through (ADR 0068): tokens are
    // bound to the API worker's `/mcp`, and client metadata documents are
    // fetched through the Workers-safe transport.
    mcp: {
      resource: env.MCP_RESOURCE_URL ?? LOCAL_MCP_RESOURCE,
      fetchClientMetadataResource
    }
  }
})

const authWithDb = Auth.layer.pipe(Layer.provide(AuthConfigLive))

/** The Auth service value's type, derived from the real layer. */
type AuthService = Layer.Success<typeof authWithDb>

/**
 * The degraded `api` surface: `getSession` is the one method that must
 * answer for real, with `null` — without the database no session can exist,
 * and the route gates read exactly that (a redirect to `/sign-in`, the
 * fresh-clone behavior) instead of a defect-turned-500 off the sentinel.
 * Every other property keeps the refusing behavior below.
 */
const missingD1AuthApi = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === 'getSession') {
        // No D1 means no persisted session, whatever cookies say; resolving
        // null (not throwing) is what keeps `/account` and friends a
        // redirect rather than a 500. An Effect, because the api surface is
        // effectful-better-auth's: its methods yield, not await.
        return () => Effect.succeed(null)
      }
      // oxlint-disable-next-line effect/noThrowStatement -- a Proxy get trap can only signal by throwing; the value surfaces as an Effect defect upstream
      throw new MissingD1Binding({ property: String(property) })
    }
  }
)

/**
 * The refusing `full` surface: reaching past the handler throws the sentinel
 * defect, so a caller that tries anyway fails loudly instead of touching a
 * half-built Better Auth.
 */
// SAFETY: a sentinel, same discipline as the D1 proxy this module used to
// hand drizzle — no property of this value is ever read successfully (the
// `get` trap throws on every access), so nothing downstream can observe a
// real Better Auth surface through it.
const refusingAuthSurface = new Proxy(
  {},
  {
    get(_target, property) {
      // oxlint-disable-next-line effect/noThrowStatement -- a Proxy get trap can only signal by throwing; the value surfaces as an Effect defect upstream
      throw new MissingD1Binding({ property: String(property) })
    }
  }
)

/** The degraded handler: every request answers the guidance 503. */
// oxlint-disable-next-line typescript/require-await -- the mount contract is `Promise<Response>` and the 503 is synchronous by construction; awaiting nothing would only appease the rule
async function missingD1Handler(): Promise<Response> {
  return localD1UnavailableResponse()
}

/**
 * The degraded Auth service for the no-D1 state (fresh clone, local workers
 * shim): the handler answers every request with the 503 guidance response —
 * Better Auth never runs, so no query dies deep inside drizzle as a
 * stack-traced 500 — `api.getSession` resolves `null` (the truth: without
 * the database no session can exist, which the gates render as a redirect),
 * and the remaining `api`/`full` properties throw the sentinel defect for
 * callers that reach past them.
 */
function missingD1AuthService(): AuthService {
  // SAFETY: the object is the sentinels above — `api.getSession` resolves
  // null, every other `api`/`full` access throws, `instance` carries only
  // the handler every mount site reads. The double cast states exactly
  // that: no surface of this value will ever be observed as a real Better
  // Auth instance.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- the degraded service is the sentinel by design; every api/full access throws, so the assertion satisfies the type without faking a surface
  return {
    api: missingD1AuthApi,
    full: refusingAuthSurface,
    instance: { handler: missingD1Handler, fetch: missingD1Handler }
  } as unknown as AuthService
}

const MissingD1AuthLive: Layer.Layer<AuthService> = Layer.sync(Auth.Tag)(
  missingD1AuthService
)

/**
 * The Auth layer, chosen per isolate: the real service when a D1 binding
 * exists, the degraded 503-answering service when it does not.
 * `Layer.suspend` defers the env read until the runtime first builds the
 * layer, so importing this module in environments without bindings (browser
 * bundle in dev) stays inert. The choice is memoized with the runtime:
 * after migrating and seeding, the dev server needs a restart to pick the
 * real layer up — the guidance sentence says so.
 */
export const AuthLive: Layer.Layer<AuthService> = Layer.suspend(() =>
  env.DB === undefined ? MissingD1AuthLive : authWithDb
)

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
