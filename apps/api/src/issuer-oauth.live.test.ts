import { eq } from 'drizzle-orm'
import {
  MCP_CONSENT_CLAIM,
  MCP_SESSION_ID_CLAIM,
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM
} from '@b2b-saas-starter/authz/mcp-access-token'
import { testMcpConfig } from '../../../packages/auth/src/test-mcp.ts'
import { type DrizzleDatabase } from '../../../packages/auth/src/ports.ts'
import {
  assistantSessionAuthority,
  session,
  oauthClient,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken
} from '@b2b-saas-starter/db/schema'
import { DateTime, Effect, type Layer, Schema } from 'effect'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { makeAssistantOAuthTokenVerifier } from './assistant-oauth-access-token.ts'
import { makeOAuthTokenVerifier } from './oauth-access-token.ts'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import {
  Auth,
  MCP_CONSENT_PAGE,
  MCP_WORKSPACE_SELECTED_HEADER
} from '../../../packages/auth/src/index.ts'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession,
  cookieHeader,
  cookiePairs,
  type AuthService,
  type ProvisionedAuthD1
} from '../../../packages/auth/src/test-auth-layer.ts'

// Drive the real issuer's discovery, workspace consent, code/PKCE and refresh flow.
// Both resource servers must accept their own tokens and reject the other resource's.

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>
const invalidatedUsers: Array<string> = []
const decodeJwks = Schema.decodeUnknownSync(
  Schema.Struct({
    keys: Schema.Array(
      Schema.Struct({
        kty: Schema.String,
        crv: Schema.String,
        x: Schema.String,
        kid: Schema.optionalKey(Schema.String),
        alg: Schema.optionalKey(Schema.String)
      })
    )
  })
)
const decodeMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    issuer: Schema.String,
    authorization_endpoint: Schema.String,
    jwks_uri: Schema.String,
    code_challenge_methods_supported: Schema.Array(Schema.String),
    client_id_metadata_document_supported: Schema.Boolean
  })
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- the hook is the port: layer() suites expose no live tester for a real-clock suite, and a memoized fixture could not dispose its workerd process
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        authLayer = buildAuthLayer(db, {
          mcp: {
            ...testMcpConfig(),
            fetchClientMetadataResource: (input) =>
              Promise.resolve(
                Response.json({
                  client_id: new Request(input).url,
                  client_name: 'OAuth integration client',
                  redirect_uris: ['http://127.0.0.1:33418/oauth/callback'],
                  token_endpoint_auth_method: 'none',
                  grant_types: ['authorization_code', 'refresh_token'],
                  response_types: ['code'],
                  scope:
                    'openid offline_access mcp:read mcp:write assistant:read assistant:write'
                })
              )
          },
          invalidateAssistantAuthority: (input) => {
            invalidatedUsers.push(input.userId)
            return Promise.resolve()
          }
        })
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.provide(effect, authLayer)
}

describe('mcp oauth authorization server', () => {
  const REDIRECT_URI = 'http://127.0.0.1:33418/oauth/callback'

  /**
   * The provider's re-entry endpoints (`oauth2/continue`, `oauth2/consent`)
   * answered through the instance handler — the same Request shape the web
   * app's consent page forwards — resolved to wherever the provider points
   * next, whether that arrives as a 302 or a JSON `{ url }` body.
   */
  function postForRedirect(
    auth: {
      readonly instance: { readonly handler: (request: Request) => Promise<Response> }
    },
    path: string,
    headers: Headers,
    body: Record<string, unknown>
  ) {
    const requestHeaders = new Headers(headers)
    requestHeaders.set('content-type', 'application/json')
    return Effect.flatMap(
      Effect.promise(() =>
        auth.instance.handler(
          new Request(`http://localhost:3071/api/auth${path}`, {
            method: 'POST',
            headers: requestHeaders,
            // oxlint-disable-next-line effect/noGlobals -- the auth handler's own JSON wire format is the thing under test here
            body: JSON.stringify(body)
          })
        )
      ),
      redirectTarget
    )
  }

  /**
   * RFC 7636: the verifier stays with the client, the S256 challenge goes in
   * the request. The challenge is `BASE64URL(SHA256(verifier))` — a fixed
   * pair, so the test carries no hashing code; recompute it if you change the
   * verifier.
   */
  function pkce() {
    const verifier = 'live-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz'
    const challenge = 'UZniAYhXZU8-4e7438nGpsqTBRg7vbGm2_jWHK56vvQ'
    return { verifier, challenge }
  }

  const RedirectBody = Schema.Struct({ url: Schema.String })
  const decodeRedirectBody = Schema.decodeUnknownSync(RedirectBody)

  /** The location a redirecting endpoint answered with, whether as a 302 or a JSON `{ url }`. */
  function redirectTarget(response: Response) {
    return Effect.gen(function* () {
      const location = response.headers.get('location')
      if (location !== null) {
        return new URL(location, 'http://localhost:3071')
      }
      const body = decodeRedirectBody(yield* Effect.promise(() => response.json()))
      return new URL(body.url, 'http://localhost:3071')
    })
  }

  it.live(
    'serves discovery: the JWKS and the RFC 8414 metadata at the issuer-inserted path',
    () =>
      run(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const jwks = yield* Effect.promise(() =>
            auth.instance.handler(new Request('http://localhost:3071/api/auth/jwks'))
          )
          expect(jwks.status).toBe(200)
          const keys = decodeJwks(yield* Effect.promise(() => jwks.json()))
          expect(Array.isArray(keys.keys) && keys.keys.length > 0).toBe(true)

          // The request arrives at the origin root, outside `/api/auth/*` — the
          // web app forwards it (`routes/[.]well-known.oauth-authorization-server.$.ts`).
          const metadata = yield* Effect.promise(() =>
            auth.instance.handler(
              new Request(
                'http://localhost:3071/.well-known/oauth-authorization-server/api/auth'
              )
            )
          )
          expect(metadata.status).toBe(200)
          const document = decodeMetadata(yield* Effect.promise(() => metadata.json()))
          expect(document.issuer).toBe('http://localhost:3071/api/auth')
          expect(document.authorization_endpoint).toBe(
            'http://localhost:3071/api/auth/oauth2/authorize'
          )
          expect(document.jwks_uri).toBe('http://localhost:3071/api/auth/jwks')
          expect(document.code_challenge_methods_supported).toContain('S256')
          expect(document.client_id_metadata_document_supported).toBe(true)
        })
      )
  )

  for (const scenario of [
    { name: 'mcp', resource: 'mcp', expireSession: false },
    { name: 'assistant', resource: 'assistant', expireSession: false },
    { name: 'assistant-expiry', resource: 'assistant', expireSession: true }
  ]) {
    const resourceName = scenario.name
    const resource = `http://localhost:8787/${scenario.resource}`
    let otherResource = 'http://localhost:8787/mcp'
    if (scenario.resource === 'mcp') {
      otherResource = 'http://localhost:8787/assistant'
    }
    const clientId = `https://${resourceName}-client.live.test/oauth/client-metadata.json`
    const readScope = `${scenario.resource}:read`
    const writeScope = `${scenario.resource}:write`
    const scopes = `openid offline_access ${readScope} ${writeScope}`
    it.live(
      `issues and refreshes a ${resourceName} token after explicit resource consent`,
      // oxlint-disable-next-line eslint/no-loop-func -- test callbacks share the suite-owned D1 lifecycle; each resource has block-scoped constants
      () =>
        run(
          Effect.gen(function* () {
            const auth = yield* Auth.Tag
            const { headers, userId } = yield* signUpSession(
              `member@${resourceName}.test`
            )
            const workspace = yield* auth.api.createOrganization({
              body: { name: `${resourceName} Co`, slug: `${resourceName}-co` },
              headers
            })
            // The issuer must discover and register this previously unknown
            // metadata client itself, including its resource eligibility.
            const existingClients = yield* Effect.promise(() =>
              db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId))
            )
            expect(existingClients).toHaveLength(0)
            const { verifier, challenge } = pkce()

            // 1. The client sends the browser to /oauth2/authorize. Signed in, with
            //    no workspace vouched for, the provider's post-login hop sends it to
            //    the consent page carrying the signed request.
            const authorize = new URL('http://localhost:3071/api/auth/oauth2/authorize')
            authorize.searchParams.set('client_id', clientId)
            authorize.searchParams.set('redirect_uri', REDIRECT_URI)
            authorize.searchParams.set('response_type', 'code')
            authorize.searchParams.set('scope', scopes)
            authorize.searchParams.set('state', 'xyz')
            authorize.searchParams.set('code_challenge', challenge)
            authorize.searchParams.set('code_challenge_method', 'S256')
            authorize.searchParams.set('resource', resource)
            const toConsent = yield* redirectTarget(
              yield* Effect.promise(() =>
                auth.instance.handler(new Request(authorize, { headers }))
              )
            )
            expect(toConsent.pathname).toBe(MCP_CONSENT_PAGE)
            expect(toConsent.searchParams.get('client_id')).toBe(clientId)
            expect(toConsent.searchParams.has('sig')).toBe(true)

            // 2. The consent server function: pick the workspace, then resume the
            //    authorization vouching for the pick.
            yield* auth.api.setActiveOrganization({
              body: { organizationId: workspace.id },
              headers
            })
            const vouching = new Headers(headers)
            vouching.set(MCP_WORKSPACE_SELECTED_HEADER, workspace.id)
            const continued = yield* postForRedirect(
              auth,
              '/oauth2/continue',
              vouching,
              {
                postLogin: true,
                oauth_query: toConsent.search.slice(1)
              }
            )
            // No standing consent yet: back to the consent page, this time as the
            // consent hop (the provider marks the pick as cleared for this session).
            expect(continued.pathname).toBe(MCP_CONSENT_PAGE)
            expect(continued.searchParams.has('ba_pl')).toBe(true)

            // 3. Accept — the code is issued to the client's redirect URI.
            const callback = yield* postForRedirect(auth, '/oauth2/consent', headers, {
              accept: true,
              oauth_query: continued.search.slice(1)
            })
            expect(callback.origin + callback.pathname).toBe(REDIRECT_URI)
            expect(callback.searchParams.get('state')).toBe('xyz')
            const code = callback.searchParams.get('code')
            expect(code).not.toBeNull()

            const [savedConsent] = yield* Effect.promise(() =>
              db
                .select({ resources: oauthConsent.resources })
                .from(oauthConsent)
                .where(eq(oauthConsent.userId, userId))
            )
            expect(Array.isArray(savedConsent?.resources)).toBe(true)
            // 4. The client exchanges the code.
            const tokenResponse = yield* Effect.promise(() =>
              auth.instance.handler(
                new Request('http://localhost:3071/api/auth/oauth2/token', {
                  method: 'POST',
                  headers: { 'content-type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code ?? '',
                    redirect_uri: REDIRECT_URI,
                    client_id: clientId,
                    code_verifier: verifier,
                    resource
                  })
                })
              )
            )
            expect(tokenResponse.status).toBe(200)
            const resourceLinks = yield* Effect.promise(() =>
              db
                .select()
                .from(oauthClientResource)
                .where(eq(oauthClientResource.clientId, clientId))
            )
            expect(resourceLinks.map((link) => link.resourceId)).toContain(resource)
            const TokenPair = Schema.Struct({
              access_token: Schema.String,
              refresh_token: Schema.String
            })
            const decodeTokenPair = Schema.decodeUnknownSync(TokenPair)
            const tokens = decodeTokenPair(
              yield* Effect.promise(() => tokenResponse.json())
            )
            expect(tokens.access_token.length).toBeGreaterThan(0)
            expect(tokens.refresh_token.length).toBeGreaterThan(0)

            // 5. The access token verifies against the published JWKS and names
            //    the picked workspace — the claims the API worker acts on.
            const jwksResponse = yield* Effect.promise(() =>
              auth.instance.handler(new Request('http://localhost:3071/api/auth/jwks'))
            )
            const publicKeys = decodeJwks(
              yield* Effect.promise(() => jwksResponse.json())
            )
            const keySet = createLocalJWKSet({ keys: [...publicKeys.keys] })
            const issuerConfig = {
              issuer: 'http://localhost:3071/api/auth',
              audience: resource
            }
            function verifyResource(token: string, selectedResource: string) {
              const config = { ...issuerConfig, audience: selectedResource }
              if (selectedResource.endsWith('/assistant')) {
                return makeAssistantOAuthTokenVerifier(config, keySet)
                  .verify(token)
                  .pipe(Effect.map((principal) => principal.userId))
              }
              return makeOAuthTokenVerifier(config, keySet)
                .verify(token)
                .pipe(Effect.map((principal) => principal.userId))
            }
            expect(
              yield* verifyResource(tokens.access_token, resource).pipe(Effect.scoped)
            ).toBe(userId)
            expect(
              (yield* verifyResource(tokens.access_token, otherResource).pipe(
                Effect.result,
                Effect.scoped
              ))._tag
            ).toBe('Failure')
            const { payload } = yield* Effect.promise(() =>
              jwtVerify(tokens.access_token, keySet, {
                issuer: 'http://localhost:3071/api/auth',
                audience: resource
              })
            )
            const crossAudience = yield* Effect.exit(
              Effect.tryPromise(() =>
                jwtVerify(tokens.access_token, keySet, {
                  issuer: 'http://localhost:3071/api/auth',
                  audience: otherResource
                })
              )
            )
            expect(crossAudience._tag).toBe('Failure')
            expect(payload.sub).toBe(userId)
            expect(payload.scope).toBe(scopes)
            expect(payload[MCP_WORKSPACE_ID_CLAIM]).toBe(workspace.id)
            expect(payload[MCP_WORKSPACE_SLUG_CLAIM]).toBe(`${resourceName}-co`)
            expect(payload[MCP_WORKSPACE_ROLE_CLAIM]).toBe('owner')
            expect(payload[MCP_CONSENT_CLAIM]).toEqual(expect.stringMatching(/:0$/))
            const issuing = yield* auth.api.getSession({ headers })
            expect(payload[MCP_SESSION_ID_CLAIM]).toBe(issuing?.session.id)
            if (scenario.expireSession) {
              if (!issuing) {
                return yield* Effect.die('Expected issuing session')
              }
              const expiredAt = DateTime.toDate(
                DateTime.subtract(yield* DateTime.now, { seconds: 1 })
              )
              yield* Effect.promise(() =>
                db
                  .update(session)
                  .set({ expiresAt: expiredAt })
                  .where(eq(session.id, issuing.session.id))
              )
              expect(yield* auth.api.getSession({ headers })).toBe(null)
              const [retainedRefresh] = yield* Effect.promise(() =>
                db
                  .select()
                  .from(oauthRefreshToken)
                  .where(eq(oauthRefreshToken.userId, userId))
              )
              expect(retainedRefresh?.sessionId).toBe(issuing.session.id)
            }
            const refreshResponse = yield* Effect.promise(() =>
              auth.instance.handler(
                new Request('http://localhost:3071/api/auth/oauth2/token', {
                  method: 'POST',
                  headers: { 'content-type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: tokens.refresh_token,
                    client_id: clientId,
                    resource
                  })
                })
              )
            )
            expect(refreshResponse.status).toBe(200)
            const refreshed = decodeTokenPair(
              yield* Effect.promise(() => refreshResponse.json())
            )
            expect(
              yield* verifyResource(refreshed.access_token, resource).pipe(
                Effect.scoped
              )
            ).toBe(userId)
            expect(
              (yield* verifyResource(refreshed.access_token, otherResource).pipe(
                Effect.result,
                Effect.scoped
              ))._tag
            ).toBe('Failure')
            const verifiedRefresh = yield* Effect.promise(() =>
              jwtVerify(refreshed.access_token, keySet, {
                issuer: 'http://localhost:3071/api/auth',
                audience: resource
              })
            )
            expect(verifiedRefresh.payload[MCP_SESSION_ID_CLAIM]).toBe(
              issuing?.session.id
            )

            if (scenario.expireSession) {
              const signedIn = yield* auth.full.signInEmail({
                body: {
                  email: `member@${resourceName}.test`,
                  password: 'correct-horse-battery-staple'
                }
              })
              yield* auth.api.revokeOtherSessions({
                headers: new Headers({
                  cookie: cookieHeader(cookiePairs(signedIn.headers))
                })
              })
              const denied = yield* Effect.promise(() =>
                auth.instance.handler(
                  new Request('http://localhost:3071/api/auth/oauth2/token', {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                      grant_type: 'refresh_token',
                      refresh_token: decodeTokenPair(refreshed).refresh_token,
                      client_id: clientId,
                      resource
                    })
                  })
                )
              )
              expect(denied.status).toBeGreaterThanOrEqual(400)
              const [retained] = yield* Effect.promise(() =>
                db
                  .select()
                  .from(assistantSessionAuthority)
                  .where(
                    eq(
                      assistantSessionAuthority.sessionId,
                      String(payload[MCP_SESSION_ID_CLAIM])
                    )
                  )
              )
              expect(retained?.revokedAt).not.toBe(null)
              return
            }

            // The consent row carries the workspace as its reference, so a consent
            // for this workspace is no consent for another.
            const consents = yield* auth.api.getOAuthConsents({ headers })
            expect(consents.map((consent) => consent.referenceId)).toEqual([
              workspace.id
            ])
            yield* Effect.promise(() =>
              db
                .update(oauthConsent)
                .set({ resources: [] })
                .where(eq(oauthConsent.userId, userId))
            )
            const [removedResource] = yield* Effect.promise(() =>
              db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId))
            )
            expect(`${removedResource?.id}:${removedResource?.grantVersion}`).not.toBe(
              payload[MCP_CONSENT_CLAIM]
            )
            const deniedRefresh = yield* Effect.promise(() =>
              auth.instance.handler(
                new Request('http://localhost:3071/api/auth/oauth2/token', {
                  method: 'POST',
                  headers: { 'content-type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: decodeTokenPair(refreshed).refresh_token,
                    client_id: clientId,
                    resource
                  })
                })
              )
            )
            expect(deniedRefresh.status).toBeGreaterThanOrEqual(400)
            yield* Effect.promise(() =>
              db
                .update(oauthConsent)
                .set({ resources: [resource] })
                .where(eq(oauthConsent.userId, userId))
            )
            const [restoredResource] = yield* Effect.promise(() =>
              db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId))
            )
            expect(
              `${restoredResource?.id}:${restoredResource?.grantVersion}`
            ).not.toBe(payload[MCP_CONSENT_CLAIM])
          })
        )
    )
  }

  it.live(
    'retains natural session expiry and records later revoke-all without a live session row',
    () =>
      run(
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const signup = yield* signUpSession('expiry@assistant.test')
          const current = yield* auth.api.getSession({ headers: signup.headers })
          if (!current) {
            return yield* Effect.die('Expected real session')
          }
          const expiredAt = DateTime.toDate(
            DateTime.subtract(yield* DateTime.now, { seconds: 1 })
          )
          yield* Effect.promise(() =>
            db
              .update(session)
              .set({ expiresAt: expiredAt })
              .where(eq(session.id, current.session.id))
          )
          expect(yield* auth.api.getSession({ headers: signup.headers })).toBe(null)
          const [retained] = yield* Effect.promise(() =>
            db
              .select()
              .from(assistantSessionAuthority)
              .where(eq(assistantSessionAuthority.sessionId, current.session.id))
          )
          expect(retained?.revokedAt).toBe(null)
          const signedIn = yield* auth.full.signInEmail({
            body: {
              email: 'expiry@assistant.test',
              password: 'correct-horse-battery-staple'
            }
          })
          yield* auth.api.revokeOtherSessions({
            headers: new Headers({
              cookie: cookieHeader(cookiePairs(signedIn.headers))
            })
          })
          const [revoked] = yield* Effect.promise(() =>
            db
              .select()
              .from(assistantSessionAuthority)
              .where(eq(assistantSessionAuthority.sessionId, current.session.id))
          )
          expect(revoked?.revokedAt).not.toBe(null)
        })
      )
  )

  it.live('records explicit sign-out before deleting the real session', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const signup = yield* signUpSession('signout@assistant.test')
        const current = yield* auth.api.getSession({ headers: signup.headers })
        if (!current) {
          return yield* Effect.die('Expected real session')
        }
        invalidatedUsers.length = 0
        yield* auth.api.signOut({ headers: signup.headers })
        expect(invalidatedUsers).toContain(current.user.id)
        const [retained] = yield* Effect.promise(() =>
          db
            .select()
            .from(assistantSessionAuthority)
            .where(eq(assistantSessionAuthority.sessionId, current.session.id))
        )
        expect(retained?.revokedAt).not.toBe(null)
      })
    )
  )

  it.live('refuses to authorize without a workspace pick', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const { headers } = yield* signUpSession('nopick@mcp.test')
        yield* Effect.promise(() =>
          db
            .insert(oauthClient)
            .values({
              id: 'oac_live_nopick',
              clientId: 'https://nopick.live.test/client.json',
              redirectUris: [REDIRECT_URI],
              tokenEndpointAuthMethod: 'none',
              scopes: ['openid', 'mcp:read']
            })
            .run()
        )
        const { challenge } = pkce()
        const authorize = new URL('http://localhost:3071/api/auth/oauth2/authorize')
        authorize.searchParams.set('client_id', 'https://nopick.live.test/client.json')
        authorize.searchParams.set('redirect_uri', REDIRECT_URI)
        authorize.searchParams.set('response_type', 'code')
        authorize.searchParams.set('scope', 'openid mcp:read')
        authorize.searchParams.set('code_challenge', challenge)
        authorize.searchParams.set('code_challenge_method', 'S256')
        const toConsent = yield* redirectTarget(
          yield* Effect.promise(() =>
            auth.instance.handler(new Request(authorize, { headers }))
          )
        )
        // Vouching for a workspace that is not on the session is not a pick:
        // the provider sends the browser back to the consent page.
        const vouching = new Headers(headers)
        vouching.set(MCP_WORKSPACE_SELECTED_HEADER, 'wrk_never_picked')
        const continued = yield* postForRedirect(auth, '/oauth2/continue', vouching, {
          postLogin: true,
          oauth_query: toConsent.search.slice(1)
        })
        expect(continued.pathname).toBe(MCP_CONSENT_PAGE)
        expect(continued.searchParams.has('ba_pl')).toBe(false)
      })
    )
  )
})
