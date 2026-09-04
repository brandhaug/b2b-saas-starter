import { accessControl, workspaceRoleAccess } from '@b2b-saas-starter/authz/client'
import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import {
  adminSystemRole,
  isSsoProvisionedRole,
  ssoProvisionedRoles,
  type SsoProvisionedRoleValue
} from '@b2b-saas-starter/db/enums'
import * as schema from '@b2b-saas-starter/db/schema'
import { sso } from '@better-auth/sso'
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
  readonly sendResetPassword: AuthEmailCallback
  readonly sendVerificationEmail: AuthEmailCallback
}

/**
 * Better Auth's own callback shape, narrowed to the two fields the starter
 * reads. Keeping the port on this signature (rather than a `{ email, url }`
 * of our own) is what lets the adapter be passed straight through to
 * `sendResetPassword` / `sendVerificationEmail` below — no rename wrapper, and
 * no `async` callbacks in this file to disable a lint rule for. Better Auth
 * passes more (`token`, the `Request`); a callback may ignore the rest.
 */
export type AuthEmailCallback = (data: {
  readonly user: { readonly email: string }
  readonly url: string
}) => Promise<void>

export type AuthConfigInterface = {
  readonly db: DrizzleDatabase
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly emails: AuthEmailSender
  /**
   * Better Auth's `requireEmailVerification`, decided by the app from
   * `ENVIRONMENT` (`requireEmailVerification` in `@b2b-saas-starter/env`):
   * on only in production. This package never reads env itself — the caller
   * owns the decision, local dev stays provider-light.
   */
  readonly requireEmailVerification: boolean
  /**
   * Better Auth's `advanced.backgroundTasks.handler` (verification and reset
   * emails are sent as detached background promises). Required, with no
   * default: on a Worker this should be `ctx.waitUntil` so a send survives its
   * response, and where the host does not expose an execution context the
   * caller has to say what happens to a detached send instead of inheriting a
   * swallow-everything fallback from this package. Whatever is supplied owns
   * the rejection — nothing here attaches a `catch`.
   */
  readonly runBackground: (promise: Promise<unknown>) => void
}

export class AuthConfig extends Context.Service<AuthConfig, AuthConfigInterface>()(
  '@b2b-saas-starter/auth/AuthConfig'
) {}

/**
 * The provisioning role for `organizationProvisioning.getRole`. The plugin
 * types `additionalFields` as plain strings, so the stored value is narrowed
 * through the stored vocabulary (`ssoProvisionedRoles` via
 * `isSsoProvisionedRole`): anything else — including a bogus `owner` written
 * by a raw API call — provisions as the first role, `member`. SSO never mints
 * the role that can delete the workspace or change the connection.
 */
function provisionedRoleOf(data: {
  readonly provider: {
    // Carried so the parameter keeps a property in common with the plugin's
    // `BaseSSOProvider` (its weak-type check); the role reads only the field
    // below.
    readonly providerId: string
    readonly defaultWorkspaceRole?: string | null
  }
}): Promise<SsoProvisionedRoleValue> {
  const stored = data.provider.defaultWorkspaceRole
  if (isSsoProvisionedRole(stored)) {
    // oxlint-disable-next-line effect/noNewPromise -- plugin callback runs outside Effect
    return Promise.resolve(stored)
  }
  // oxlint-disable-next-line effect/noNewPromise -- plugin callback runs outside Effect
  return Promise.resolve(ssoProvisionedRoles[0])
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
      // Stated rather than defaulted: B2B accounts are phishing targets, so
      // the floor is above Better Auth's 8-character default.
      minPasswordLength: 12,
      maxPasswordLength: 256,
      // Pinned explicitly so a Better Auth default change cannot silently
      // extend the window in which a leaked reset link is live. Single-use
      // either way; thirty minutes is ample for an email round trip.
      resetPasswordTokenExpiresIn: 60 * 30,
      // A reset password is an account-takeover response primitive: once it
      // succeeds, the sessions that preceded it are exactly what the reset
      // exists to distrust.
      revokeSessionsOnPasswordReset: true,
      // Better Auth owns the token flow (single-use, one hour, stored in the
      // `verification` table); the port carries Better Auth's own callback
      // signature, so the adapter the app supplies is the callback — there is
      // nothing to adapt here.
      sendResetPassword: options.emails.sendResetPassword
    },
    advanced: {
      backgroundTasks: {
        // Verification and reset sends ride this instead of the response
        // chain: the endpoint must not hang on SMTP, and on Workers only
        // `waitUntil` keeps the promise alive past the response. The caller's
        // runner is the handler — this package no longer picks a fallback on
        // its behalf.
        handler: options.runBackground
      }
    },
    session: {
      // Same values Better Auth defaults to, stated so a default change is a
      // visible diff rather than a silent session-lifetime shift.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // The knob the starter states beyond the defaults: an hour after each
      // session's last fresh authentication, sensitive account actions
      // (password change, 2FA enable/disable) can demand re-authentication
      // instead of trusting a long-lived cookie alone.
      freshAge: 60 * 60
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
      sendVerificationEmail: options.emails.sendVerificationEmail
    },
    plugins: plugins(
      username(),
      // TOTP only: `otp` (email one-time codes) is out of scope for the
      // starter. The plugin generates backup codes on enable; the account
      // panel surfaces them once, at enrollment, alongside the QR.
      twoFactor({
        issuer: 'B2B SaaS Starter',
        // Verification is required before 2FA counts as on: the first code
        // must succeed, so an attacker who only has a stolen session cannot
        // enroll their own authenticator and lock the real owner out. The
        // account panel already runs enable → QR → first-code as its flow,
        // and a database hook emails the user on every state change.
        skipVerificationOnEnable: false,
        // Both pinned to the values Better Auth defaults to, so a default
        // change cannot silently lengthen the challenge window or the
        // trusted-device grace period.
        twoFactorCookieMaxAge: 600,
        trustDeviceMaxAge: 60 * 60 * 24 * 30
      }),
      // The privileged system role comes from the stored vocabulary
      // (`packages/db`'s `systemRoles`), so the plugin's gate and the column it
      // reads cannot drift apart. This is the system axis only — a system admin
      // gets `/admin` and nothing inside a workspace, where the membership
      // row's `workspaceRoles` value decides.
      admin({
        adminRoles: [adminSystemRole],
        // Impersonation (ADR 0054): one hour, stated rather than left on the
        // plugin's default so a default change is a visible diff. The
        // capability's `IMPERSONATION_SESSION_SECONDS` quotes the same number;
        // this package cannot import it (siblings, ADR 0051), so change both.
        impersonationSessionDuration: 60 * 60,
        // Stated: an admin's session carries `/admin`, which is exactly the
        // escalation an impersonation must never hand out.
        allowImpersonatingAdmins: false
      }),
      organization({
        // One workspace set per plan is billing's business; five is the
        // starter's sanity cap on free creation.
        organizationLimit: 5,
        // Unverified mailboxes do not get to mint workspaces — but only when
        // verification is actually enforced. Local dev (log-mode email) could
        // never pass the gate, which would break the provider-light rule.
        allowUserToCreateOrganization: (user) =>
          !options.requireEmailVerification || user.emailVerified,
        // Invitations are stated rather than left on Better Auth's implicit
        // 48-hour default, and a re-invite cancels the stale link it replaces.
        invitationExpiresIn: 60 * 60 * 24 * 7,
        invitationLimit: 50,
        cancelPendingInvitationsOnReInvite: true,
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
      // Workspace-scoped SSO (ADR 0055). The plugin owns the connection rows
      // and the protocol flows; the starter owns the vocabulary and the
      // routing rule. Configuration is per-workspace in the database — there
      // is deliberately no env var, because an owner configuring a connection
      // is the whole point (the Optional Provider here is owner-gated, not
      // operator-gated).
      sso({
        // Connections start disabled and an owner enables one after a
        // successful test. The plugin has no `enabled` option and serves any
        // stored connection — `enabled` is the starter's routing vocabulary,
        // so the app enforces it: the sign-in page asks only for enabled
        // connections, and the auth gate refuses a `/sign-in/sso` that would
        // resolve a disabled one (ADR 0055 §2). A first SSO sign-in creates
        // the user when needed and joins them to the connection's workspace
        // with the connection's own default Workspace Role — `member` unless
        // the owner configured `admin`. `owner` is unreachable by design:
        // `provisionedRoleOf` narrows through `ssoProvisionedRoles`.
        organizationProvisioning: {
          getRole: provisionedRoleOf
        },
        // Stated rather than left on the plugin's implicit default of 10, so a
        // change is a visible diff. Counted per registering user; workspace
        // connections are additionally capped by the owner/admin gate on the
        // register endpoint itself.
        providersLimit: 10,
        schema: {
          ssoProvider: {
            // `modelName` is the drizzle schema export key, not the SQL table
            // name — same rule as the organization mapping above.
            modelName: 'workspaceSsoConnections',
            // The plugin names its foreign key `organizationId`; the column
            // spells it the starter's way, remapped once here.
            fields: { organizationId: 'workspaceId' },
            additionalFields: {
              enabled: {
                type: 'boolean',
                required: false,
                input: true,
                defaultValue: false
              },
              requireSso: {
                type: 'boolean',
                required: false,
                input: true,
                defaultValue: false
              },
              defaultWorkspaceRole: {
                type: 'string',
                required: false,
                input: true,
                defaultValue: 'member'
              },
              createdAt: {
                type: 'date',
                required: false,
                input: false,
                // oxlint-disable-next-line effect/noGlobals -- plugin callback runs outside Effect; no Clock available
                defaultValue: () => new Date()
              }
            }
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
