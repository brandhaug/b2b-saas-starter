import { type CimdOptions } from '@better-auth/cimd'
import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { Context } from 'effect'

/**
 * The package's structural ports and the `AuthConfig` service that carries
 * them (ADR 0051's rule runs in both directions): every environment fact the
 * Better Auth instance needs, typed here and supplied by the app — this
 * package never reads env itself. `index.ts` composes the options object and
 * re-exports everything below, so the public surface is unchanged.
 */

/**
 * The account-lifecycle emails Better Auth sends (password reset, email
 * verification, and the email-otp plugin's one-time codes), as a structural
 * port: Better Auth invokes its callbacks outside any Effect, so they cannot
 * depend on Effect services directly, and this package must not import the
 * sibling `email` package (ADR 0051's rule runs in both directions). The app
 * supplies the adapter (`apps/web/src/lib/server/auth-emails.ts`), built on
 * the `EmailDispatcher` with its log-mode fallback — so an unconfigured
 * starter still "sends" to the log and the flows work end to end locally.
 */
export type AuthEmailSender = {
  readonly sendResetPassword: AuthEmailCallback
  readonly sendVerificationEmail: AuthEmailCallback
  /** The email-otp plugin's `sendVerificationOTP` callback. */
  readonly sendOneTimeCode: AuthOneTimeCodeCallback
  /** The magic-link plugin's `sendMagicLink` callback. */
  readonly sendMagicLink: AuthMagicLinkCallback
  /**
   * Better Auth's `emailAndPassword.onPasswordReset` callback: the
   * confirmation after a reset through the emailed link succeeded (sessions
   * already revoked by then). No-op-able by the app like any other sender.
   */
  readonly sendPasswordResetConfirmation: AuthPasswordResetCallback
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

/**
 * Better Auth's own OTP type names. The starter drives the first three from
 * its UI (sign-in code, verification code, reset code); `change-email` is in
 * the union because the plugin's request-email-change endpoint sends through
 * the same callback, so the adapter must be total over what Better Auth can
 * pass even though no starter surface sends that code yet.
 */
export type OneTimeCodePurpose =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'change-email'

/**
 * Better Auth's `emailOTP.sendVerificationOTP` callback shape, narrowed to the
 * three fields the starter reads. Same reasoning as `AuthEmailCallback`: the
 * adapter is assigned straight to the plugin option, and Better Auth passes
 * more (`ctx`) that a callback may ignore.
 */
export type AuthOneTimeCodeCallback = (data: {
  readonly email: string
  readonly otp: string
  readonly type: OneTimeCodePurpose
}) => Promise<void>

/**
 * The magic-link plugin's own callback shape, narrowed the same way: the
 * plugin passes `{ email, url, token, metadata }` and the starter reads the
 * address and the URL. Unlike the two above there is no `user` — a magic link
 * can be requested for an address that has no account yet, and the plugin
 * creates the user only when the link is consumed.
 */
export type AuthMagicLinkCallback = (data: {
  readonly email: string
  readonly url: string
}) => Promise<void>

/**
 * Better Auth's `onPasswordReset` callback shape, narrowed to what the
 * starter reads. Fires once per successful reset through the emailed link —
 * after the new password is set and every prior session is revoked — so the
 * notification is a "this happened" email, never one with an action link.
 */
export type AuthPasswordResetCallback = (data: {
  readonly user: { readonly email: string }
}) => Promise<void>

/**
 * How long a magic link stays live, in seconds. Ten minutes: long enough for
 * an email round trip, short enough that a link sitting in a shared inbox is
 * not a standing credential. Exported so the email template's copy and the
 * app's "expired" state can name the same number.
 */
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 10

/**
 * The social providers this package can wire, keyed the way Better Auth's
 * `socialProviders` option is. A structural local type on purpose: the
 * resolver (`activeSocialProviders`) lives in `@b2b-saas-starter/env`, which
 * this package must not depend on — the app passes the resolved bag here,
 * same as `requireEmailVerification`. A missing key is the only absent state:
 * the resolver never emits `undefined` values, and an empty object resolves
 * to zero providers inside Better Auth. The keys are stated explicitly —
 * which providers exist is a closed set this type owns.
 */
export type SocialProviderCredentialsByName = {
  readonly github?: SocialProviderCredentials
  readonly google?: SocialProviderCredentials
}

/** One configured social provider. Both halves are required to be active. */
export type SocialProviderCredentials = {
  readonly clientId: string
  readonly clientSecret: string
}

/**
 * The slice of a Better Auth account row the linking audit needs. Kept
 * narrower than Better Auth's own `Account` type so the app's adapter depends
 * on the two fields it reads, not the token columns it must not.
 */
export type AuthAccountChange = {
  readonly providerId: string
  readonly userId: string
}

/**
 * The account-linking port, carried on `AuthConfig` and assigned straight to
 * Better Auth's `databaseHooks.account.create.after` / `delete.after` — no
 * rename wrapper, same shape as the email port above. Fires for every account
 * row; the app filters which provider ids are audit-worthy.
 */
export type AuthAccountHooks = {
  readonly onAccountLinked: (account: AuthAccountChange) => Promise<void>
  readonly onAccountUnlinked: (account: AuthAccountChange) => Promise<void>
}

export type AuthConfigInterface = {
  readonly db: DrizzleDatabase
  readonly secret: string
  readonly baseURL: string
  readonly trustedOrigins: ReadonlyArray<string>
  readonly emails: AuthEmailSender
  /**
   * The social sign-in providers that are active, resolved from worker env by
   * the caller (`activeSocialProviders` in `@b2b-saas-starter/env`): a
   * provider appears here only when both its client id and secret are set,
   * and an absent provider is absent from the Better Auth config entirely —
   * never present-but-disabled. An empty object (the provider-light default)
   * keeps `socialProviders` off the options object altogether, so the Local
   * Auth Path's shape is identical whether or not any provider is wired.
   */
  readonly socialProviders: SocialProviderCredentialsByName
  /**
   * The account-linking audit port: Better Auth invokes these database hooks
   * outside any Effect when an account row is created or deleted, so like
   * `emails` the port is structural and the app supplies the adapter
   * (`apps/web/src/lib/server/social-account-audit.ts`) that records the
   * governance audit events. `credential` accounts are the app's to filter —
   * the credential sign-up path already has its own audit row.
   */
  readonly accountHooks: AuthAccountHooks
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
  /**
   * The MCP OAuth authorization server's two deployment facts (ADR 0068):
   * `resource` is the API worker's `/mcp` URL that every access token is
   * audience-bound to (`MCP_RESOURCE_URL`), and `fetchClientMetadataResource`
   * is the outbound transport `@better-auth/cimd` fetches Client ID Metadata
   * Documents with — a platform concern (DNS pinning, redirect refusal) the
   * app supplies for its runtime. This package never reads env and never
   * picks a transport.
   */
  readonly mcp: {
    readonly resource: string
    readonly fetchClientMetadataResource: CimdOptions['fetchClientMetadataResource']
  }
  /**
   * The account-deletion hooks, as Better Auth's `user.deleteUser` option
   * carries them. The endpoint's own sequencing is why they exist: it verifies
   * the password FIRST, then runs `beforeDelete` (where the workspace
   * teardown must happen, while every FK the delete touches is still
   * satisfiable), then removes the user row, then runs `afterDelete`. Optional
   * as a pair — and `deleteUser` stays DISABLED unless they are supplied, so
   * the endpoint can never be enabled without its teardown half.
   */
  readonly userDeleteHooks?: UserDeleteHooks
}

/**
 * The `user.deleteUser` hook pair, named so the app's hook factory
 * (`account-delete-hooks.ts`) can build exactly this shape.
 */
export type UserDeleteHooks = {
  readonly beforeDelete: (
    user: { readonly id: string },
    request: Request | undefined
  ) => Promise<void>
  readonly afterDelete: (
    user: { readonly id: string; readonly email: string },
    request: Request | undefined
  ) => Promise<void>
}

export class AuthConfig extends Context.Service<AuthConfig, AuthConfigInterface>()(
  '@b2b-saas-starter/auth/AuthConfig'
) {}
