import { type DrizzleDatabase } from './ports.ts'
import {
  account,
  session,
  ssoRecoveryAuthEvidence,
  user,
  workspaceMembers,
  workspaceSsoAuthProofs,
  workspaceSsoConnections,
  workspaceSsoDomainClaims
} from '@b2b-saas-starter/db/schema'
import { Effect, type Layer } from 'effect'
import { cookieHeader, cookiePairs } from 'effectful-better-auth'
import { eq } from 'drizzle-orm'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Auth } from './index.ts'
import {
  buildAuthLayer,
  enableTotp,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'
import { decodeUriSecret } from './test-totp.ts'
import { makeSsoAuthHooks } from '../../../apps/web/src/lib/server/sso-auth-hooks.ts'

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

const PASSWORD = 'correct-horse-battery-staple'

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
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- the hook is the port: layer() suites expose no live tester for a real-clock suite, and a memoized fixture could not dispose its workerd process
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        globalThis.fetch = stubbedFetch
        authLayer = buildAuthLayer(db, {
          ssoHooks: makeSsoAuthHooks(db)
        })
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

function activateConnection(workspaceId: string, providerId: string, domain: string) {
  return Effect.gen(function* () {
    const now = new Date().toISOString()
    yield* Effect.promise(() =>
      db
        .update(workspaceSsoConnections)
        .set({ enabled: true, autoJoin: true, domainVerified: true })
        .where(eq(workspaceSsoConnections.providerId, providerId))
    )
    yield* Effect.promise(() =>
      db.insert(workspaceSsoDomainClaims).values({
        id: `claim_${providerId}`,
        workspaceId,
        domain,
        providerId,
        verificationTokenHash: `hash_${providerId}`,
        status: 'verified',
        verifiedAt: now,
        lastCheckedAt: now,
        createdAt: now,
        updatedAt: now
      })
    )
  })
}

function sessionsForEmail(email: string) {
  return Effect.gen(function* () {
    const [found] = yield* Effect.promise(() =>
      db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
    )
    if (found === undefined) {
      return []
    }
    return yield* Effect.promise(() =>
      db.select().from(session).where(eq(session.userId, found.id))
    )
  })
}

describe('workspace SSO over the sso plugin', () => {
  it.live(
    'round-trips OIDC with one session id in the proof and persisted session',
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
              }
            },
            headers: owner.headers
          })
          expect(registered.providerId).toBe(PROVIDER_ID)
          yield* activateConnection(workspace.id, PROVIDER_ID, 'roundtrip.test')

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
          const proofs = yield* Effect.promise(() =>
            db
              .select()
              .from(workspaceSsoAuthProofs)
              .where(eq(workspaceSsoAuthProofs.userId, provisionedUser?.id ?? ''))
          )
          expect(proofs).toHaveLength(1)
          const proof = proofs[0]
          const persistedSessions = yield* Effect.promise(() =>
            db
              .select({ id: session.id })
              .from(session)
              .where(eq(session.id, proof?.sessionId ?? ''))
          )
          expect(persistedSessions).toEqual([{ id: proof?.sessionId }])
          expect(proof).toMatchObject({
            workspaceId: workspace.id,
            providerId: PROVIDER_ID,
            connectionGeneration: 1
          })
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
          expect(provisionedMember?.role).toBe('member')

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

  it.live('provisions `member` for every provider-bound automatic join', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const owner = yield* signUpSession('owner2@roundtrip.test')
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Fallback Co', slug: 'fallback', userId: owner.userId }
        })
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
            }
          },
          headers: owner.headers
        })
        yield* activateConnection(workspace.id, 'rt_fallback', 'fallback.test')

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
        // Automatic domain provisioning never grants owner or admin.
        expect(member?.role).toBe('member')
      })
    )
  )

  it.live('refuses the callback when the proof write fails', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const owner = yield* signUpSession('owner@proof-failure.test')
        const workspace = yield* auth.api.createOrganization({
          body: {
            name: 'Proof failure Co',
            slug: 'proof-failure',
            userId: owner.userId
          }
        })
        const providerId = 'rt_proof_failure'
        const email = 'member@proof-failure.test'
        yield* auth.api.registerSSOProvider({
          body: {
            providerId,
            issuer: ISSUER,
            domain: 'proof-failure.test',
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
            }
          },
          headers: owner.headers
        })
        yield* activateConnection(workspace.id, providerId, 'proof-failure.test')

        idTokenSubject = 'idp-proof-failure'
        idTokenEmail = email
        idTokenName = 'Proof Failure'
        const signIn = yield* auth.full.signInSSO({
          body: { email, callbackURL: 'http://localhost:3071/workspaces' }
        })
        const state = new URL(signIn.response.url).searchParams.get('state')
        const stateCookie = cookieHeader(cookiePairs(signIn.headers))

        const outcome = yield* Effect.acquireUseRelease(
          Effect.promise(() =>
            provisioned.d1
              .prepare(
                `CREATE TRIGGER refuse_sso_proof BEFORE INSERT ON workspace_sso_auth_proofs WHEN NEW.provider_id = '${providerId}' BEGIN SELECT RAISE(ABORT, 'forced proof refusal'); END`
              )
              .run()
          ),
          () =>
            Effect.promise(() =>
              auth.instance.api
                .callbackSSO({
                  params: { providerId },
                  query: { state: state ?? '', code: 'rt-proof-failure-code' },
                  headers: new Headers({ cookie: stateCookie }),
                  asResponse: true
                })
                .then(
                  (response) =>
                    ({ _tag: 'response', response }) satisfies {
                      readonly _tag: 'response'
                      readonly response: Response
                    },
                  (error: unknown) =>
                    ({ _tag: 'error', error }) satisfies {
                      readonly _tag: 'error'
                      readonly error: unknown
                    }
                )
            ),
          () =>
            Effect.promise(() =>
              provisioned.d1.prepare('DROP TRIGGER refuse_sso_proof').run()
            )
        )

        if (outcome._tag === 'response') {
          const location = outcome.response.headers.get('location') ?? ''
          expect(
            outcome.response.status >= 400 ||
              new URL(location, 'http://localhost:3071').searchParams.has('error')
          ).toBe(true)
          expect(outcome.response.headers.getSetCookie().join(' ')).not.toContain(
            'session_token='
          )
        } else {
          expect(outcome.error).toBeDefined()
        }
        expect(yield* sessionsForEmail(email)).toEqual([])
      })
    )
  )

  it.live('rejects a callback after its connection generation is retired', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const owner = yield* signUpSession('owner@retired-flow.test')
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'Retired Flow Co', slug: 'retired-flow', userId: owner.userId }
        })
        const providerId = 'rt_retired'
        const email = 'member@retired-flow.test'
        yield* auth.api.registerSSOProvider({
          body: {
            providerId,
            issuer: ISSUER,
            domain: 'retired-flow.test',
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
            }
          },
          headers: owner.headers
        })
        yield* activateConnection(workspace.id, providerId, 'retired-flow.test')

        idTokenSubject = 'idp-retired-flow'
        idTokenEmail = email
        idTokenName = 'Retired Flow'
        const signIn = yield* auth.full.signInSSO({
          body: { email, callbackURL: 'http://localhost:3071/workspaces' }
        })
        const state = new URL(signIn.response.url).searchParams.get('state')
        const stateCookie = cookieHeader(cookiePairs(signIn.headers))
        yield* Effect.promise(() =>
          db
            .update(workspaceSsoConnections)
            .set({ connectionGeneration: 2 })
            .where(eq(workspaceSsoConnections.providerId, providerId))
        )

        const callback = yield* Effect.promise(() =>
          auth.instance.api.callbackSSO({
            params: { providerId },
            query: { state: state ?? '', code: 'rt-retired-code' },
            headers: new Headers({ cookie: stateCookie }),
            asResponse: true
          })
        )
        expect(callback.status).toBeGreaterThanOrEqual(300)
        const location = callback.headers.get('location') ?? ''
        expect(new URL(location).searchParams.get('error')).toBe(
          'unable to create session'
        )
        expect(callback.headers.getSetCookie().join(' ')).not.toContain(
          'session_token='
        )
        expect(yield* sessionsForEmail(email)).toEqual([])
      })
    )
  )

  it.live('refuses an outside-domain invitation as identity proof', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const owner = yield* signUpSession('owner@contractor-flow.test')
        const workspace = yield* auth.api.createOrganization({
          body: {
            name: 'Contractor Flow Co',
            slug: 'contractor-flow',
            userId: owner.userId
          }
        })
        const providerId = 'rt_contractor'
        const email = 'contractor@outside-domain.test'
        yield* auth.api.registerSSOProvider({
          body: {
            providerId,
            issuer: ISSUER,
            domain: 'contractor-flow.test',
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
            }
          },
          headers: owner.headers
        })
        yield* auth.api.createInvitation({
          body: { email, role: 'member', organizationId: workspace.id },
          headers: owner.headers
        })
        yield* activateConnection(workspace.id, providerId, 'contractor-flow.test')

        idTokenSubject = 'idp-outside-domain'
        idTokenEmail = email
        idTokenName = 'Outside Domain'
        const signIn = yield* auth.full.signInSSO({
          body: {
            providerId,
            email,
            callbackURL: 'http://localhost:3071/workspaces'
          }
        })
        const state = new URL(signIn.response.url).searchParams.get('state')
        const callback = yield* Effect.promise(() =>
          auth.instance.api.callbackSSO({
            params: { providerId },
            query: { state: state ?? '', code: 'rt-outside-domain-code' },
            headers: new Headers({
              cookie: cookieHeader(cookiePairs(signIn.headers))
            }),
            asResponse: true
          })
        )
        const location = callback.headers.get('location') ?? ''
        expect(new URL(location).searchParams.get('error')).toBe(
          'unable to create session'
        )
        expect(callback.headers.getSetCookie().join(' ')).not.toContain(
          'session_token='
        )
        expect(yield* sessionsForEmail(email)).toEqual([])
        const created = yield* Effect.promise(() =>
          db
            .select({ emailVerified: user.emailVerified })
            .from(user)
            .where(eq(user.email, email))
        )
        expect(created.every((row) => !row.emailVerified)).toBe(true)
      })
    )
  )

  it.live('has no public D1 linking path for a registered SSO provider', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const owner = yield* signUpSession('owner@explicit-link.test')
        const workspace = yield* auth.api.createOrganization({
          body: {
            name: 'Explicit Link Co',
            slug: 'explicit-link',
            userId: owner.userId
          }
        })
        const providerId = 'rt_explicit_link'
        const outsider = yield* signUpSession('existing@outside-link.test')
        yield* Effect.promise(() =>
          db
            .update(user)
            .set({ emailVerified: true })
            .where(eq(user.id, outsider.userId))
        )
        yield* auth.api.registerSSOProvider({
          body: {
            providerId,
            issuer: ISSUER,
            domain: 'explicit-link.test',
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
            }
          },
          headers: owner.headers
        })
        yield* auth.api.createInvitation({
          body: {
            email: 'existing@outside-link.test',
            role: 'member',
            organizationId: workspace.id
          },
          headers: owner.headers
        })
        yield* activateConnection(workspace.id, providerId, 'explicit-link.test')

        const beforeSessions = yield* Effect.promise(() =>
          db
            .select({ id: session.id })
            .from(session)
            .where(eq(session.userId, outsider.userId))
        )
        const linkHeaders = new Headers(outsider.headers)
        linkHeaders.set('content-type', 'application/json')
        const publicLink = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/link-social', {
              method: 'POST',
              headers: linkHeaders,
              body: JSON.stringify({
                provider: providerId,
                callbackURL: 'http://localhost:3071/workspaces'
              })
            })
          )
        )
        expect(publicLink.status).toBe(404)
        expect(yield* Effect.promise(() => publicLink.json())).toMatchObject({
          code: 'PROVIDER_NOT_FOUND'
        })
        expect(
          yield* Effect.promise(() =>
            db.select().from(account).where(eq(account.providerId, providerId))
          )
        ).toEqual([])

        idTokenSubject = 'idp-existing-outsider'
        idTokenEmail = 'existing@outside-link.test'
        idTokenName = 'Existing Outsider'
        const signIn = yield* auth.full.signInSSO({
          body: {
            providerId,
            email: idTokenEmail,
            callbackURL: 'http://localhost:3071/workspaces'
          },
          headers: outsider.headers
        })
        const state = new URL(signIn.response.url).searchParams.get('state')
        const callbackCookies = cookieHeader([
          ...outsider.cookiePairs,
          ...cookiePairs(signIn.headers)
        ])
        const callback = yield* Effect.promise(() =>
          auth.instance.api.callbackSSO({
            params: { providerId },
            query: { state: state ?? '', code: 'rt-explicit-link-code' },
            headers: new Headers({ cookie: callbackCookies }),
            asResponse: true
          })
        )
        const callbackLocation = callback.headers.get('location') ?? ''
        expect(new URL(callbackLocation).searchParams.get('error')).toBe(
          'account not linked'
        )
        expect(
          yield* Effect.promise(() =>
            db.select().from(account).where(eq(account.providerId, providerId))
          )
        ).toEqual([])
        const afterSessions = yield* Effect.promise(() =>
          db
            .select({ id: session.id })
            .from(session)
            .where(eq(session.userId, outsider.userId))
        )
        expect(afterSessions).toEqual(beforeSessions)
      })
    )
  )

  it.live('records password-plus-TOTP recovery evidence for the new session', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const email = 'recovery-evidence@roundtrip.test'
        const enrolled = yield* signUpSession(email)
        const enabled = yield* enableTotp(enrolled)
        const encodedSecret = new URL(enabled.response.totpURI).searchParams.get(
          'secret'
        )
        if (encodedSecret === null) {
          return yield* Effect.die('the TOTP enrollment returned no secret')
        }
        const [enrolledUser] = yield* Effect.promise(() =>
          db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
        )
        expect(enrolledUser).toBeDefined()
        expect(
          yield* Effect.promise(() =>
            db
              .select()
              .from(ssoRecoveryAuthEvidence)
              .where(eq(ssoRecoveryAuthEvidence.userId, enrolledUser?.id ?? ''))
          )
        ).toEqual([])

        const signIn = yield* Effect.promise(() =>
          auth.instance.handler(
            new Request('http://localhost:3071/api/auth/sign-in/email', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, password: PASSWORD })
            })
          )
        )
        const { code } = yield* auth.api.generateTOTP({
          body: { secret: decodeUriSecret(encodedSecret) }
        })
        const verified = yield* auth.full.verifyTOTP({
          body: { code },
          headers: new Headers({ cookie: cookieHeader(cookiePairs(signIn.headers)) })
        })
        expect(verified.response.user.email).toBe(email)

        const evidence = yield* Effect.promise(() =>
          db
            .select()
            .from(ssoRecoveryAuthEvidence)
            .where(eq(ssoRecoveryAuthEvidence.userId, enrolledUser?.id ?? ''))
        )
        expect(evidence).toHaveLength(1)
        expect(evidence[0]).toMatchObject({
          userId: enrolledUser?.id,
          method: 'password_mfa'
        })
        const persisted = yield* Effect.promise(() =>
          db
            .select({ id: session.id })
            .from(session)
            .where(eq(session.id, evidence[0]?.sessionId ?? ''))
        )
        expect(persisted).toEqual([{ id: evidence[0]?.sessionId }])
      })
    )
  )
})
