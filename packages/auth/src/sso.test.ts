import { type DrizzleDatabase } from './ports.ts'
import { account, user, workspaceMembers } from '@b2b-saas-starter/db/schema'
import { Clock, Effect, type Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { cookieHeader, cookiePairs } from 'effectful-better-auth'
import { eq } from 'drizzle-orm'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { decodeJwt, jwtVerify } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Auth } from './index.ts'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

// The `sso` plugin's OIDC flow is only observable end to end against a real
// database AND a real IdP. This suite stands the IdP up as a `globalThis.fetch`
// stub (discovery endpoints, token exchange, JWKS, UserInfo) and drives the
// full round trip — register a workspace connection, resolve it by email
// domain, redirect out, callback in — so provisioning and role assignment are
// asserted against the rows the plugin actually wrote, not a mocked service.

const ISSUER = 'https://idp.roundtrip.test'
const PROVIDER_ID = 'rt_oidc'

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

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

// oxlint-disable effect/noGlobals -- this suite IS the JSON/serialization boundary: a fake IdP, not an app write path
/** Read issuance time for each token, including exchanges after a delayed setup. */
const signIdToken = Effect.fn('Test.signIdToken')(function* (
  claims: Record<string, unknown>
) {
  const issuedAt = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const header = { alg: 'RS256', typ: 'JWT', kid: publicJwk.kid }
  const payload = { iat: issuedAt, exp: issuedAt + 600, ...claims }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey)
  return `${signingInput}.${base64Url(signature)}`
})

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

// The native fetch stub runs the Effect signer with the live clock used by jose.
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
      // oxlint-disable-next-line effect/noAsyncFunction, starter/no-run-promise-in-tests -- the native fetch callback is the boundary into the Effect token signer
      id_token: await Effect.runPromise(
        signIdToken({
          iss: ISSUER,
          aud: 'rt-client',
          sub: idTokenSubject,
          email: idTokenEmail,
          email_verified: true,
          name: idTokenName
        })
      )
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
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- the hook is the port: layer() suites expose no live tester for a real-clock suite, and a memoized fixture could not dispose its workerd process
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        globalThis.fetch = stubbedFetch
        authLayer = buildAuthLayer(db)
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process and the fetch stub
afterAll(() => {
  globalThis.fetch = realFetch
  return provisioned.dispose()
})

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.provide(effect, authLayer)
}

describe('workspace SSO over the sso plugin', () => {
  it.effect('issues a fresh token after an earlier token has expired', () =>
    Effect.gen(function* () {
      const earlier = yield* signIdToken({ sub: 'clock-test' })
      expect(decodeJwt(earlier).exp).toBe(600)

      yield* TestClock.adjust('11 minutes')
      const current = yield* signIdToken({ sub: 'clock-test' })
      const verified = yield* Effect.promise(() =>
        jwtVerify(current, publicKey, { currentDate: new Date(660_000) })
      )
      expect(verified.payload).toMatchObject({
        sub: 'clock-test',
        iat: 660,
        exp: 1260
      })
    })
  )

  it.live(
    'round-trips a mocked OIDC connection and provisions the member with the connection’s role',
    () =>
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
          const signIn = yield* auth.full.signInSSO({
            body: {
              email: 'provisioned@roundtrip.test',
              callbackURL: 'http://localhost:3071/workspaces'
            }
          })
          expect(signIn.response.redirect).toBe(true)
          const authorizationUrl = new URL(signIn.response.url)
          expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
            `${ISSUER}/authorize`
          )
          const state = authorizationUrl.searchParams.get('state')
          expect(state).toBeTruthy()
          const stateCookie = cookieHeader(cookiePairs(signIn.headers))

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
          const provisionedUser = users[0]
          // …linked to the IdP account…
          const accounts = yield* Effect.promise(() =>
            db.select().from(account).where(eq(account.providerId, PROVIDER_ID))
          )
          expect(accounts).toHaveLength(1)
          expect(accounts[0]?.userId).toBe(provisionedUser?.id)
          // …and added to the workspace with the connection's default role.
          const members: Array<typeof workspaceMembers.$inferSelect> =
            yield* Effect.promise(() =>
              db
                .select()
                .from(workspaceMembers)
                .where(eq(workspaceMembers.workspaceId, workspace.id))
            )
          const provisionedMember = members.find(
            (member) => member.userId === provisionedUser?.id
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
      )
  )

  it.live(
    'provisions `member` when the stored default role is not a provisioned role',
    () =>
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
          const signIn = yield* auth.full.signInSSO({
            body: {
              email: 'fallback@fallback.test',
              callbackURL: 'http://localhost:3071/workspaces'
            }
          })
          const state = new URL(signIn.response.url).searchParams.get('state')
          const stateCookie = cookieHeader(cookiePairs(signIn.headers))
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
      )
  )
})
