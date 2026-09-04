import {
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM
} from '@b2b-saas-starter/authz/mcp-access-token'
import { type DrizzleDatabase } from '@b2b-saas-starter/db/client'
import { oauthClient, oauthClientResource } from '@b2b-saas-starter/db/schema'
import { Effect, type Layer, Schema } from 'effect'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { Auth, MCP_CONSENT_PAGE, MCP_WORKSPACE_SELECTED_HEADER } from './index.ts'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession,
  type AuthService,
  type ProvisionedAuthD1
} from './test-auth-layer.ts'

// Social sign-in aside, the OAuth server this package runs is the MCP
// authorization server (ADR 0068), and it is only observable the way an MCP
// client drives it: discovery, then the authorization code flow with PKCE,
// with the starter's two hops in the middle — the consent page picks a
// workspace and vouches for the pick on `oauth2/continue`, then accepts on
// `oauth2/consent`. The access token that comes out must verify against
// `/api/auth/jwks` and carry the workspace claims the API worker maps onto
// its `WorkspaceContext`.

let db: DrizzleDatabase
let provisioned: ProvisionedAuthD1
let authLayer: Layer.Layer<AuthService>

// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        provisioned = yield* Effect.promise(() => provisionAuthD1())
        db = provisioned.db
        authLayer = buildAuthLayer(db)
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => provisioned.dispose())

function run<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(Effect.provide(effect, authLayer))
}

describe('mcp oauth authorization server', () => {
  const CLIENT_ID = 'https://mcp-client.live.test/oauth/client-metadata.json'
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

  it('serves discovery: the JWKS and the RFC 8414 metadata at the issuer-inserted path', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const jwks = yield* Effect.promise(() =>
          auth.instance.handler(new Request('http://localhost:3071/api/auth/jwks'))
        )
        expect(jwks.status).toBe(200)
        const keys = yield* Effect.promise(() => jwks.json())
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
        const document = yield* Effect.promise(() => metadata.json())
        expect(document.issuer).toBe('http://localhost:3071/api/auth')
        expect(document.authorization_endpoint).toBe(
          'http://localhost:3071/api/auth/oauth2/authorize'
        )
        expect(document.jwks_uri).toBe('http://localhost:3071/api/auth/jwks')
        expect(document.code_challenge_methods_supported).toContain('S256')
        expect(document.client_id_metadata_document_supported).toBe(true)
      })
    ))

  it('issues a workspace-bound access token after the consent page picks a workspace', () =>
    run(
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const { headers, userId } = yield* signUpSession('member@mcp.test')
        const workspace = yield* auth.api.createOrganization({
          body: { name: 'MCP Co', slug: 'mcp-co' },
          headers
        })
        // A CIMD client, as the plugin would have registered it on discovery:
        // registration links the client to the MCP resource it asked for.
        yield* Effect.promise(() =>
          db
            .insert(oauthClient)
            .values({
              id: 'oac_live_mcp',
              clientId: CLIENT_ID,
              name: 'Live MCP client',
              redirectUris: [REDIRECT_URI],
              tokenEndpointAuthMethod: 'none',
              grantTypes: ['authorization_code', 'refresh_token'],
              responseTypes: ['code'],
              scopes: ['openid', 'offline_access', 'mcp:read'],
              requirePKCE: true
            })
            .run()
        )
        yield* Effect.promise(() =>
          db
            .insert(oauthClientResource)
            .values({
              id: 'ocr_live_mcp',
              clientId: CLIENT_ID,
              resourceId: 'http://localhost:8787/mcp'
            })
            .run()
        )
        const { verifier, challenge } = pkce()

        // 1. The client sends the browser to /oauth2/authorize. Signed in, with
        //    no workspace vouched for, the provider's post-login hop sends it to
        //    the consent page carrying the signed request.
        const authorize = new URL('http://localhost:3071/api/auth/oauth2/authorize')
        authorize.searchParams.set('client_id', CLIENT_ID)
        authorize.searchParams.set('redirect_uri', REDIRECT_URI)
        authorize.searchParams.set('response_type', 'code')
        authorize.searchParams.set('scope', 'openid offline_access mcp:read')
        authorize.searchParams.set('state', 'xyz')
        authorize.searchParams.set('code_challenge', challenge)
        authorize.searchParams.set('code_challenge_method', 'S256')
        authorize.searchParams.set('resource', 'http://localhost:8787/mcp')
        const toConsent = yield* redirectTarget(
          yield* Effect.promise(() =>
            auth.instance.handler(new Request(authorize, { headers }))
          )
        )
        expect(toConsent.pathname).toBe(MCP_CONSENT_PAGE)
        expect(toConsent.searchParams.get('client_id')).toBe(CLIENT_ID)
        expect(toConsent.searchParams.has('sig')).toBe(true)

        // 2. The consent server function: pick the workspace, then resume the
        //    authorization vouching for the pick.
        yield* auth.api.setActiveOrganization({
          body: { organizationId: workspace.id },
          headers
        })
        const vouching = new Headers(headers)
        vouching.set(MCP_WORKSPACE_SELECTED_HEADER, workspace.id)
        const continued = yield* postForRedirect(auth, '/oauth2/continue', vouching, {
          postLogin: true,
          oauth_query: toConsent.search.slice(1)
        })
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
                client_id: CLIENT_ID,
                code_verifier: verifier,
                resource: 'http://localhost:8787/mcp'
              })
            })
          )
        )
        expect(tokenResponse.status).toBe(200)
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
        const keySet = createLocalJWKSet(
          yield* Effect.promise(() => jwksResponse.json())
        )
        const { payload } = yield* Effect.promise(() =>
          jwtVerify(tokens.access_token, keySet, {
            issuer: 'http://localhost:3071/api/auth',
            audience: 'http://localhost:8787/mcp'
          })
        )
        expect(payload.sub).toBe(userId)
        expect(payload.scope).toBe('openid offline_access mcp:read')
        expect(payload[MCP_WORKSPACE_ID_CLAIM]).toBe(workspace.id)
        expect(payload[MCP_WORKSPACE_SLUG_CLAIM]).toBe('mcp-co')
        expect(payload[MCP_WORKSPACE_ROLE_CLAIM]).toBe('owner')

        // The consent row carries the workspace as its reference, so a consent
        // for this workspace is no consent for another.
        const consents = yield* auth.api.getOAuthConsents({ headers })
        expect(consents.map((consent) => consent.referenceId)).toEqual([workspace.id])
      })
    ))

  it('refuses to authorize without a workspace pick', () =>
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
    ))
})
