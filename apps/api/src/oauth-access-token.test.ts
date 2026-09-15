import { makeAssistantOAuthTokenVerifier } from './assistant-oauth-access-token.ts'
import {
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM,
  mcpAccessTokenPrincipal
} from '@b2b-saas-starter/authz/mcp-access-token'
import { describe, expect, it, vi } from '@effect/vitest'
import { Effect, Exit, Result } from 'effect'
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTPayload
} from 'jose'
import {
  looksLikeJwt,
  makeOAuthTokenVerifier,
  oauthResourceConfig,
  protectedResourceMetadata
} from './oauth-access-token.ts'

/**
 * The OAuth half of `/mcp` authentication, driven with a key pair generated
 * here: the authorization server is stood in for by `SignJWT`, the JWKS by the
 * exported public key, so every rejection reason is reachable without the web
 * worker.
 */

const ISSUER = 'http://localhost:3071/api/auth'
const AUDIENCE = 'http://localhost:8787/mcp'

const WORKSPACE_CLAIMS = {
  [MCP_WORKSPACE_ID_CLAIM]: 'wrk_starter',
  [MCP_WORKSPACE_SLUG_CLAIM]: 'starter-lab',
  [MCP_WORKSPACE_ROLE_CLAIM]: 'owner'
}

type Signer = {
  readonly jwks: JSONWebKeySet
  readonly sign: (
    payload: JWTPayload,
    overrides?: {
      issuer?: string
      audience?: string | Array<string>
      expiresIn?: string
    }
  ) => Promise<string>
}

function makeSigner(): Effect.Effect<Signer> {
  return Effect.gen(function* () {
    const { publicKey, privateKey } = yield* Effect.promise(() =>
      generateKeyPair('EdDSA')
    )
    const jwk = yield* Effect.promise(() => exportJWK(publicKey))
    const kid = 'test-key'
    return {
      jwks: { keys: [{ ...jwk, kid, alg: 'EdDSA', use: 'sig' }] },
      sign: (payload, overrides) =>
        new SignJWT(payload)
          .setProtectedHeader({ alg: 'EdDSA', kid })
          .setIssuer(overrides?.issuer ?? ISSUER)
          .setAudience(overrides?.audience ?? AUDIENCE)
          .setIssuedAt()
          .setExpirationTime(overrides?.expiresIn ?? '1h')
          .sign(privateKey)
    }
  })
}

const goodPayload: JWTPayload = {
  sub: 'usr_demo',
  scope: 'openid offline_access mcp:read',
  ...WORKSPACE_CLAIMS
}

function verifyWith(signer: Signer, token: string) {
  const verifier = makeOAuthTokenVerifier(
    { issuer: ISSUER, audience: AUDIENCE },
    createLocalJWKSet(signer.jwks)
  )
  return Effect.result(verifier.verify(token))
}

describe('claim → principal mapping', () => {
  it('maps the starter claims onto the workspace principal', () => {
    const outcome = mcpAccessTokenPrincipal(goodPayload)
    expect(outcome).toEqual({
      ok: true,
      principal: {
        userId: 'usr_demo',
        workspaceId: 'wrk_starter',
        workspaceSlug: 'starter-lab',
        workspaceRole: 'owner',
        scopes: ['openid', 'offline_access', 'mcp:read']
      }
    })
  })

  it('refuses a token without the mcp:read scope', () => {
    expect(mcpAccessTokenPrincipal({ ...goodPayload, scope: 'openid' })).toEqual({
      ok: false,
      reason: 'missing_mcp_scope'
    })
  })

  it('refuses a token missing a workspace claim or naming an unknown role', () => {
    // A payload with no slug claim at all.
    const withoutSlug: JWTPayload = {
      sub: 'usr_demo',
      scope: 'openid offline_access mcp:read',
      [MCP_WORKSPACE_ID_CLAIM]: 'wrk_starter',
      [MCP_WORKSPACE_ROLE_CLAIM]: 'owner'
    }
    expect(mcpAccessTokenPrincipal(withoutSlug)).toEqual({
      ok: false,
      reason: 'malformed_claims'
    })
    expect(
      mcpAccessTokenPrincipal({
        ...goodPayload,
        [MCP_WORKSPACE_ROLE_CLAIM]: 'superuser'
      })
    ).toEqual({ ok: false, reason: 'malformed_claims' })
  })

  it('refuses a DPoP-bound token presented as a bare bearer', () => {
    expect(mcpAccessTokenPrincipal({ ...goodPayload, cnf: { jkt: 'thumb' } })).toEqual({
      ok: false,
      reason: 'dpop_bound_token'
    })
  })
})

describe('JWKS verification', () => {
  it.effect('accepts a token signed by the issuer for this resource', () =>
    Effect.gen(function* () {
      const signer = yield* makeSigner()
      const token = yield* Effect.promise(() => signer.sign(goodPayload))
      const outcome = yield* verifyWith(signer, token)
      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isSuccess(outcome)) {
        expect(outcome.success.workspaceSlug).toBe('starter-lab')
        expect(outcome.success.userId).toBe('usr_demo')
      }
    })
  )

  it.effect(
    'rejects a wrong issuer, a wrong audience, an expired token, and a foreign key',
    () =>
      Effect.gen(function* () {
        const signer = yield* makeSigner()
        const cases = yield* Effect.promise(() =>
          Promise.all([
            signer.sign(goodPayload, { issuer: 'https://evil.example/api/auth' }),
            signer.sign(goodPayload, { audience: 'http://localhost:8787/other' }),
            signer.sign(goodPayload, { expiresIn: '-1h' })
          ])
        )
        const reasons: Array<string> = []
        for (const token of cases) {
          const outcome = yield* verifyWith(signer, token)
          expect(Result.isFailure(outcome)).toBe(true)
          if (Result.isFailure(outcome)) {
            reasons.push(outcome.failure.message)
          }
        }
        expect(reasons).toEqual([
          'access_token_iss_mismatch',
          'access_token_aud_mismatch',
          'access_token_expired'
        ])

        // A token signed by a key the issuer never published.
        const stranger = yield* makeSigner()
        const forged = yield* Effect.promise(() => stranger.sign(goodPayload))
        const outcome = yield* verifyWith(signer, forged)
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          expect(outcome.failure.message).toBe('invalid_access_token')
        }
      })
  )

  it.effect('fetches the remote key set once and reuses the cached keys', () =>
    Effect.gen(function* () {
      const signer = yield* makeSigner()
      const fetchJwks = vi.fn(() =>
        Promise.resolve(
          // oxlint-disable-next-line effect/noGlobals -- the fixture JWK set is the wire body jose's custom fetch receives
          new Response(JSON.stringify(signer.jwks), {
            headers: { 'content-type': 'application/json' }
          })
        )
      )
      const keySet = createRemoteJWKSet(new URL(`${ISSUER}/jwks`), {
        [customFetch]: fetchJwks
      })
      const verifier = makeOAuthTokenVerifier(
        { issuer: ISSUER, audience: AUDIENCE },
        keySet
      )
      const first = yield* Effect.promise(() => signer.sign(goodPayload))
      const second = yield* Effect.promise(() =>
        signer.sign({ ...goodPayload, sub: 'usr_dev' })
      )
      const exits = yield* Effect.all([
        Effect.exit(verifier.verify(first)),
        Effect.exit(verifier.verify(second))
      ])
      expect(exits.every(Exit.isSuccess)).toBe(true)
      expect(fetchJwks).toHaveBeenCalledTimes(1)
    })
  )
})

describe('resource configuration', () => {
  it('is inactive until both the issuer and the resource URL are set', () => {
    expect(oauthResourceConfig({})).toBeUndefined()
    expect(oauthResourceConfig({ MCP_OAUTH_ISSUER: ISSUER })).toBeUndefined()
    expect(oauthResourceConfig({ MCP_RESOURCE_URL: AUDIENCE })).toBeUndefined()
    expect(
      oauthResourceConfig({
        MCP_OAUTH_ISSUER: `${ISSUER}/`,
        MCP_RESOURCE_URL: AUDIENCE
      })
    ).toEqual({ issuer: ISSUER, audience: AUDIENCE, jwksUrl: `${ISSUER}/jwks` })
  })

  it('advertises the resource, its authorization server and the MCP scopes', () => {
    expect(
      protectedResourceMetadata({ issuer: ISSUER, audience: AUDIENCE, jwksUrl: '' })
    ).toEqual({
      resource: AUDIENCE,
      authorization_servers: [ISSUER],
      scopes_supported: ['mcp:read', 'mcp:write', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: 'B2B SaaS Starter MCP'
    })
  })

  it('tells a JWT from an API Token by shape', () => {
    expect(looksLikeJwt('bsk_seed_0000000000000000')).toBe(false)
    expect(looksLikeJwt('aaa.bbb.ccc')).toBe(true)
  })
})

describe('assistant OAuth verifier', () => {
  it.effect(
    'accepts only the assistant audience and retains references without bearer secrets',
    () =>
      Effect.gen(function* () {
        const signer = yield* makeSigner()
        const verifier = makeAssistantOAuthTokenVerifier(
          { issuer: ISSUER, audience: 'http://localhost:8787/assistant' },
          createLocalJWKSet(signer.jwks)
        )
        const claims = {
          ...goodPayload,
          scope: 'assistant:read assistant:write',
          client_id: 'client',
          starter_session_id: 'session',
          starter_consent_binding: 'consent:0'
        }
        const token = yield* Effect.promise(() =>
          signer.sign(claims, { audience: 'http://localhost:8787/assistant' })
        )
        const principal = yield* verifier.verify(token)
        expect(principal).toMatchObject({
          kind: 'oauth',
          userId: 'usr_demo',
          sessionId: 'session',
          workspaceId: 'wrk_starter',
          clientId: 'client',
          consentBinding: 'consent:0',
          resource: 'http://localhost:8787/assistant'
        })
        expect(Object.values(principal)).not.toContain(token)
        const mcpToken = yield* Effect.promise(() => signer.sign(claims))
        expect((yield* Effect.result(verifier.verify(mcpToken)))._tag).toBe('Failure')
        expect(
          (yield* Effect.result(verifier.verify('bsk_workspace_token')))._tag
        ).toBe('Failure')
        const multiAudience = yield* Effect.promise(() =>
          signer.sign(claims, {
            audience: [AUDIENCE, 'http://localhost:8787/assistant']
          })
        )
        expect((yield* Effect.result(verifier.verify(multiAudience)))._tag).toBe(
          'Failure'
        )
        const mcpVerifier = makeOAuthTokenVerifier(
          { issuer: ISSUER, audience: AUDIENCE },
          createLocalJWKSet(signer.jwks)
        )
        expect((yield* Effect.result(mcpVerifier.verify(multiAudience)))._tag).toBe(
          'Failure'
        )
        const expired = yield* Effect.promise(() =>
          signer.sign(claims, {
            audience: 'http://localhost:8787/assistant',
            expiresIn: '-1s'
          })
        )
        expect((yield* Effect.result(verifier.verify(expired)))._tag).toBe('Failure')
      })
  )
})
