import { createDrizzleDb, type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { Effect, Layer } from 'effect'
import {
  cookieHeader as cookieHeaderOf,
  cookiePairs,
  mergeCookiePairs,
  signUpSession as signUpSessionWith,
  type Service,
  type SignUpSession
} from 'effectful-better-auth'
import {
  Auth,
  AuthConfig,
  type AuthConfigInterface,
  type AuthOptions
} from './index.ts'
import { testMcpConfig } from './test-mcp.ts'
import { decodeUriSecret } from './test-totp.ts'

/**
 * The one live-suite scaffold, shared by every suite that drives the real
 * `Auth` service against a local D1: provisioning, the default `AuthConfig`
 * layer, a session-cookie sign-up, and the cookie-merge plumbing. Test-only —
 * never import this from application code (same stance as `./testing` in
 * `packages/db`).
 */

/** The service type every live suite's `run` helper provides. */
export type AuthService = Service<AuthOptions>

/** What `provisionAuthD1` hands back, kept so suites can type their state. */
export type ProvisionedAuthD1 = {
  readonly d1: TestD1['d1']
  readonly db: DrizzleDatabase
  readonly dispose: () => Promise<void>
}

const SIGN_UP_PASSWORD = 'correct-horse-battery-staple'

// oxlint-disable-next-line effect/noAsyncFunction, eslint/require-await -- Better Auth's port signatures are Promise<void>; a default that does nothing is the point, and there is no Effect here to return
async function noop(): Promise<void> {
  return undefined
}

/**
 * Boots an isolated, non-persisted local D1 (workerd, every committed
 * migration applied) and opens the promise-based drizzle client Better Auth's
 * adapter needs. Callers own the lifecycle: run once per suite and always
 * `await dispose()` in `afterAll`.
 */
export function provisionAuthD1(): Promise<ProvisionedAuthD1> {
  return provisionTestD1().then((testD1) => ({
    d1: testD1.d1,
    db: createDrizzleDb(testD1.d1),
    dispose: () => testD1.dispose()
  }))
}

/**
 * The `Auth` service layer over a test config: the defaults every live suite
 * shares (a fixed secret, the local dev origin, no trusted origins, no-op
 * email sender and account hooks, an inline background runner, the refusing
 * MCP metadata transport), with the caller's overrides merged on top so a
 * suite states only what it differs in — the capturing email sender, an
 * active social provider, capturing account hooks.
 */
export function buildAuthLayer(
  db: DrizzleDatabase,
  overrides: Partial<AuthConfigInterface> = {}
): Layer.Layer<AuthService> {
  return Auth.layer.pipe(
    Layer.provide(
      Layer.sync(AuthConfig)(() => ({
        db,
        secret: 'test-secret-at-least-32-characters-long',
        baseURL: 'http://localhost:3071',
        trustedOrigins: [],
        // No-op callbacks (Better Auth's own Promise<void> signatures — no
        // Effect reaches its config). The suites that care override them.
        emails: {
          sendResetPassword: noop,
          sendVerificationEmail: noop,
          sendOneTimeCode: noop,
          sendMagicLink: noop
        },
        // No provider configured: the Local Auth Path shape, unchanged.
        socialProviders: {},
        accountHooks: {
          onAccountLinked: noop,
          onAccountUnlinked: noop
        },
        // Local-mode stance: the gate stays off in tests, matching dev.
        requireEmailVerification: false,
        // No execution context in a test: run the detached send inline and
        // keep its rejection off the isolate's unhandled path.
        runBackground: (promise) => {
          void promise.catch(() => undefined)
        },
        mcp: testMcpConfig(),
        ...overrides
      }))
    )
  )
}

/**
 * A real session cookie: the library kit's sign-up over the app's `Auth`
 * service and fixed test password. The result carries `headers` for the
 * endpoints that require request headers, `cookieHeader`/`cookiePairs` for
 * merging with later session rotations, and `userId` for row-level assertions.
 */
export function signUpSession(email: string) {
  return signUpSessionWith(Auth.Tag, { email, password: SIGN_UP_PASSWORD })
}

/**
 * The enable→verify TOTP ceremony, the way the account panel runs it: enable
 * (the one-time reveal of the otpauth URI and backup codes), then a first
 * verified code. Enabling stores an unverified secret only — the FIRST
 * verified code is what flips `twoFactorEnabled`, and it rotates the session
 * token, so the returned cookie is the sign-up jar merged through every
 * rotation the ceremony caused — pair-wise, so cookies the rotations do not
 * touch (e.g. `last_used_login_method`) survive. The `full` surface is used
 * because its response headers are what carry those cookies.
 */
export function enableTotp(session: SignUpSession) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const enabled = yield* auth.full.enableTwoFactor({
      body: { password: SIGN_UP_PASSWORD },
      headers: session.headers
    })
    const response = enabled.response
    if (response.method !== 'totp') {
      // oxlint-disable-next-line starter/no-effect-escape-hatch -- test invariant: the wrong response shape means the ceremony helper is broken, not the code under test
      return yield* Effect.die('expected TOTP enable response')
    }
    const secret = new URL(response.totpURI).searchParams.get('secret')
    if (secret === null) {
      // oxlint-disable-next-line starter/no-effect-escape-hatch -- test invariant: same as above — a malformed otpauth URI is a helper bug
      return yield* Effect.die('the TOTP enable response carried no secret')
    }
    // Server-side helper endpoint: turns a secret into a valid code, so the
    // test plays its own authenticator.
    const { code } = yield* auth.api.generateTOTP({
      body: { secret: decodeUriSecret(secret) }
    })
    const afterEnable = mergeCookiePairs(
      session.cookiePairs,
      cookiePairs(enabled.headers)
    )
    const verified = yield* auth.full.verifyTOTP({
      body: { code },
      headers: new Headers({ cookie: cookieHeaderOf(afterEnable) })
    })
    const freshCookieHeader = cookieHeaderOf(
      mergeCookiePairs(afterEnable, cookiePairs(verified.headers))
    )
    return { response, freshCookieHeader }
  })
}
