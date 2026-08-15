import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { organization } from 'better-auth/plugins/organization'
import { username } from 'better-auth/plugins/username'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Context, Effect } from 'effect'
import {
  plugins,
  service,
  type Session as InferredSession
} from 'effectful-better-auth'
import { accessControl, workspaceRoleAccess } from '@b2b-saas-starter/authz'
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
      organization({
        // One statement set, one role table, shared with every non-plugin
        // permission check. `requirePermission` reads the same objects, so the
        // plugin's own endpoints and the starter's guard can never disagree.
        ac: accessControl,
        roles: workspaceRoleAccess,
        // Off, and stated rather than left to the default. Turning teams on
        // adds two tables and makes `session.activeTeamId` required, neither of
        // which the schema has. `dynamicAccessControl` is absent for the same
        // reason: it wants an `organizationRole` table. Static roles are enough
        // for a starter.
        teams: { enabled: false },
        // `modelName` is the *drizzle schema export key*, not the SQL table
        // name — the adapter resolves models with `schema[modelName]`
        // (@better-auth/drizzle-adapter `getSchema`). The starter's domain word
        // stays `workspace`, so the plugin's three models point at the
        // workspace tables and nothing above this package learns the plugin's
        // vocabulary.
        schema: {
          organization: {
            modelName: 'workspaces',
            // The plugin's organization model has no `updatedAt`, and `planId`
            // is the starter's own. Both are declared here rather than stuffed
            // into `metadata`: a column the plugin does not know about is
            // stripped from every endpoint response. `input: false` keeps them
            // off the create/update body — a plan change is billing's job, not
            // a caller's.
            additionalFields: {
              planId: {
                type: 'string',
                required: false,
                input: false,
                defaultValue: 'starter'
              },
              updatedAt: {
                type: 'date',
                required: false,
                input: false,
                // Better Auth calls these outside any Effect, so `Clock` cannot
                // reach them — this file is the platform adapter the rule's own
                // message exempts. Without `onUpdate` the column keeps its
                // insert value forever, which is worse than an untestable
                // clock: a field named `updatedAt` that never updates.
                // oxlint-disable-next-line effect/noGlobals -- plugin callback runs outside Effect; no Clock available
                defaultValue: () => new Date(),
                // oxlint-disable-next-line effect/noGlobals -- plugin callback runs outside Effect; no Clock available
                onUpdate: () => new Date()
              }
            }
          },
          // The plugin names its foreign key `organizationId`; the column is
          // `workspaceId`. Every other field name already matches, so this is
          // the only rename the mapping needs.
          member: {
            modelName: 'workspaceMembers',
            fields: { organizationId: 'workspaceId' }
          },
          invitation: {
            modelName: 'workspaceInvitations',
            fields: { organizationId: 'workspaceId' }
          }
        }
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

/**
 * `Session` does not carry the active workspace, and nothing should read
 * `session.activeOrganizationId` from it. The plugin declares that field
 * unconditionally and writes it on create, accept, and set-active — no option
 * turns it off — but the starter resolves the workspace from the request slug
 * through `liveWorkspaceContext`. Two sources of truth for "which workspace" is
 * how a user ends up looking at one workspace's URL and another's data; the
 * slug wins because it is the one the address bar shows.
 */
export type Session = InferredSession<AuthOptions>

/**
 * Compile-time guard for plugin schema inference, and the reason `plugins(...)`
 * wraps the array above. A widened plugin array drops every plugin-added field
 * from `Session` while the endpoints keep working — a break no runtime test can
 * see, because the data is still there. Indexing the type is the assertion: if
 * inference breaks, `role` stops existing and `tsc --noEmit` fails on this
 * line. `requireAdmin` in apps/web reads this field.
 */
export type SessionUserRole = Session['user']['role']
