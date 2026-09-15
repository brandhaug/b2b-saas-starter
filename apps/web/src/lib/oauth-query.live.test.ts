// @vitest-environment node
import { afterAll, beforeAll, expect, it } from '@effect/vitest'
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router'
import { Effect, Schema } from 'effect'
import { Auth, MCP_WORKSPACE_SELECTED_HEADER } from '@b2b-saas-starter/auth'
import {
  buildAuthLayer,
  provisionAuthD1,
  signUpSession,
  type ProvisionedAuthD1
} from '../../../../packages/auth/src/test-auth-layer'
import { signedOAuthQuery } from './oauth-query'

let provisioned: ProvisionedAuthD1
beforeAll(async () => {
  provisioned = await provisionAuthD1()
}, 60_000)
afterAll(() => provisioned.dispose())

const origin = 'http://localhost:3071'
const clientId = 'https://router-client.test/metadata.json'
const redirectUri = 'http://127.0.0.1:33418/oauth/callback'
const resource = 'http://localhost:8787/assistant'
const RedirectBody = Schema.Struct({ url: Schema.String })
const decodeRedirectBody = Schema.decodeUnknownSync(RedirectBody)
const decodeTokenPair = Schema.decodeUnknownSync(
  Schema.Struct({ access_token: Schema.String, refresh_token: Schema.String })
)

function redirectTarget(response: Response) {
  return Effect.gen(function* () {
    const location = response.headers.get('location')
    if (location) {
      return new URL(location, origin)
    }
    const body = decodeRedirectBody(yield* Effect.promise(() => response.json()))
    return new URL(body.url, origin)
  })
}

function routedQuery(url: URL) {
  return signedOAuthQuery(defaultStringifySearch(defaultParseSearch(url.search)))
}

it.live(
  'verifies the issuer signature after router serialization through consent and PKCE exchange',
  () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Tag
      const { headers } = yield* signUpSession('router-member@example.test')
      const workspace = yield* auth.api.createOrganization({
        body: { name: 'Router test', slug: 'router-test' },
        headers
      })
      const authorize = new URL(`${origin}/api/auth/oauth2/authorize`)
      authorize.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid offline_access assistant:read assistant:write',
        state: 'opaque+state/with=encoding',
        code_challenge: 'UZniAYhXZU8-4e7438nGpsqTBRg7vbGm2_jWHK56vvQ',
        code_challenge_method: 'S256',
        resource
      }).toString()
      const consent = yield* redirectTarget(
        yield* Effect.promise(() =>
          auth.instance.handler(new Request(authorize, { headers }))
        )
      )
      expect(consent.pathname).toBe('/oauth/consent')
      expect(consent.searchParams.getAll('ba_param').length).toBeGreaterThan(1)
      const restored = routedQuery(consent)
      expect(restored).not.toBeNull()
      expect(new URLSearchParams(restored ?? '').get('resource')).toBe(resource)
      yield* auth.api.setActiveOrganization({
        body: { organizationId: workspace.id },
        headers
      })
      const vouchedHeaders = new Headers(headers)
      vouchedHeaders.set(MCP_WORKSPACE_SELECTED_HEADER, workspace.id)
      vouchedHeaders.set('content-type', 'application/json')
      function post(
        path: string,
        body: { oauth_query: string | null; postLogin?: boolean; accept?: boolean }
      ) {
        return Effect.flatMap(
          Effect.promise(() =>
            auth.instance.handler(
              new Request(`${origin}/api/auth${path}`, {
                method: 'POST',
                headers: vouchedHeaders,
                body: JSON.stringify(body)
              })
            )
          ),
          redirectTarget
        )
      }
      const continued = yield* post('/oauth2/continue', {
        postLogin: true,
        oauth_query: restored
      })
      expect(continued.pathname).toBe('/oauth/consent')
      const callback = yield* post('/oauth2/consent', {
        accept: true,
        oauth_query: routedQuery(continued)
      })
      expect(callback.origin + callback.pathname).toBe(redirectUri)
      expect(callback.searchParams.get('state')).toBe('opaque+state/with=encoding')
      expect(callback.searchParams.has('code')).toBe(true)
      const token = yield* Effect.promise(() =>
        auth.instance.handler(
          new Request(`${origin}/api/auth/oauth2/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: callback.searchParams.get('code') ?? '',
              client_id: clientId,
              redirect_uri: redirectUri,
              resource,
              code_verifier: 'live-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz'
            })
          })
        )
      )
      expect(token.status).toBe(200)
      const pair = decodeTokenPair(yield* Effect.promise(() => token.json()))
      expect(pair.access_token).toEqual(expect.any(String))
      expect(pair.refresh_token).toEqual(expect.any(String))
    }).pipe(
      Effect.provide(
        buildAuthLayer(provisioned.db, {
          mcp: {
            resource: 'http://localhost:8787/mcp',
            assistantResource: resource,
            fetchClientMetadataResource: () =>
              Promise.resolve(
                Response.json({
                  client_id: clientId,
                  client_name: 'Router integration client',
                  redirect_uris: [redirectUri],
                  token_endpoint_auth_method: 'none',
                  grant_types: ['authorization_code', 'refresh_token'],
                  response_types: ['code'],
                  scope: 'openid offline_access assistant:read assistant:write'
                })
              )
          }
        })
      )
    )
)
