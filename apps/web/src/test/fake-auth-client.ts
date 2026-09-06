import { vi } from 'vite-plus/test'

/**
 * The double, pre-built. Vitest isolates module state per test file, so one
 * instance serves the whole file: install it in the factory and bind the
 * endpoint mocks off it directly —
 *
 * ```ts
 * vi.mock('@/lib/auth-client', async () => {
 *   const { authClientDouble } = await import('@/test/fake-auth-client')
 *   return { authClient: authClientDouble }
 * })
 * import { authClientDouble } from '@/test/fake-auth-client'
 * authClientDouble.signIn.email.mockResolvedValue({ error: null })
 * ```
 *
 * Binding off the double beats re-typing the mocked module
 * (`authClient as unknown as FakeAuthClient`): the double's loose `vi.fn()`s
 * accept the wire-accurate envelope fixtures the real client's strict result
 * unions reject, with no cast and no disable chain.
 *
 * Every endpoint is an unstubbed `vi.fn()` (calls return `undefined` until a
 * test answers them), so a test that forgets to mock an endpoint it exercises
 * fails loudly instead of silently passing. `$store` and `useSession` keep
 * `src/test/setup.ts` and the shell working under the mock.
 */
export function fakeAuthClient() {
  return {
    $store: { atoms: { session: { subscribe: () => {} } } },
    useSession: vi.fn(() => ({ data: null, isPending: false, error: null })),
    getLastUsedLoginMethod: vi.fn((): string | null => null),
    listAccounts: vi.fn(),
    unlinkAccount: vi.fn(),
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    sendVerificationEmail: vi.fn(),
    signOut: vi.fn(),
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
      sso: vi.fn(),
      passkey: vi.fn(),
      magicLink: vi.fn(),
      emailOtp: vi.fn()
    },
    signUp: { email: vi.fn() },
    emailOtp: {
      sendVerificationOtp: vi.fn(),
      verifyEmail: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn()
    },
    twoFactor: {
      verifyTotp: vi.fn(),
      verifyBackupCode: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      generateBackupCodes: vi.fn()
    },
    passkey: {
      listUserPasskeys: vi.fn(),
      addPasskey: vi.fn(),
      updatePasskey: vi.fn(),
      deletePasskey: vi.fn()
    }
  }
}

/** The double's own shape, for binding the endpoint mocks in a test. */
export type FakeAuthClient = ReturnType<typeof fakeAuthClient>

/**
 * The one double per test file, shared between the mock factory and the
 * test's own bindings — see the usage note above.
 */
export const authClientDouble: FakeAuthClient = fakeAuthClient()
