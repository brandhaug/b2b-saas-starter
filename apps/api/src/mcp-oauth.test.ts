import {
  MCP_WORKSPACE_ID_CLAIM,
  MCP_WORKSPACE_ROLE_CLAIM,
  MCP_WORKSPACE_SLUG_CLAIM
} from '@b2b-saas-starter/authz/mcp-access-token'
import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTPayload,
  type KeyObject
} from 'jose'
import { type ApiEnv } from './env.ts'
import { buildWebHandler } from './http.ts'

/**
 * `POST /mcp` with an OAuth access token (ADR 0054), end to end through the
 * worker's web handler: the authorization server is played by a key pair
 * generated here, published through a stubbed `fetch` at the issuer's JWKS URL
 * — the same remote key set the worker uses in production, so the caching and
 * the discovery URL are the real ones.
 *
 * The rows that matter are the tenant ones: a token is bound to one workspace
 * and one Member, and neither a different slug nor a stranger's user id may
 * read anything. The API Token path runs beside it, untouched.
 */

const ISSUER = 'http://localhost:3071/api/auth'
const RESOURCE = 'https://api.test/mcp'
const env: ApiEnv = { MCP_OAUTH_ISSUER: ISSUER, MCP_RESOURCE_URL: RESOURCE }

type TestAuthority = {
  readonly privateKey: KeyObject | CryptoKey
  readonly jwks: JSONWebKeySet
}

/**
 * One key pair for the file, minted on first use and memoized — the promise
 * replaces a `beforeAll`, whose async body the Effect lint rules refuse.
 */
let authority: Promise<TestAuthority> | undefined
function theAuthority(): Promise<TestAuthority> {
  authority ??= Effect.runPromise(
    Effect.gen(function* () {
      const pair = yield* Effect.promise(() => generateKeyPair('EdDSA'))
      const jwk = yield* Effect.promise(() => exportJWK(pair.publicKey))
      return {
        privateKey: pair.privateKey,
        jwks: { keys: [{ ...jwk, kid: 'k1', alg: 'EdDSA' }] }
      }
    })
  )
  return authority
}

// oxlint-disable-next-line effect/noTestLifecycleHooks -- restores the global fetch each stub replaced
afterEach(() => {
  vi.unstubAllGlobals()
})

/** The issuer's JWKS, served to jose's remote key set; every other URL is refused. */
function stubJwksFetch(jwks: JSONWebKeySet): ReturnType<typeof vi.fn> {
  const fetchJwks = vi.fn((input: RequestInfo | URL) => {
    const url = new Request(input).url
    if (url === `${ISSUER}/jwks`) {
      return Promise.resolve(
        // oxlint-disable-next-line effect/noGlobals -- the fixture JWK set is the wire body jose's remote key set reads
        new Response(JSON.stringify(jwks), {
          headers: { 'content-type': 'application/json' }
        })
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchJwks)
  return fetchJwks
}

function accessToken(
  privateKey: KeyObject | CryptoKey,
  claims: Partial<JWTPayload> = {}
): Promise<string> {
  return new SignJWT({
    sub: 'usr_demo',
    scope: 'openid offline_access mcp:read',
    [MCP_WORKSPACE_ID_CLAIM]: 'wrk_starter',
    [MCP_WORKSPACE_SLUG_CLAIM]: 'starter-lab',
    [MCP_WORKSPACE_ROLE_CLAIM]: 'owner',
    ...claims
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience(RESOURCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
}

const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const MODERN_ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {}
}

let nextId = 0

function callTool(bearer: string, name: string): Request {
  nextId += 1
  return new Request('https://api.test/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'mcp-method': 'tools/call',
      'mcp-name': name
    },
    body: encodeJsonBody({
      jsonrpc: '2.0',
      id: nextId,
      method: 'tools/call',
      params: { name, arguments: {}, _meta: MODERN_ENVELOPE }
    })
  })
}

function send(request: Request, testEnv: ApiEnv = env): Effect.Effect<Response> {
  return Effect.promise(() => buildWebHandler(testEnv).handler(request))
}

const CallToolBody = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ text: Schema.String })),
    isError: Schema.optional(Schema.Boolean)
  })
})
const ErrorBody = Schema.Struct({ _tag: Schema.String, message: Schema.String })
const ProtectedResourceBody = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.Array(Schema.String),
  scopes_supported: Schema.Array(Schema.String)
})

function jsonBody<S extends Schema.Top>(
  response: Response,
  schema: S
): Effect.Effect<S['Type'], never, S['DecodingServices']> {
  return Effect.promise(() => response.text()).pipe(
    Effect.flatMap((text) => {
      // oxlint-disable-next-line effect/noTernary -- unwraps the protocol's SSE framing before decoding; there is no Effect codec for SSE frames
      const raw = response.headers.get('content-type')?.includes('text/event-stream')
        ? text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('\n')
        : text
      // oxlint-disable-next-line effect/noGlobals -- decoding the wire format this test asserts on
      return Effect.try(() => JSON.parse(raw))
    }),
    Effect.flatMap((raw) => Schema.decodeUnknownEffect(schema)(raw)),
    Effect.orDie
  )
}

describe('POST /mcp with an OAuth access token', () => {
  test('a token for workspace A reads workspace A', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        stubJwksFetch(jwks)
        const token = yield* Effect.promise(() => accessToken(privateKey))
        const res = yield* send(callTool(token, 'get_workspace_overview'))
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, CallToolBody)
        expect(body.result.isError).toBeUndefined()
        expect(body.result.content[0]?.text).toContain('"slug": "starter-lab"')
      })
    ))

  test('a token for workspace A cannot read workspace B', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        stubJwksFetch(jwks)
        // Same user, same signature, but the consent named another workspace:
        // the workspace layer resolves the slug in the claims and nothing else.
        const token = yield* Effect.promise(() =>
          accessToken(privateKey, {
            [MCP_WORKSPACE_ID_CLAIM]: 'wrk_other',
            [MCP_WORKSPACE_SLUG_CLAIM]: 'other-workspace'
          })
        )
        const res = yield* send(callTool(token, 'get_workspace_overview'))
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, CallToolBody)
        expect(body.result.isError).toBe(true)
        expect(body.result.content[0]?.text).toBe('workspace not found')
      })
    ))

  test('a token for a user who is not a member reads nothing, non-disclosingly', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        stubJwksFetch(jwks)
        const token = yield* Effect.promise(() =>
          accessToken(privateKey, { sub: 'usr_outsider' })
        )
        const res = yield* send(callTool(token, 'get_workspace_overview'))
        const body = yield* jsonBody(res, CallToolBody)
        expect(body.result.isError).toBe(true)
        expect(body.result.content[0]?.text).toBe('workspace not found')
      })
    ))

  test('a member authorizes as their role, not as the token claim', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        stubJwksFetch(jwks)
        // `usr_dev` is a plain member of the seed workspace; a member cannot
        // read the audit log even if the token claims otherwise.
        const token = yield* Effect.promise(() =>
          accessToken(privateKey, {
            sub: 'usr_dev',
            [MCP_WORKSPACE_ROLE_CLAIM]: 'owner'
          })
        )
        const res = yield* send(callTool(token, 'list_audit_events'))
        const body = yield* jsonBody(res, CallToolBody)
        expect(body.result.isError).toBe(true)
        expect(body.result.content[0]?.text).toContain('denied:')

        const allowed = yield* send(callTool(token, 'list_notifications'))
        expect((yield* jsonBody(allowed, CallToolBody)).result.isError).toBeUndefined()
      })
    ))

  test('the key set is fetched once across requests', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        const fetchJwks = stubJwksFetch(jwks)
        const handler = buildWebHandler(env).handler
        const token = yield* Effect.promise(() => accessToken(privateKey))
        yield* Effect.promise(() => handler(callTool(token, 'list_members')))
        yield* Effect.promise(() => handler(callTool(token, 'list_members')))
        expect(fetchJwks).toHaveBeenCalledTimes(1)
      })
    ))

  test('a JWT is refused when OAuth is not configured', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        const fetchJwks = stubJwksFetch(jwks)
        const token = yield* Effect.promise(() => accessToken(privateKey))
        const res = yield* send(callTool(token, 'get_workspace_overview'), {})
        expect(res.status).toBe(401)
        expect((yield* jsonBody(res, ErrorBody)).message).toBe('oauth_not_configured')
        expect(res.headers.get('www-authenticate')).toBeNull()
        expect(fetchJwks).not.toHaveBeenCalled()
      })
    ))

  test('a 401 points OAuth clients at the protected-resource metadata', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'mcp-method': 'tools/list' },
            body: encodeJsonBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
          })
        )
        expect(res.status).toBe(401)
        expect(res.headers.get('www-authenticate')).toBe(
          'Bearer resource_metadata="https://api.test/.well-known/oauth-protected-resource/mcp"'
        )
      })
    ))
})

describe('the two credentials stay separate', () => {
  test('REST routes do not accept an OAuth access token', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { privateKey, jwks } = yield* Effect.promise(theAuthority)
        stubJwksFetch(jwks)
        const token = yield* Effect.promise(() => accessToken(privateKey))
        const res = yield* send(
          new Request('https://api.test/workspaces/starter-lab/overview', {
            headers: { authorization: `Bearer ${token}` }
          })
        )
        expect(res.status).toBe(401)
        expect((yield* jsonBody(res, ErrorBody))._tag).toBe('Unauthorized')
      })
    ))

  test('an API Token still opens POST /mcp with OAuth configured', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { jwks } = yield* Effect.promise(theAuthority)
        const fetchJwks = stubJwksFetch(jwks)
        const res = yield* send(callTool(SEED_API_TOKEN, 'get_workspace_overview'))
        expect(res.status).toBe(200)
        const body = yield* jsonBody(res, CallToolBody)
        expect(body.result.content[0]?.text).toContain('"slug": "starter-lab"')
        // The token path never touches the key set.
        expect(fetchJwks).not.toHaveBeenCalled()
      })
    ))
})

describe('protected-resource metadata', () => {
  test('is served at the well-known root and the /mcp alias', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const path of [
          '/.well-known/oauth-protected-resource',
          '/.well-known/oauth-protected-resource/mcp'
        ]) {
          const res = yield* send(new Request(`https://api.test${path}`))
          expect(res.status).toBe(200)
          const body = yield* jsonBody(res, ProtectedResourceBody)
          expect(body.resource).toBe(RESOURCE)
          expect(body.authorization_servers).toEqual([ISSUER])
          expect(body.scopes_supported).toContain('mcp:read')
        }
      })
    ))

  test('is 404 while OAuth is unconfigured', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(
          new Request('https://api.test/.well-known/oauth-protected-resource/mcp'),
          {}
        )
        expect(res.status).toBe(404)
      })
    ))
})
