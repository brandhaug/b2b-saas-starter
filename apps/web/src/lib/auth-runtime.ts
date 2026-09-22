// The account-deletion hooks below reach the Better Auth server instance
// through `plugin-call` (the session headers), so their import graph closes a
// cycle back into this module on paper. At runtime the edge is lazy and safe:
// the hooks import resolves on first auth use, long after every module in the
// cycle has finished evaluating, and the browser bundle never resolves it.
// fallow-ignore-file circular-dependencies
import { Auth, AuthConfig } from '@b2b-saas-starter/auth'
import {
  activeSocialProviders,
  requireEmailVerification
} from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { errorMessage } from '@b2b-saas-starter/failure'
import { MissingD1Binding } from './server/auth-local-d1'
import { defaultUserDeleteHooks } from './server/account-delete-hooks'
import { makeAuthEmailSender } from './server/auth-emails'
import { socialAccountAuditHooks } from './server/social-account-audit'
import { fetchClientMetadataResource } from './server/client-metadata-fetch'
import { onRecoveryStarted } from './server/auth-recovery'
import { hasRecentAuthentication } from './server/auth-recent-authentication'

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
    // Callers inspect availability before entering this runtime.
    // oxlint-disable-next-line effect/noThrowStatement -- protects the runtime construction invariant if bindings change after selection
    throw new MissingD1Binding({ property: 'DB' })
  }
  return {
    db: drizzle(db),
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
    hasRecentAuthentication,
    invalidateAssistantAuthority: async ({ userId }: { readonly userId: string }) => {
      const { runCapabilities } = await import('./capabilities')
      const { AssistantDirectory } =
        await import('@b2b-saas-starter/capabilities/assistant/directory')
      await runCapabilities(
        Effect.flatMap(AssistantDirectory, (directory) =>
          directory.invalidateAccess({ creatorUserId: userId })
        )
      )
    },
    recoveryHooks: { onRecoveryStarted },
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
          catch: (thrown) => errorMessage(thrown) ?? 'no reason given'
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
      assistantResource:
        env.ASSISTANT_RESOURCE_URL ?? 'http://localhost:8787/assistant',
      fetchClientMetadataResource
    }
  }
})

// No service is fabricated when persistence is absent. Callers choose their
// boundary response before asking this runtime to build the plugin.
const authWithDb = Auth.layer.pipe(Layer.provide(AuthConfigLive))
const runtime = ManagedRuntime.make(authWithDb)

export function authAvailability():
  | { readonly available: false }
  | { readonly available: true; readonly runtime: typeof runtime } {
  if (env.DB === undefined) {
    return { available: false }
  }
  return { available: true, runtime }
}
