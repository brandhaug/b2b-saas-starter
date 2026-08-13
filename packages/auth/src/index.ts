import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { username } from 'better-auth/plugins/username'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Context, Effect } from 'effect'
import {
  plugins,
  service,
  type Session as InferredSession
} from 'effectful-better-auth'
import type { Database } from '@b2b-saas-starter/db/client'
import * as schema from '@b2b-saas-starter/db/schema'

export type AuthConfigInterface = {
  readonly db: Database
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly github: {
    readonly clientId: string
    readonly clientSecret: string
  } | null
}

export class AuthConfig extends Context.Service<AuthConfig, AuthConfigInterface>()(
  '@b2b-saas-starter/auth/AuthConfig'
) {}

/**
 * Better Auth reads `socialProviders` as an open bag: the Example OAuth
 * Provider key is present only when its credentials are configured, so an
 * unconfigured starter gets an empty bag rather than a disabled provider.
 */
function socialProvidersFor(github: AuthConfigInterface['github']): {
  github?: { clientId: string; clientSecret: string }
} {
  if (github === null) return {}
  return { github }
}

/**
 * Kept as a plain function returning a single (non-union) object type: the
 * plugins array is the literal that effectful-better-auth's inference reads,
 * and a union return type would poison `Instance<AuthOptions>`. The plugin
 * array goes through `plugins(...)` because a bare array literal widens to a
 * union array in a function body, dropping plugin schema inference (the
 * admin plugin's `user.role` would vanish from `Session`).
 */
export function makeAuthOptions(options: AuthConfigInterface) {
  const socialProviders = socialProvidersFor(options.github)

  return {
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema
    }),
    emailAndPassword: {
      enabled: true
    },
    socialProviders,
    plugins: plugins(
      username(),
      admin({
        adminRoles: ['admin']
      }),
      // Better Auth requires cookie-integration plugins last so cookies set by
      // other plugins' hooks are forwarded to the framework cookie store.
      tanstackStartCookies()
    )
  }
}

export type AuthOptions = ReturnType<typeof makeAuthOptions>

/**
 * The auth service: `Auth.Tag` provides `{ api, instance }` — `api` is the
 * effectful proxy (endpoints fail `BetterAuthApiError`), `instance` is the
 * raw Better Auth instance for `handler` / `asResponse` needs. The layer
 * requires `AuthConfig`, which the web app provides from worker env.
 */
export const Auth = service(
  '@b2b-saas-starter/auth/Auth',
  Effect.gen(function* () {
    return makeAuthOptions(yield* AuthConfig)
  })
)

export type Session = InferredSession<AuthOptions>
