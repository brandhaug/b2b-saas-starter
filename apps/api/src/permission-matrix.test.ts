import { describe, expect, test } from 'vitest'
import { Effect, Schema } from 'effect'
import { SEED_READONLY_API_TOKEN } from '@b2b-saas-starter/capabilities'
import { buildWebHandler } from './http.ts'

/**
 * The route-to-permission table of `handlers.ts`, asserted end to end.
 *
 * One token drives the whole matrix: the seed `read`-scope token, the narrowest
 * principal the worker has. `readScopeRole` in `@b2b-saas-starter/authz` grants
 * every `list`/`read` action and no mutation, so a route's expected answer here
 * is a direct statement of which side of that line its permission falls on —
 * and a scope-to-permission mapping that drifts flips a row from 200 to 403.
 *
 * The completeness test below is the point of the file. Asserting the served
 * OpenAPI document's operations against this table means a new endpoint cannot
 * be added without deciding what a read-only token gets from it: the test fails
 * until the row exists.
 */

const ErrorBody = Schema.Struct({ _tag: Schema.String })
const OpenApiBody = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))
})

const encodeJsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const readOnlyBearer = { authorization: `Bearer ${SEED_READONLY_API_TOKEN}` }

function makeRequest(
  method: string,
  path: string,
  body?: typeof Schema.Json.Type
): Request {
  if (body === undefined) {
    return new Request(`https://api.test${path}`, { method, headers: readOnlyBearer })
  }
  return new Request(`https://api.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...readOnlyBearer },
    body: encodeJsonBody(body)
  })
}

function send(request: Request): Effect.Effect<Response> {
  return Effect.promise(() => buildWebHandler({}).handler(request))
}

function jsonBody<S extends Schema.Top>(
  response: Response,
  schema: S
): Effect.Effect<S['Type'], never, S['DecodingServices']> {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body)),
    Effect.orDie
  )
}

type GatedOperation = {
  /** `METHOD <openapi template>`, so the completeness test can match the document. */
  readonly operation: string
  /** The permission the handler names, for whoever reads a failure. */
  readonly permission: string
  /** What the `read` scope gets: 200, or 403 for a mutation it does not reach. */
  readonly expected: 200 | 403
  readonly request: Request
}

const SLUG = 'starter-lab'

const MATRIX: readonly GatedOperation[] = [
  // The workspace reads, all through the `read(event, permission, slug, ...)`
  // helper in `workspaceGroup`.
  {
    operation: 'GET /workspaces/{slug}/overview',
    permission: 'notification:read',
    expected: 200,
    request: makeRequest('GET', `/workspaces/${SLUG}/overview`)
  },
  // Listing members exposes who holds which role, which is `ac:read` — the
  // plugin's `member` statement has no read action at all.
  {
    operation: 'GET /workspaces/{slug}/members',
    permission: 'ac:read',
    expected: 200,
    request: makeRequest('GET', `/workspaces/${SLUG}/members`)
  },
  {
    operation: 'GET /workspaces/{slug}/notifications',
    permission: 'notification:read',
    expected: 200,
    request: makeRequest('GET', `/workspaces/${SLUG}/notifications`)
  },
  // A read token may LIST tokens — wider than the `member` role, which cannot:
  // a token is minted by an owner or admin (see `readScopeStatements`).
  {
    operation: 'GET /workspaces/{slug}/api-tokens',
    permission: 'apiToken:list',
    expected: 200,
    request: makeRequest('GET', `/workspaces/${SLUG}/api-tokens`)
  },
  {
    operation: 'GET /workspaces/{slug}/webhooks',
    permission: 'webhook:list',
    expected: 200,
    request: makeRequest('GET', `/workspaces/${SLUG}/webhooks`)
  },
  {
    operation: 'GET /workspaces/{slug}/audit-events',
    permission: 'auditLog:read',
    expected: 200,
    request: makeRequest('GET', `/workspaces/${SLUG}/audit-events`)
  },

  // Minting is the one mutation a `write` token is refused as well: a token
  // allowed to create tokens could issue itself an `admin` one.
  {
    operation: 'POST /workspaces/{slug}/api-tokens',
    permission: 'apiToken:create',
    expected: 403,
    request: makeRequest('POST', `/workspaces/${SLUG}/api-tokens`, {
      name: 'CI token',
      scopes: ['read']
    })
  },
  // Both revoke paths name the same permission, so both have to be here: the
  // DELETE alias is where a matrix drawn from the POST alone would leak.
  {
    operation: 'POST /workspaces/{slug}/api-tokens/{tokenId}/revoke',
    permission: 'apiToken:revoke',
    expected: 403,
    request: makeRequest('POST', `/workspaces/${SLUG}/api-tokens/tok_seed/revoke`)
  },
  {
    operation: 'DELETE /workspaces/{slug}/api-tokens/{tokenId}',
    permission: 'apiToken:revoke',
    expected: 403,
    request: makeRequest('DELETE', `/workspaces/${SLUG}/api-tokens/tok_seed`)
  },
  {
    operation: 'POST /workspaces/{slug}/webhooks',
    permission: 'webhook:create',
    expected: 403,
    request: makeRequest('POST', `/workspaces/${SLUG}/webhooks`, {
      url: 'https://hooks.example.com/x',
      events: ['api_token.created']
    })
  },

  // The account-wide surfaces. None has a statement of its own — both fold
  // into `notification:read`, which is the decision this half records.
  {
    operation: 'POST /assistant/answer',
    permission: 'notification:read',
    expected: 200,
    request: makeRequest('POST', '/assistant/answer', {
      workspaceSlug: SLUG,
      question: 'What is this?'
    })
  },
  {
    operation: 'GET /mcp',
    permission: 'notification:read',
    expected: 200,
    request: makeRequest('GET', '/mcp')
  }
]

/** `/health` is the only operation the contract serves with no bearer gate. */
const PUBLIC_OPERATIONS = new Set(['GET /health'])

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options'
])

describe('permission matrix', () => {
  test('covers every gated operation the served contract advertises', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const res = yield* send(new Request('https://api.test/openapi.json'))
        const doc = yield* jsonBody(res, OpenApiBody)
        const served = Object.entries(doc.paths)
          .flatMap(([path, item]) =>
            Object.keys(item)
              .filter((key) => HTTP_METHODS.has(key))
              .map((method) => `${method.toUpperCase()} ${path}`)
          )
          .filter((operation) => !PUBLIC_OPERATIONS.has(operation))
        expect(served.toSorted()).toEqual(
          MATRIX.map((entry) => entry.operation).toSorted()
        )
      })
    ))

  test.each(MATRIX)(
    'a read-only token gets $expected from $operation ($permission)',
    (entry) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const res = yield* send(entry.request)
          expect(res.status).toBe(entry.expected)
          if (entry.expected === 403) {
            expect((yield* jsonBody(res, ErrorBody))._tag).toBe('AuthorizationDenied')
          }
        })
      )
  )
})
