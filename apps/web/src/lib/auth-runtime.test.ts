import { Auth, type Session } from '@b2b-saas-starter/auth'
import { isRedirect } from '@tanstack/react-router'
import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

/** A request carrying Better Auth's default session cookie, so a working layer would have a session to answer with. */
const SESSION_COOKIE = new Headers({
  cookie: 'better-auth.session_token=degraded-layer-probe'
})

/**
 * The no-D1 state (fresh clone, preview build on the inert workers shim)
 * through the runtime: `api.getSession` must RESOLVE null — that is what the
 * route gates read as "redirect to /sign-in", which the `requireSession`
 * case asserts directly — while any other `api` property
 * still throws the `MissingD1Binding` sentinel, so nothing downstream can
 * mistake the degraded service for a half-built Better Auth.
 *
 * Vitest runs on the same shim the preview build bundles (`env.DB` is
 * undefined), so `authRuntime` builds the degraded layer here exactly as it
 * does there.
 */
describe('authRuntime without a D1 binding', () => {
  it('resolves getSession as null', async () => {
    // The cookie makes this discriminate: a session-bearing request is the
    // one a working layer could answer with a session, so the null is the
    // degraded service's own answer, not what any layer says to an empty
    // header set.
    const { authRuntime } = await import('./auth-runtime')
    const session = await authRuntime.runPromise(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        return yield* auth.api.getSession({ headers: SESSION_COOKIE })
      })
    )
    expect(session).toBeNull()
  })

  it('turns the degraded layer into the sign-in redirect (requireSession)', async () => {
    // The real gate over the real degraded runtime: the sentinel must not
    // escape through a route gate — null becomes the redirect.
    const { authRuntime } = await import('./auth-runtime')
    const { requireSession } = await import('./server/auth')
    function readOnDegradedRuntime(): Promise<Session | null> {
      return authRuntime.runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          return yield* auth.api.getSession({ headers: SESSION_COOKIE })
        })
      )
    }
    const thrown = await requireSession('/demo', readOnDegradedRuntime).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(isRedirect(thrown)).toBe(true)
    if (isRedirect(thrown)) {
      expect(thrown.options.to).toBe('/sign-in')
      expect(thrown.options.search).toEqual({ redirect: '/demo' })
    }
  })

  it('still refuses the rest of the api surface', async () => {
    const { authRuntime } = await import('./auth-runtime')
    // Reaching past `getSession` on purpose: the property access itself must
    // throw the sentinel (naming the property), not return a half-working
    // surface. The refusal escapes as a rejected promise here — the same
    // defect channel the catchall's pre-read folds into "no session".
    // The sentinel identifies itself by shape: the tagged refusal naming the
    // property that was reached for.
    let refusalProperty: string | undefined
    await authRuntime
      .runPromise(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          // `signUpEmail` is on the typed api surface, so the access
          // typechecks — the runtime refusal below is the degraded layer's,
          // not a type-level shortcut.
          void auth.api.signUpEmail
          return null
        })
      )
      .then(
        () => undefined,
        (error: unknown) => {
          refusalProperty = sentinelProperty(error)
        }
      )
    expect(refusalProperty).toBe('signUpEmail')
  })
})

/** The sentinel's `property` field, or `undefined` for anything else. */
// oxlint-disable anti-slop/no-runtime-typeof -- a rejected promise's value is `unknown` by construction; this probe is the parse step
function sentinelProperty(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('property' in value)) {
    return undefined
  }
  const property = value.property
  return typeof property === 'string' ? property : undefined
}
// oxlint-enable anti-slop/no-runtime-typeof
