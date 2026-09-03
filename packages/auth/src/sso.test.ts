import { createDrizzleDb, type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { account, user, workspaceMembers } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { type Service } from 'effectful-better-auth'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { Auth, AuthConfig, type AuthEmailSender, type AuthOptions } from './index.ts'

// The `sso` plugin's OIDC flow is only observable end to end against a real
// database AND a real IdP. This suite stands the IdP up as a `globalThis.fetch`
// stub (discovery endpoints, token exchange, JWKS, UserInfo) and drives the
// full round trip — register a workspace connection, resolve it by email
// domain, redirect out, callback in — so provisioning and role assignment are
// asserted against the rows the plugin actually wrote, not a mocked service.

type AuthService = Service<AuthOptions>

const ISSUER = 'https://idp.roundtrip.test'
const PROVIDER_ID = 'rt_oidc'

let testD1: TestD1
let db: DrizzleDatabase
let authLayer: Layer.Layer<AuthService>

const capturingEmailSender: AuthEmailSender = {
  sendResetPassword: () => Promise.resolve(),
  sendVerificationEmail: () => Promise.resolve()
}

/* -------------------------------------------------------------------------- */
/* The stand-in identity provider                                              */
/* -------------------------------------------------------------------------- */

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
})

const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  alg: 'RS256',
  use: 'sig',
  kid: 'rt-test-key'
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

/**
 * Signs an RS256 ID token the plugin's `jose` verifier will accept. `exp` is
 * fixed relative to the real clock — the verifier reads the wall clock, so
 * `Clock` cannot control it.
 */
// oxlint-disable-next-line effect/noGlobals -- jose verifies against the wall clock; the token's lifetime is a fixed offset from it, not a Clock read
const issuedAt = Math.floor(Date.now() / 1000)

// oxlint-disable effect/noGlobals -- this suite IS the JSON/serialization boundary: a fake IdP, not an app write path
function signIdToken(claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: publicJwk.kid }
  const payload = { iat: issuedAt, exp: issuedAt + 600, ...claims }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey)
  return `${signingInput}.${base64Url(signature)}`
}

let idTokenSubject = 'idp-user-1'
let idTokenEmail = 'provisioned@roundtrip.test'
let idTokenName = 'Provisioned Member'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

const realFetch = globalThis.fetch

function requestUrl(input: RequestInfo | URL): string {
  // Normalizes every RequestInfo variant without probing the union.
  return new Request(input).url
}

// The one async boundary this suite owns: the fetch seam itself, replaced on
// globalThis. Effect wrappers would only re-wrap the same promise.
// oxlint-disable-next-line effect/noAsyncFunction -- the global fetch seam is async by contract
async function stubbedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = requestUrl(input)
  if (url === `${ISSUER}/token`) {
    return jsonResponse({
      access_token: 'rt-access-token',
      token_type: 'Bearer',
      scope: 'openid email profile',
      id_token: signIdToken({
        iss: ISSUER,
        aud: 'rt-client',
        sub: idTokenSubject,
        email: idTokenEmail,
        email_verified: true,
        name: idTokenName
      })
    })
  }
  if (url === `${ISSUER}/jwks`) {
    return jsonResponse({ keys: [publicJwk] })
  }
  if (url === `${ISSUER}/userinfo`) {
    return jsonResponse({
      sub: idTokenSubject,
      email: idTokenEmail,
      email_verified: true,
      name: idTokenName
    })
  }
  return new Response(`unexpected fetch: ${url} ${init?.method ?? ''}`, {
    status: 404
  })
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process and the fetch stub
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        testD1 = yield* Effect.promise(() => provisionTestD1())
        db = createDrizzleDb(testD1.d1)
        globalThis.fetch = stubbedFetch
        authLayer = Auth.layer.pipe(
          Layer.provide(
            Layer.sync(AuthConfig)(() => ({
              db,
              secret: 'test-secret-at-least-32-characters-long',
              baseURL: 'http://localhost:3071',
              trustedOrigins: [],
              emails: capturingEmailSender,
              requireEmailVerification: false,
              runBackground: (promise) => {
                void promise.catch(() => undefined)
              }
            }))
          )
        )
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process and the fetch stub
afterAll(() => {
  globalThis.fetch = realFetch
  return testD1.dispose()
})

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

/** A real session cookie for the connection-registering owner. */
function signUpSession(email: string) {
  return Effect.gen(function* () {
    const auth = yield* Auth.Tag
    const { headers, response } = yield* Effect.promise(() =>
      auth.instance.api.signUpEmail({
        body: { email, name: email, password: 'correct-horse-battery-staple' },
        returnHeaders: true
      })
    )
    const setCookies = headers.getSetCookie()
    if (setCookies.length === 0) {
      return yield* Effect.die(`sign-up set no cookie for ${email}`)
    }
    const cookieHeader = setCookies.map((cookie) => cookie.split(';')[0]).join('; ')
    return { headers: new Headers({ cookie: cookieHeader }), userId: response.user.id }
  })
}

describe('workspace SSO over the sso plugin', () => {
  it('round-trips a mocked OIDC connection and provisions the member with the connection’s role', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag

        // The owner registers the connection against their workspace.
        const owner = yield* signUpSession('owner@roundtrip.test')
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Roundtrip Co', slug: 'roundtrip', userId: owner.userId }
        })
        const registered = yield* auth.api.registerSSOProvider({
          body: {
            providerId: PROVIDER_ID,
            issuer: ISSUER,
            domain: 'roundtrip.test',
            organizationId: workspace.id,
            oidcConfig: {
              clientId: 'rt-client',
              clientSecret: 'rt-secret',
              pkce: false,
              skipDiscovery: true,
              authorizationEndpoint: `${ISSUER}/authorize`,
              tokenEndpoint: `${ISSUER}/token`,
              jwksEndpoint: `${ISSUER}/jwks`,
              userInfoEndpoint: `${ISSUER}/userinfo`
            },
            enabled: true,
            defaultWorkspaceRole: 'admin'
          },
          headers: owner.headers
        })
        expect(registered.providerId).toBe(PROVIDER_ID)

        // Domain routing: the email resolves to the connection and the plugin
        // answers with the authorization redirect. The response also sets the
        // signed state cookie the callback re-checks, so it is threaded
        // through like a browser would.
        const signIn = yield* Effect.promise(() =>
          auth.instance.api.signInSSO({
            body: {
              email: 'provisioned@roundtrip.test',
              callbackURL: 'http://localhost:3071/workspaces'
            },
            returnHeaders: true
          })
        )
        expect(signIn.response.redirect).toBe(true)
        const authorizationUrl = new URL(signIn.response.url)
        expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
          `${ISSUER}/authorize`
        )
        const state = authorizationUrl.searchParams.get('state')
        expect(state).toBeTruthy()
        const stateCookie = signIn.headers
          .getSetCookie()
          .map((cookie) => cookie.split(';')[0])
          .join('; ')

        // The IdP redirects back with a code; the stubbed token endpoint
        // answers with a signed ID token, the JWKS endpoint with the key.
        const callback = yield* Effect.promise(() =>
          auth.instance.api.callbackSSO({
            params: { providerId: PROVIDER_ID },
            query: { state: state ?? '', code: 'rt-auth-code' },
            headers: new Headers({ cookie: stateCookie }),
            asResponse: true
          })
        )
        expect(callback.status).toBeGreaterThanOrEqual(300)
        expect(callback.status).toBeLessThan(400)
        // The session cookie is the proof of a completed sign-in.
        expect(callback.headers.getSetCookie().length).toBeGreaterThan(0)

        // Provisioning: the user was created…
        const users = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, 'provisioned@roundtrip.test'))
        )
        expect(users).toHaveLength(1)
        const provisioned = users[0]
        // …linked to the IdP account…
        const accounts = yield* Effect.promise(() =>
          db.select().from(account).where(eq(account.providerId, PROVIDER_ID))
        )
        expect(accounts).toHaveLength(1)
        expect(accounts[0]?.userId).toBe(provisioned?.id)
        // …and added to the workspace with the connection's default role.
        const members: Array<typeof workspaceMembers.$inferSelect> =
          yield* Effect.promise(() =>
            db
              .select()
              .from(workspaceMembers)
              .where(eq(workspaceMembers.workspaceId, workspace.id))
          )
        const provisionedMember = members.find(
          (member) => member.userId === provisioned?.id
        )
        expect(provisionedMember?.role).toBe('admin')

        // The plugin's own list is sanitized: the secret never leaves the row,
        // the client id's tail does.
        const providers = yield* auth.api.listSSOProviders({
          headers: owner.headers
        })
        const serialized = JSON.stringify(providers)
        expect(serialized).not.toContain('rt-secret')
        expect(serialized).toContain('rt-client'.slice(-4))
        expect(serialized).not.toContain('rt-client')
      })
    ))

  it('provisions `member` when the stored default role is not a provisioned role', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const owner = yield* signUpSession('owner2@roundtrip.test')
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Fallback Co', slug: 'fallback', userId: owner.userId }
        })
        // `owner` is NOT a provisioned role: written raw (the plugin types
        // additional fields as plain strings), the read must narrow it back.
        yield* auth.api.registerSSOProvider({
          body: {
            providerId: 'rt_fallback',
            issuer: ISSUER,
            domain: 'fallback.test',
            organizationId: workspace.id,
            oidcConfig: {
              clientId: 'rt-client',
              clientSecret: 'rt-secret',
              pkce: false,
              skipDiscovery: true,
              authorizationEndpoint: `${ISSUER}/authorize`,
              tokenEndpoint: `${ISSUER}/token`,
              jwksEndpoint: `${ISSUER}/jwks`,
              userInfoEndpoint: `${ISSUER}/userinfo`
            },
            enabled: true,
            defaultWorkspaceRole: 'owner'
          },
          headers: owner.headers
        })

        idTokenSubject = 'idp-user-2'
        idTokenEmail = 'fallback@fallback.test'
        idTokenName = 'Fallback Member'
        const signIn = yield* Effect.promise(() =>
          auth.instance.api.signInSSO({
            body: {
              email: 'fallback@fallback.test',
              callbackURL: 'http://localhost:3071/workspaces'
            },
            returnHeaders: true
          })
        )
        const state = new URL(signIn.response.url).searchParams.get('state')
        const stateCookie = signIn.headers
          .getSetCookie()
          .map((cookie) => cookie.split(';')[0])
          .join('; ')
        yield* Effect.promise(() =>
          auth.instance.api.callbackSSO({
            params: { providerId: 'rt_fallback' },
            query: { state: state ?? '', code: 'rt-auth-code-2' },
            headers: new Headers({ cookie: stateCookie }),
            asResponse: true
          })
        )

        const users = yield* Effect.promise(() =>
          db.select().from(user).where(eq(user.email, 'fallback@fallback.test'))
        )
        expect(users).toHaveLength(1)
        const members: Array<typeof workspaceMembers.$inferSelect> =
          yield* Effect.promise(() =>
            db
              .select()
              .from(workspaceMembers)
              .where(eq(workspaceMembers.workspaceId, workspace.id))
          )
        const member = members.find((row) => row.userId === users[0]?.id)
        // Never `owner`: the guard narrows the raw value back to `member`.
        expect(member?.role).toBe('member')
      })
    ))
})
