import { passkey } from '@better-auth/passkey'
import { accessControl, workspaceRoleAccess } from '@b2b-saas-starter/authz/client'
import {
  adminSystemRole,
  isSsoProvisionedRole,
  ssoProvisionedRoles,
  type SsoProvisionedRoleValue
} from '@b2b-saas-starter/db/enums'
import * as schema from '@b2b-saas-starter/db/schema'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { sso } from '@better-auth/sso'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { lastLoginMethod } from 'better-auth/plugins'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { jwt } from 'better-auth/plugins/jwt'
import { magicLink } from 'better-auth/plugins/magic-link'
import { organization } from 'better-auth/plugins/organization'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { username } from 'better-auth/plugins/username'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Effect } from 'effect'
import {
  plugins,
  service,
  type Session as InferredSession
} from 'effectful-better-auth'
import {
  MCP_CONSENT_PAGE,
  MCP_LOGIN_PAGE,
  MCP_OAUTH_SCOPES,
  mcpWorkspaceAccessTokenClaims,
  mcpWorkspaceNeedsSelection,
  mcpWorkspaceReferenceId
} from './mcp-oauth.ts'
import {
  AuthConfig,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  type AuthAccountChange,
  type AuthConfigInterface
} from './ports.ts'

export {
  MCP_CONSENT_PAGE,
  MCP_LOGIN_PAGE,
  MCP_OAUTH_SCOPES,
  MCP_WORKSPACE_SELECTED_HEADER
} from './mcp-oauth.ts'

// The package's structural ports and the `AuthConfig` service live in
// `./ports.ts` (ADR 0051); everything there is public API through this
// module, so consumers never import the subpath.
export {
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  AuthConfig,
  type AuthAccountChange,
  type AuthAccountHooks,
  type AuthConfigInterface,
  type AuthEmailCallback,
  type AuthEmailSender,
  type AuthMagicLinkCallback,
  type AuthOneTimeCodeCallback,
  type OneTimeCodePurpose,
  type SocialProviderCredentials,
  type SocialProviderCredentialsByName,
  type UserDeleteHooks
} from './ports.ts'

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
 * The WebAuthn Relying Party id, derived from the app URL the caller already
 * supplies (`BETTER_AUTH_URL`) rather than a second env var: `localhost` in
 * local dev (a valid WebAuthn rpID — the flow works with zero configuration),
 * the hostname in production. The rpID must equal the serving host or a
 * registrable suffix of it, which the URL's hostname is by construction.
 */
function passkeyRpID(baseURL: string): string {
  return new URL(baseURL).hostname
}

/**
 * The origin WebAuthn ceremonies are verified against, from the same app URL.
 * `new URL(...).origin` normalizes scheme, host, and port and drops any path
 * or trailing slash — the exact shape the passkey plugin wants. A deployment
 * that serves the app on additional origins widens this; the plugin accepts
 * an array.
 */
function passkeyOrigin(baseURL: string): string {
  return new URL(baseURL).origin
}

/**
 * The `user` option this package builds from the hook pair. The endpoint is
 * enabled only when the app supplied the hooks: without them, deleting a user
 * would strand sole-owner workspaces and trip the restricting FKs from
 * `audit_events` and `api_tokens` — a dangerous default this package refuses
 * to pick. Written as a helper so each branch returns a whole, honest shape
 * instead of a spread-with-undefined keys.
 */
function userDeleteOption(options: AuthConfigInterface) {
  if (options.userDeleteHooks === undefined) {
    return { deleteUser: { enabled: false } }
  }
  return {
    deleteUser: {
      enabled: true,
      beforeDelete: options.userDeleteHooks.beforeDelete,
      afterDelete: options.userDeleteHooks.afterDelete
    }
  }
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
    // Passed through as resolved — the same identity-not-equivalence stance as
    // the email port. An empty object means zero providers inside Better Auth:
    // no provider exists at all (nothing exists-but-disabled), and the Local
    // Auth Path's runtime shape is unchanged either way.
    socialProviders: options.socialProviders,
    databaseHooks: {
      account: {
        // The linking audit port, assigned straight to Better Auth's hooks —
        // fires for every account row (credential included); the app's
        // adapter decides which provider ids are audit-worthy. The parameter
        // is the port's narrowed shape: Better Auth's full `Account` row is
        // assignable to it, so the adapter never sees the token columns the
        // port does not declare.
        create: {
          after: (account: AuthAccountChange) =>
            options.accountHooks.onAccountLinked(account)
        },
        delete: {
          after: (account: AuthAccountChange) =>
            options.accountHooks.onAccountUnlinked(account)
        }
      }
    },
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
    user: userDeleteOption(options),
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
      // The second Local Auth Path: an emailed single-use link, the same
      // `verification` table the reset and verification tokens use. It works
      // with the log-mode dispatcher, so local dev needs no provider — the
      // link lands in the console.
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        // The stored copy is a hash: the emailed token is the credential, and
        // a read of the `verification` table must not be enough to mint a
        // session. Better Auth hashes the incoming token before lookup.
        storeToken: 'hashed',
        // Sign-up through a link is allowed (stated, not defaulted): the plugin
        // creates the user with `emailVerified: true`, because consuming the
        // link is proof of mailbox control — the same proof the verification
        // email asks for. `requireEmailVerification` therefore has nothing
        // left to gate for a magic-link account.
        disableSignUp: false,
        // Same pass-through as the lifecycle callbacks above: the port carries
        // the plugin's own signature, so the app's adapter is the callback.
        sendMagicLink: options.emails.sendMagicLink
      }),
      // TOTP only: the twoFactor plugin's `otp` method (email codes as a
      // *second* factor) is out of scope for the starter — one-time codes in
      // the account lifecycle are the separate emailOTP plugin below. The
      // plugin generates backup codes on enable; the account panel surfaces
      // them once, at enrollment, alongside the QR.
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
      // WebAuthn passkeys: registration demands a session, sign-in opens one
      // directly. `rpID`/`origin` derive from the app URL on the config — no
      // separate env var, and `localhost` works out of the box (ADR 0056).
      passkey({
        rpID: passkeyRpID(options.baseURL),
        rpName: 'B2B SaaS Starter',
        origin: passkeyOrigin(options.baseURL)
      }),
      // Email one-time codes as the alternative to the emailed lifecycle
      // links: sign-in, email verification, and password reset, all through
      // the same `sendOneTimeCode` port the lifecycle links use. Six digits,
      // ten minutes, three attempts — stated rather than defaulted (only the
      // six is Better Auth's default). Codes hash at rest in the `verification`
      // table, and sign-in codes open sessions for existing accounts only:
      // registration goes through /sign-up, where the Turnstile gate lives.
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        disableSignUp: true,
        sendVerificationOTP: options.emails.sendOneTimeCode
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
      // Signing keys for the OAuth access tokens below, served at `/jwks`.
      // `disableSettingJwtHeader` keeps session responses free of a signed
      // session JWT — the only JWTs this app mints are OAuth access tokens.
      jwt({ disableSettingJwtHeader: true }),
      // The OAuth 2.1 authorization server MCP clients connect through (ADR
      // 0055). API Tokens stay the credential for scripts and CI; this is the
      // interactive path, and it requires `jwt()` above.
      mcp({
        resource: options.mcp.resource,
        loginPage: MCP_LOGIN_PAGE,
        consentPage: MCP_CONSENT_PAGE,
        scopes: MCP_OAUTH_SCOPES,
        // One hour of access, thirty days of refresh — Better Auth's own
        // defaults, stated so a default change is a visible diff.
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
        // The workspace pick. The plugin's post-login hop is the one place a
        // consent can be tied to a reference id, and the consent page IS that
        // hop: it redirects there until the consent server function vouches
        // for the pick through `MCP_WORKSPACE_SELECTED_HEADER`, reads the
        // picked workspace off the session as the consent's reference, and
        // the claims callback turns it into the token's workspace claims.
        postLogin: {
          page: MCP_CONSENT_PAGE,
          shouldRedirect: mcpWorkspaceNeedsSelection,
          consentReferenceId: mcpWorkspaceReferenceId
        },
        customAccessTokenClaims: ({ user, referenceId }) =>
          mcpWorkspaceAccessTokenClaims(options.db, {
            userId: user?.id,
            referenceId
          })
      }),
      // Client ID Metadata Documents: an MCP client identifies itself by an
      // HTTPS URL it controls, which is what MCP 2026-07-28 pins instead of
      // dynamic registration. The transport is the app's.
      cimd({
        fetchClientMetadataResource: options.mcp.fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28'
      }),
      // Workspace-scoped SSO (ADR 0069). The plugin owns the connection rows
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
        // resolve a disabled one (ADR 0069 §2). A first SSO sign-in creates
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
      // The "last signed in with X" hint on the sign-in page: cookie-backed
      // by the core plugin's default (`storeInDatabase` stays off — no new
      // user column, no migration, and a wiped cookie is cosmetic, not data
      // loss). The cookie is client-readable on purpose; the client plugin
      // reads it on the sign-in screen.
      lastLoginMethod(),
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
