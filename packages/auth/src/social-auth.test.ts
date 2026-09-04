import { createDrizzleDb, type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { account, user } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { and, eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { type Service } from 'effectful-better-auth'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vite-plus/test'
import {
  Auth,
  AuthConfig,
  type AuthAccountChange,
  type AuthEmailSender,
  type AuthOptions
} from './index.ts'
import { testMcpConfig } from './test-mcp.ts'

// Social sign-in is only observable end to end: the provider factory, the
// state round-trip, implicit account linking, and the linking hooks all
// resolve inside Better Auth against a real database. This suite drives the
// full OAuth round-trip with GitHub as the provider and its HTTP endpoints
// mocked — the accept criterion is the round trip, not the redirect shape.

type AuthService = Service<AuthOptions>

let testD1: TestD1
let db: DrizzleDatabase
let authLayer: Layer.Layer<AuthService>

// The linking audit port, captured instead of performed: these tests assert
// Better Auth hands the account row over; the governance write is the app
// adapter's test (apps/web).
const accountChanges: Array<{
  readonly kind: 'linked' | 'unlinked'
  readonly account: AuthAccountChange
}> = []

const capturingAccountHooks = {
  onAccountLinked: (change: AuthAccountChange) => {
    accountChanges.push({ kind: 'linked', account: change })
    return Promise.resolve()
  },
  onAccountUnlinked: (change: AuthAccountChange) => {
    accountChanges.push({ kind: 'unlinked', account: change })
    return Promise.resolve()
  }
}

const capturingEmails: AuthEmailSender = {
  sendResetPassword: () => Promise.resolve(),
  sendVerificationEmail: () => Promise.resolve(),
  sendOneTimeCode: () => Promise.resolve()
}

// The mocked GitHub identity for one test. Every test picks a fresh mailbox
// AND a fresh provider subject id (all four share one D1, and the account
// key is `(issuer, accountId)` — reusing a subject id would match the
// previous test's linked account instead of exercising this test's path), so
// the profile is state the test sets rather than a module constant the stub
// would freeze.
const githubProfile = {
  id: 987_654,
  login: 'linked-octocat',
  name: 'Linked Octocat',
  email: 'linked@social.test',
  avatar_url: 'https://avatars.githubusercontent.com/u/987654'
}

/** Distinct mailbox + subject id per test — see `githubProfile`. */
function useGithubIdentity(email: string, id: number) {
  githubProfile.email = email
  githubProfile.id = id
}

/**
 * Stands in for GitHub's three OAuth endpoints. Better Auth reaches them
 * through global `fetch` (better-fetch), so the whole provider is mocked at
 * the HTTP boundary — no network, no token, same round trip. The mock IS the
 * platform boundary: it answers requests (async, `typeof`-narrowed fetch
 * inputs, hand-serialized JSON), which is the one place those platform
 * idioms are the point rather than a shortcut.
 */
// oxlint-disable effect/noAsyncFunction, anti-slop/no-runtime-typeof, effect/noGlobals
function stubGitHubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === 'https://github.com/login/oauth/access_token') {
        return jsonResponse({
          access_token: 'gho_mock_access_token',
          token_type: 'bearer'
        })
      }
      if (url === 'https://api.github.com/user') {
        return jsonResponse(githubProfile)
      }
      if (url === 'https://api.github.com/user/emails') {
        return jsonResponse([
          {
            email: githubProfile.email,
            primary: true,
            verified: true,
            visibility: 'public'
          }
        ])
      }
      return jsonResponse({ message: `unexpected fetch in test: ${url}` }, 500)
    })
  )
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.href
  }
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
// oxlint-enable effect/noAsyncFunction, anti-slop/no-runtime-typeof, effect/noGlobals

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        testD1 = yield* Effect.promise(() => provisionTestD1())
        db = createDrizzleDb(testD1.d1)
        authLayer = Auth.layer.pipe(
          Layer.provide(
            Layer.sync(AuthConfig)(() => ({
              db,
              secret: 'test-secret-at-least-32-characters-long',
              baseURL: 'http://localhost:3071',
              trustedOrigins: [],
              emails: capturingEmails,
              // GitHub active: both halves of the credential present, exactly
              // what `activeSocialProviders` resolves from a configured env.
              socialProviders: {
                github: {
                  clientId: 'mock-client-id',
                  clientSecret: 'mock-client-secret'
                }
              },
              accountHooks: capturingAccountHooks,
              requireEmailVerification: false,
              runBackground: (promise) => {
                void promise.catch(() => undefined)
              },
              mcp: testMcpConfig()
            }))
          )
        )
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- restores the global fetch each test stubbed
afterEach(() => {
  vi.unstubAllGlobals()
})

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
afterAll(() => testD1.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

/** A verified email/password user — the implicit-linking precondition. */
function seedVerifiedLocalUser(email: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const { user: created } = yield* Effect.promise(() =>
      auth.instance.api.signUpEmail({
        body: { email, name: email, password: 'correct-horse-battery-staple' }
      })
    )
    // The production counterpart verified through the emailed link; the link
    // flow must not depend on that hop having run in the same process.
    yield* Effect.promise(() =>
      db.update(user).set({ emailVerified: true }).where(eq(user.id, created.id)).run()
    )
    return created.id
  })
}

/**
 * The full provider round trip: initiation returns GitHub's authorize URL
 * and sets the signed state cookie; the test replays the provider's redirect
 * (same `state`, a one-time `code`) with that cookie, exactly as a browser
 * would. The mocked endpoints answer the token exchange and profile reads;
 * Better Auth does everything else for real.
 */
function completeGithubRoundTrip() {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    stubGitHubFetch()

    const initiation = yield* Effect.promise(() =>
      auth.instance.api.signInSocial({
        body: {
          provider: 'github',
          callbackURL: 'http://localhost:3071/workspaces'
        },
        returnHeaders: true
      })
    )
    const authorizeUrlText = initiation.response.url
    expect(authorizeUrlText).toContain('https://github.com/login/oauth/authorize')
    // The expect pins the URL to GitHub's authorize endpoint; the fallback
    // origin would parse no state and fail the next assert.
    const state = new URL(authorizeUrlText ?? 'http://localhost:3071').searchParams.get(
      'state'
    )
    expect(state).toBeTruthy()
    // The signed `state` cookie the callback verifies against the database
    // row — the browser carries it from initiation to redirect. Better Auth
    // prefixes its cookie names (`better-auth.state`).
    const stateCookie = initiation.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0] ?? '')
      .find((pair) => pair.split('=')[0] === 'better-auth.state')
    expect(stateCookie).toBeDefined()

    return yield* Effect.promise(() =>
      auth.instance.handler(
        new Request(
          `http://localhost:3071/api/auth/callback/github?code=mock-code&state=${state}`,
          { headers: { cookie: stateCookie ?? '' } }
        )
      )
    )
  })
}

describe('social sign-in', () => {
  it('links a matching verified social email to the existing account and signs in', () =>
    run(
      Effect.gen(function* () {
        useGithubIdentity('linked@social.test', 987_654)
        const userId = yield* seedVerifiedLocalUser('linked@social.test')
        const before = accountChanges.length

        const callback = yield* completeGithubRoundTrip()

        // The round trip ends in a redirect to the callback URL with a fresh
        // session cookie — the sign-in completed.
        expect(callback.status).toBe(302)
        expect(callback.headers.get('location')).toBe(
          'http://localhost:3071/workspaces'
        )
        expect(
          callback.headers
            .getSetCookie()
            .some((cookie) => cookie.startsWith('better-auth'))
        ).toBe(true)

        // Implicit linking: the GitHub account row belongs to the existing
        // email/password user, not a second user.
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(account)
            .where(and(eq(account.providerId, 'github'), eq(account.userId, userId)))
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.accountId).toBe(String(githubProfile.id))

        // The linking audit port saw the same row. Better Auth hands the
        // whole account row to the hook; the port's contract is the two
        // fields the audit reads.
        const change = accountChanges
          .slice(before)
          .find((entry) => entry.kind === 'linked')
        expect(change?.account).toMatchObject({ providerId: 'github', userId })

        // Still exactly one user for that mailbox.
        const users = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, 'linked@social.test'))
        )
        expect(users).toHaveLength(1)
      })
    ))

  it('signs up a first-time social visitor as one user with the provider account', () =>
    run(
      Effect.gen(function* () {
        useGithubIdentity('first-time@social.test', 654_321)
        const before = accountChanges.length

        const callback = yield* completeGithubRoundTrip()

        expect(callback.status).toBe(302)
        const users = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, 'first-time@social.test'))
        )
        expect(users).toHaveLength(1)
        expect(accountChanges.slice(before).at(-1)?.account).toMatchObject({
          providerId: 'github',
          userId: users[0]!.id
        })
      })
    ))

  it('refuses the link when the local mailbox is not verified', () =>
    run(
      Effect.gen(function* () {
        useGithubIdentity('squatter@social.test', 111_222)
        const auth = yield* Auth.Tag
        // An unverified local user: the exact account-takeover shape the
        // `requireLocalEmailVerified` default exists to refuse.
        const { user: squatter } = yield* Effect.promise(() =>
          auth.instance.api.signUpEmail({
            body: {
              email: 'squatter@social.test',
              name: 'Squatter',
              password: 'correct-horse-battery-staple'
            }
          })
        )
        const before = accountChanges.length

        const callback = yield* completeGithubRoundTrip()

        // No silent takeover: the visitor is bounced with an error, no
        // account row is created, and no linking event fires.
        expect(callback.status).toBe(302)
        expect(
          new URL(callback.headers.get('location') ?? '').searchParams.get('error')
        ).toBe('account_not_linked')
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(account)
            .where(
              and(eq(account.providerId, 'github'), eq(account.userId, squatter.id))
            )
        )
        expect(rows).toHaveLength(0)
        expect(accountChanges.slice(before)).toHaveLength(0)
        // The squatter keeps the mailbox; no second user was provisioned.
        const users = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, 'squatter@social.test'))
        )
        expect(users).toHaveLength(1)
        expect(users[0]?.id).toBe(squatter.id)
      })
    ))

  it('unlinks a provider through the endpoint and reports it to the port', () =>
    run(
      Effect.gen(function* () {
        useGithubIdentity('unlink@social.test', 333_444)
        const userId = yield* seedVerifiedLocalUser('unlink@social.test')
        yield* completeGithubRoundTrip()
        const auth = yield* Auth.Tag

        // A credential session for the unlink call: sign in with the local
        // password (the same account's other method).
        const signedIn = yield* Effect.promise(() =>
          auth.instance.api.signInEmail({
            body: {
              email: 'unlink@social.test',
              password: 'correct-horse-battery-staple'
            },
            returnHeaders: true
          })
        )
        const headers = new Headers({
          cookie: signedIn.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';')[0])
            .join('; ')
        })

        const target = yield* Effect.promise(() =>
          db
            .select()
            .from(account)
            .where(and(eq(account.providerId, 'github'), eq(account.userId, userId)))
        )
        expect(target).toHaveLength(1)

        const before = accountChanges.length
        const unlinked = yield* Effect.promise(() =>
          auth.instance.api.unlinkAccount({
            body: { accountId: target[0]!.id },
            headers
          })
        )
        // The endpoint answers `{ status: true }` and requires a fresh
        // session (signed in above, inside the one-hour window).
        expect(unlinked.status).toBe(true)

        const remaining = yield* Effect.promise(() =>
          db
            .select()
            .from(account)
            .where(and(eq(account.providerId, 'github'), eq(account.userId, userId)))
        )
        expect(remaining).toHaveLength(0)
        expect(accountChanges.slice(before).at(-1)?.account).toMatchObject({
          providerId: 'github',
          userId
        })
      })
    ))
})
