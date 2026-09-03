import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  type AuthConfigInterface,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  makeAuthOptions
} from './index.ts'
import { testMcpConfig } from './test-mcp.ts'

type AuthPlugin = ReturnType<typeof makeAuthOptions>['plugins'][number]

/** A plugin's id, or the empty string for a plugin object without one. */
function pluginId(plugin: AuthPlugin): string {
  if ('id' in plugin) {
    return plugin.id
  }
  return ''
}

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
    sendVerificationEmail: () => Promise.resolve(),
    sendOneTimeCode: () => Promise.resolve(),
    sendMagicLink: () => Promise.resolve()
  },
  // The provider-light default: no provider resolved, so no social surface.
  socialProviders: {},
  // The linking audit port, captured rather than performed: these tests
  // assert on the wiring, not on governance writes.
  accountHooks: {
    onAccountLinked: () => Promise.resolve(),
    onAccountUnlinked: () => Promise.resolve()
  },
  requireEmailVerification: false,
  runBackground: (promise) => {
    void promise.catch(() => undefined)
  },
  mcp: testMcpConfig()
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

  describe('social providers', () => {
    it('resolves zero providers when none are active', () => {
      // The provider-light default: no provider key exists at all, so
      // Better Auth resolves no providers — the Local Auth Path's runtime
      // shape, unchanged from before social sign-in existed.
      expect(makeAuthOptions(baseConfig).socialProviders).toEqual({})
    })

    it('forwards an active provider as Better Auth socialProviders', () => {
      const options = makeAuthOptions({
        ...baseConfig,
        socialProviders: {
          github: { clientId: 'client-id', clientSecret: 'client-secret' }
        }
      })
      expect(options.socialProviders).toEqual({
        github: { clientId: 'client-id', clientSecret: 'client-secret' }
      })
    })
  })

  describe('account linking hooks', () => {
    it("hands account rows to the caller's link and unlink hooks", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          // The port's promise shape matters: `Effect.promise` awaits what the
          // hook returns, so the doubles resolve rather than answer undefined.
          const onAccountLinked = vi.fn().mockResolvedValue(undefined)
          const onAccountUnlinked = vi.fn().mockResolvedValue(undefined)
          const hooks = makeAuthOptions({
            ...baseConfig,
            accountHooks: { onAccountLinked, onAccountUnlinked }
          }).databaseHooks.account
          const account = { providerId: 'github', userId: 'usr_demo' }

          yield* Effect.promise(() => hooks.create.after(account))
          yield* Effect.promise(() => hooks.delete.after(account))

          expect(onAccountLinked).toHaveBeenCalledWith(account)
          expect(onAccountUnlinked).toHaveBeenCalledWith(account)
        })
      ))
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

  describe('email-otp knobs', () => {
    it('pins six digits, ten minutes, and three attempts', () => {
      // Stated rather than defaulted (only the six is Better Auth's default),
      // so a plugin default change cannot silently lengthen the brute-force
      // window a leaked code has.
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'email-otp')
      expect(options.otpLength).toBe(6)
      expect(options.expiresIn).toBe(60 * 10)
      expect(options.allowedAttempts).toBe(3)
    })

    it('hashes codes at rest and refuses to register unknown addresses', () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'email-otp')
      expect(options.storeOTP).toBe('hashed')
      expect(options.disableSignUp).toBe(true)
    })

    it("passes the app's one-time-code adapter through as the plugin's callback", () => {
      const options = makeAuthOptions(baseConfig)
      const otpOptions = pluginOptions(options.plugins, 'email-otp')
      expect(otpOptions.sendVerificationOTP).toBe(baseConfig.emails.sendOneTimeCode)
    })
  })

  describe('magic-link knobs', () => {
    it('pins the link window to ten minutes and hashes the stored token', () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'magic-link')
      expect(MAGIC_LINK_EXPIRES_IN_SECONDS).toBe(60 * 10)
      expect(options.expiresIn).toBe(MAGIC_LINK_EXPIRES_IN_SECONDS)
      expect(options.storeToken).toBe('hashed')
      // Sign-up through a link stays on: the plugin marks the new user
      // verified, because consuming the link is the mailbox proof.
      expect(options.disableSignUp).toBe(false)
    })

    it("passes the app's adapter through as the plugin's own callback", () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'magic-link')
      expect(options.sendMagicLink).toBe(baseConfig.emails.sendMagicLink)
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

  describe('passkey knobs', () => {
    it('derives rpID and origin from the app URL, not a second env var', () => {
      const options = pluginOptions(makeAuthOptions(baseConfig).plugins, 'passkey')
      // `localhost` is a valid WebAuthn rpID, so the Local Auth Path gains
      // passkeys with zero configuration.
      expect(options.rpID).toBe('localhost')
      expect(options.origin).toBe('http://localhost:3071')
    })

    it('derives a production rpID that drops the subdomain port only', () => {
      const config = { ...baseConfig, baseURL: 'https://app.example.com' }
      const options = pluginOptions(makeAuthOptions(config).plugins, 'passkey')
      expect(options.rpID).toBe('app.example.com')
      expect(options.origin).toBe('https://app.example.com')
    })

    it('drops a path and trailing slash from the origin', () => {
      const config = { ...baseConfig, baseURL: 'https://app.example.com/' }
      const options = pluginOptions(makeAuthOptions(config).plugins, 'passkey')
      expect(options.origin).toBe('https://app.example.com')
    })
  })

  describe('last-login method', () => {
    it('includes the core plugin, before the cookie bridge', () => {
      // Cookie-backed only (no `storeInDatabase`, so no user column and no
      // migration). Presence and position are the two things this file pins;
      // the inference contract stays guarded by `SessionUserRole`.
      const options = makeAuthOptions(baseConfig).plugins
      const ids = options.map((plugin) => pluginId(plugin))
      expect(ids).toContain('last-login-method')
      expect(ids.at(-1)).toBe('tanstack-start-cookies')
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

describe('mcp oauth plugins', () => {
  function pluginIds(config: AuthConfigInterface): ReadonlyArray<string> {
    return makeAuthOptions(config).plugins.map((plugin) => plugin.id)
  }

  it('registers jwt before the oauth provider, and cimd beside it', () => {
    const ids = pluginIds(baseConfig)
    expect(ids).toContain('jwt')
    expect(ids).toContain('oauth-provider')
    expect(ids).toContain('cimd')
    // `mcp()` reads the jwt plugin at init; jwt has to be registered first.
    expect(ids.indexOf('jwt')).toBeLessThan(ids.indexOf('oauth-provider'))
    // Cookie integration stays last (see the plugin table in AGENTS.md).
    expect(ids.at(-1)).toBe('tanstack-start-cookies')
  })

  it('binds access tokens to the configured MCP resource and both starter pages', () => {
    const provider = makeAuthOptions(baseConfig).plugins.find(
      (plugin) => plugin.id === 'oauth-provider'
    )
    // `find` narrows to the provider plugin, whose `options` are the ones
    // `mcp()` forwarded — typed, so no assertion is needed to read them.
    expect(provider?.options.loginPage).toBe('/sign-in')
    expect(provider?.options.consentPage).toBe('/oauth/consent')
    expect(provider?.options.resources).toContain('http://localhost:8787/mcp')
    expect(provider?.options.clientRegistrationDefaultResources).toEqual([
      'http://localhost:8787/mcp'
    ])
    expect(provider?.options.scopes).toContain('mcp:read')
  })

  it('does not sign session responses as JWTs', () => {
    const jwt = makeAuthOptions(baseConfig).plugins.find(
      (plugin) => plugin.id === 'jwt'
    )
    expect(jwt?.options.disableSettingJwtHeader).toBe(true)
  })
})
