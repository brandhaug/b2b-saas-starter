import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { describe, expect, it, vi } from 'vite-plus/test'
import { type AuthConfigInterface, makeAuthOptions } from './index.ts'

// The email-verification gate is decided by the caller (from `ENVIRONMENT`)
// and carried on `AuthConfig`; these tests pin that `makeAuthOptions` forwards
// it to Better Auth instead of hardcoding a stance.
const baseConfig: AuthConfigInterface = {
  // SAFETY: these tests only read the returned options object — `db` is
  // forwarded into `drizzleAdapter`'s closure and no property of it is read.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- an empty sentinel stands in for the promise client, which the adapter alone would touch
  db: {} as AuthConfigInterface['db'],
  secret: 'test-secret-at-least-32-characters-long',
  baseURL: 'http://localhost:3071',
  trustedOrigins: [],
  emails: {
    sendResetPassword: () => Promise.resolve(),
    sendVerificationEmail: () => Promise.resolve()
  },
  requireEmailVerification: false,
  runBackground: (promise) => {
    void promise.catch(() => undefined)
  }
}

describe('makeAuthOptions', () => {
  it('forwards requireEmailVerification from the config', () => {
    expect(makeAuthOptions(baseConfig).emailAndPassword).toMatchObject({
      requireEmailVerification: false
    })
    expect(
      makeAuthOptions({ ...baseConfig, requireEmailVerification: true })
        .emailAndPassword
    ).toMatchObject({ requireEmailVerification: true })
  })

  it('requires verification before two-factor counts as enabled', () => {
    // skipVerificationOnEnable must stay false: without a verified first code,
    // a hijacked session could enroll its own authenticator and lock out the
    // real owner. See the security review in PR history. Better Auth keeps the
    // option on the plugin's `options` bag.
    const options = makeAuthOptions(baseConfig)
    const twoFactor = options.plugins.find(
      (plugin) => 'id' in plugin && plugin.id === 'two-factor'
    )
    // SAFETY: the two-factor plugin is in the array above by construction;
    // this reads the one option this file pins off its `options` bag, which
    // the plugin's declared type omits.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effect/noAs -- reading an option Better Auth's plugin type does not declare
    const twoFactorOptions = twoFactor as {
      options: { skipVerificationOnEnable: boolean | undefined } | undefined
    }
    expect(twoFactorOptions.options?.skipVerificationOnEnable).toBe(false)
  })

  it('sets a one-hour fresh window for sensitive actions', () => {
    expect(makeAuthOptions(baseConfig).session).toMatchObject({
      freshAge: 60 * 60
    })
  })

  it('pins the password policy above Better Auth defaults', () => {
    expect(makeAuthOptions(baseConfig).emailAndPassword).toMatchObject({
      minPasswordLength: 12,
      maxPasswordLength: 256
    })
  })

  it('pins the reset-token window to thirty minutes', () => {
    // Explicit so a Better Auth default change cannot silently lengthen the
    // window in which a leaked reset link is live.
    expect(makeAuthOptions(baseConfig).emailAndPassword).toMatchObject({
      resetPasswordTokenExpiresIn: 60 * 30
    })
  })

  it('states the session lifetime instead of trusting defaults', () => {
    expect(makeAuthOptions(baseConfig).session).toMatchObject({
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24
    })
  })

  describe('background tasks', () => {
    it("hands every detached promise to the caller's runner", () => {
      // `runBackground` is required on the config: this package picks no
      // fallback, so a Worker without `waitUntil` cannot silently lose a send
      // — the app decides what a detached promise means and owns its
      // rejection.
      const runBackground = vi.fn()
      const handler = makeAuthOptions({ ...baseConfig, runBackground }).advanced
        .backgroundTasks.handler
      const promise = Promise.resolve()
      handler(promise)
      expect(runBackground).toHaveBeenCalledWith(promise)
    })
  })

  describe('lifecycle emails', () => {
    it("passes the app's adapter through as Better Auth's own callbacks", () => {
      // The port carries Better Auth's callback signature, so there is no
      // rename wrapper between the two — identity, not equivalence.
      const options = makeAuthOptions(baseConfig)
      expect(options.emailAndPassword.sendResetPassword).toBe(
        baseConfig.emails.sendResetPassword
      )
      expect(options.emailVerification.sendVerificationEmail).toBe(
        baseConfig.emails.sendVerificationEmail
      )
    })
  })

  describe('admin gate', () => {
    it('reads the privileged system role from the stored vocabulary', () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'admin')
      expect(options.adminRoles).toEqual([adminSystemRole])
    })
  })

  describe('two-factor knobs', () => {
    it('pins the challenge-cookie and trusted-device windows', () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'two-factor')
      expect(options.twoFactorCookieMaxAge).toBe(600)
      expect(options.trustDeviceMaxAge).toBe(60 * 60 * 24 * 30)
    })
  })

  describe('organization knobs', () => {
    it('caps workspaces per user and pins invitation hygiene', () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'organization')
      expect(options.organizationLimit).toBe(5)
      expect(options.invitationExpiresIn).toBe(60 * 60 * 24 * 7)
      expect(options.invitationLimit).toBe(50)
      expect(options.cancelPendingInvitationsOnReInvite).toBe(true)
    })

    it('lets unverified users create workspaces while verification is off', () => {
      const allowUserToCreateOrganization = allowCreateOrganization(
        makeAuthOptions(baseConfig)
      )
      expect(allowUserToCreateOrganization({ emailVerified: false })).toBe(true)
    })

    it('gates workspace creation on a verified mailbox when verification is enforced', () => {
      const allowUserToCreateOrganization = allowCreateOrganization(
        makeAuthOptions({ ...baseConfig, requireEmailVerification: true })
      )
      expect(allowUserToCreateOrganization({ emailVerified: false })).toBe(false)
      expect(allowUserToCreateOrganization({ emailVerified: true })).toBe(true)
    })
  })
})

/**
 * Reads a Better Auth plugin's `options` bag, which the plugin's declared
 * type omits — the same access the skipVerificationOnEnable test above makes.
 */
function pluginOptions(
  plugins: ReturnType<typeof makeAuthOptions>['plugins'],
  id: string
): Record<string, unknown> {
  const plugin = plugins.find((candidate) => 'id' in candidate && candidate.id === id)
  // SAFETY: every option read through this helper lives on that bag by
  // construction of `makeAuthOptions`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effect/noAs -- reading an options bag Better Auth's plugin types do not declare
  return (plugin as { options?: Record<string, unknown> }).options ?? {}
}

/** The creation gate, read off the organization plugin's bag and typed. */
function allowCreateOrganization(options: ReturnType<typeof makeAuthOptions>) {
  const raw = pluginOptions(
    options.plugins,
    'organization'
  ).allowUserToCreateOrganization
  // SAFETY: `makeAuthOptions` passes the predicate straight through; this is
  // its own declared shape, just re-asserted for the test's call site.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effect/noAs -- re-typing a value stored as unknown by pluginOptions
  return raw as (user: { emailVerified: boolean }) => boolean
}
