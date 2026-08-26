import { accessControl, workspaceRoleAccess } from '@b2b-saas-starter/authz/client'
import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import * as schema from '@b2b-saas-starter/db/schema'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { organization } from 'better-auth/plugins/organization'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { username } from 'better-auth/plugins/username'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Context, Effect } from 'effect'
import {
  plugins,
  service,
  type Session as InferredSession
} from 'effectful-better-auth'

/**
 * The account-lifecycle emails Better Auth sends (password reset, email
 * verification), as a structural port: Better Auth invokes its callbacks
 * outside any Effect, so they cannot depend on Effect services directly, and
 * this package must not import the sibling `email` package (ADR 0051's rule
 * runs in both directions). The app supplies the adapter
 * (`apps/web/src/lib/server/auth-emails.ts`), built on the `EmailDispatcher`
 * with its log-mode fallback — so an unconfigured starter still "sends" to the
 * log and the flows work end to end locally.
 */
export type AuthEmailSender = {
  readonly sendPasswordReset: (input: {
    readonly email: string
    readonly url: string
  }) => Promise<void>
  readonly sendEmailVerification: (input: {
    readonly email: string
    readonly url: string
  }) => Promise<void>
}

export type AuthConfigInterface = {
  readonly db: DrizzleDatabase
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: readonly string[]
  readonly emails: AuthEmailSender
  /**
   * Better Auth's `requireEmailVerification`, decided by the app from
   * `ENVIRONMENT` (`requireEmailVerification` in `@b2b-saas-starter/env`):
   * on only in production. This package never reads env itself — the caller
   * owns the decision, local dev stays provider-light.
   */
  readonly requireEmailVerification: boolean
}

export class AuthConfig extends Context.Service<AuthConfig, AuthConfigInterface>()(
  '@b2b-saas-starter/auth/AuthConfig'
) {}

/**
 * Kept as a plain function returning a single (non-union) object type: the
 * plugins array is the literal that effectful-better-auth's inference reads,
 * and a union return type would poison `Instance<AuthOptions>`. The plugin
 * array goes through `plugins(...)` because a bare array literal widens to a
 * union array in a function body, dropping plugin schema inference (the
 * admin plugin's `user.role` would vanish from `Session`).
 */
export function makeAuthOptions(options: AuthConfigInterface) {
  return {
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema
    }),
    emailAndPassword: {
      enabled: true,
      // Gated by the caller through `AuthConfig.requireEmailVerification`:
      // on in production, off everywhere else. Local dev sends to the log,
      // where nobody can read the verification email — a gate the local path
      // cannot pass would break the provider-light rule. The unverified state
      // is surfaced in the app instead (banner + resend).
      requireEmailVerification: options.requireEmailVerification,
      // A reset password is an account-takeover response primitive: once it
      // succeeds, the sessions that preceded it are exactly what the reset
      // exists to distrust.
      revokeSessionsOnPasswordReset: true,
      // Better Auth owns the token flow (single-use, one hour, stored in the
      // `verification` table); this callback only turns it into an email via
      // the port above. It runs outside any Effect — no Clock, no services —
      // which is why the port is a plain async function. The parameter type
      // is written out (not inferred) because this object literal is built
      // standalone: `makeAuthOptions` returns it before Better Auth's own
      // contextual types can apply, so the callback signature is on us.
      // oxlint-disable-next-line effect/noAsyncFunction -- Better Auth callback contract: plain async, outside any Effect; this file is the platform adapter
      sendResetPassword: async ({
        user,
        url
      }: {
        readonly user: { readonly email: string }
        readonly url: string
      }) => {
        // oxlint-disable-next-line effect/noAsyncFunction -- forwards to the plain-function port below, not Effect work
        await options.emails.sendPasswordReset({ email: user.email, url })
      }
    },
    emailVerification: {
      // The link clicker gets a session: verification proves control of the
      // mailbox, so signing the user in on the spot is the honest reward, not
      // a privilege escalation. Without it, an already-signed-in user still
      // gets their refreshed session cookie (the endpoint always sets one).
      autoSignInAfterVerification: true,
      // The verification email rides sign-up itself. The alternative —
      // requiring the user to ask for it afterwards — is an extra hop the
      // starter has no UI reason to demand.
      sendOnSignUp: true,
      // oxlint-disable-next-line effect/noAsyncFunction -- Better Auth callback contract: plain async, outside any Effect; this file is the platform adapter
      sendVerificationEmail: async ({
        user,
        url
      }: {
        readonly user: { readonly email: string }
        readonly url: string
      }) => {
        // oxlint-disable-next-line effect/noAsyncFunction -- forwards to the plain-function port above, not Effect work
        await options.emails.sendEmailVerification({ email: user.email, url })
      }
    },
    plugins: plugins(
      username(),
      // TOTP only: `otp` (email one-time codes) and backup-code sign-in UI are
      // out of scope for the starter, but the plugin still generates backup
      // codes on enable — they are stored, just not surfaced in the UI yet.
      twoFactor({
        issuer: 'B2B SaaS Starter',
        // The starter's account surface is password-first; asking for the
        // second factor again inside settings would be ceremony.
        skipVerificationOnEnable: true
      }),
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
