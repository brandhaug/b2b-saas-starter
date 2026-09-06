import { SEED_READONLY_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { authorize, tokenPrincipal } from '@b2b-saas-starter/authz/client'
import { BearerAuth, rateLimitBucketFor, StarterApi } from '@b2b-saas-starter/api'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { buildWebHandler } from './http.ts'
import {
  mirroredRestPath,
  mutationOperations,
  permissionLabel,
  readOperations
} from './operations.ts'

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
const OpenApiOperation = Schema.Struct({
  security: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))
})
const OpenApiBody = Schema.Struct({
  components: Schema.Struct({
    securitySchemes: Schema.Record(
      Schema.String,
      Schema.Struct({ type: Schema.String, scheme: Schema.optional(Schema.String) })
    )
  }),
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, OpenApiOperation))
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

function jsonBody<S extends Schema.Top>(response: Response, schema: S) {
  return Effect.promise(() => response.json()).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body))
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

/**
 * The workspace-read rows come from the shared operation table
 * (`operations.ts`) — the same rows the REST handlers and the MCP tools are
 * derived from — so the matrix cannot disagree with either surface.
 * Parameterized rows build their request with the row's own sample value.
 */
const READ_ROWS: ReadonlyArray<GatedOperation> = readOperations().map((op) => ({
  operation: `GET /${mirroredRestPath(op.endpoint.path)}`,
  permission: permissionLabel(op.permission),
  expected: 200,
  request: makeRequest(
    'GET',
    op.endpoint.path.replace(':slug', SLUG).replaceAll(/:\w+/g, op.param?.sample ?? '')
  )
}))

const MATRIX: ReadonlyArray<GatedOperation> = [
  ...READ_ROWS,
  ...mutationOperations().map((op): GatedOperation => ({
    operation: `${op.endpoint.method} /${mirroredRestPath(op.endpoint.path)}`,
    permission: permissionLabel(op.permission),
    expected: 403,
    request: makeRequest(
      op.endpoint.method,
      op.endpoint.path
        .replace(':slug', SLUG)
        .replaceAll(/:\w+/g, op.param?.sample ?? ''),
      op.samplePayload
    )
  })),

  // The assistant and MCP surfaces each carry their own statement now.
  {
    operation: 'POST /assistant/answer',
    permission: 'assistant:read',
    expected: 200,
    request: makeRequest('POST', '/assistant/answer', {
      workspaceSlug: SLUG,
      question: 'What is this?'
    })
  },
  {
    operation: 'GET /mcp/discovery',
    permission: 'mcp:read',
    expected: 200,
    request: makeRequest('GET', '/mcp/discovery')
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
  it('write scope permits webhook operations but cannot manage tokens or export data', () => {
    expect(
      mutationOperations()
        .filter((op) => authorize(tokenPrincipal(['write']), op.permission).success)
        .map((op) => `${op.endpoint.method} ${op.endpoint.path}`)
        .toSorted()
    ).toEqual([
      'DELETE /workspaces/:slug/webhooks/:endpointId',
      'PATCH /workspaces/:slug/webhooks/:endpointId',
      'POST /workspaces/:slug/webhooks',
      'POST /workspaces/:slug/webhooks/:endpointId/rotate-secret',
      'POST /workspaces/:slug/webhooks/:endpointId/test-event',
      'POST /workspaces/:slug/webhooks/deliveries/:deliveryId/replay'
    ])
  })

  it('pins endpoint permissions to the reviewed authorization policy', () => {
    // Independent policy oracle: changing a catalog permission must not change
    // the expected answer. Full objects also catch extra required permissions.
    expect(
      Object.fromEntries(
        [...readOperations(), ...mutationOperations()].map((op) => [
          `${op.endpoint.method} /${mirroredRestPath(op.endpoint.path)}`,
          op.permission
        ])
      )
    ).toEqual({
      'GET /workspaces/{slug}/overview': { notification: ['read'] },
      'GET /workspaces/{slug}/members': { ac: ['read'] },
      'GET /workspaces/{slug}/notifications': { notification: ['read'] },
      'GET /workspaces/{slug}/api-tokens': { apiToken: ['list'] },
      'GET /workspaces/{slug}/webhooks': { webhook: ['list'] },
      'GET /workspaces/{slug}/webhooks/{endpointId}/deliveries': { webhook: ['list'] },
      'GET /workspaces/{slug}/webhooks/deliveries/{deliveryId}/attempts': {
        webhook: ['list']
      },
      'GET /workspaces/{slug}/audit-events': { auditLog: ['read'] },
      'POST /workspaces/{slug}/api-tokens': { apiToken: ['create'] },
      'POST /workspaces/{slug}/api-tokens/{tokenId}/replace': { apiToken: ['create'] },
      'DELETE /workspaces/{slug}/api-tokens/{tokenId}': { apiToken: ['revoke'] },
      'POST /workspaces/{slug}/webhooks': { webhook: ['create'] },
      'PATCH /workspaces/{slug}/webhooks/{endpointId}': { webhook: ['update'] },
      'DELETE /workspaces/{slug}/webhooks/{endpointId}': { webhook: ['delete'] },
      'POST /workspaces/{slug}/webhooks/{endpointId}/rotate-secret': {
        webhook: ['rotateSecret']
      },
      'POST /workspaces/{slug}/webhooks/{endpointId}/test-event': { webhook: ['test'] },
      'POST /workspaces/{slug}/webhooks/deliveries/{deliveryId}/replay': {
        webhook: ['replay']
      },
      'POST /workspaces/{slug}/exports': { workspaceExport: ['request'] },
      'POST /workspaces/{slug}/exports/{exportId}/download-link': {
        workspaceExport: ['download']
      }
    })
  })

  it.effect('covers every gated operation the served contract advertises', () =>
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
  )

  /**
   * The gate is declared on the contract (`BearerAuth`), not hand-composed in
   * each handler, so the served document is the statement of which operations
   * are gated: an endpoint that escapes the middleware shows up here as an
   * operation with no security requirement rather than as a handler someone has
   * to notice is missing three lines.
   */
  it.effect('the served document secures exactly the gated operations', () =>
    Effect.gen(function* () {
      const res = yield* send(new Request('https://api.test/openapi.json'))
      const doc = yield* jsonBody(res, OpenApiBody)
      expect(doc.components.securitySchemes['bearer']).toEqual({
        type: 'http',
        scheme: 'Bearer'
      })
      const secured = Object.entries(doc.paths).flatMap(([path, item]) =>
        Object.entries(item)
          .filter(([method]) => HTTP_METHODS.has(method))
          .filter(([, operation]) => (operation.security?.length ?? 0) > 0)
          .map(([method]) => `${method.toUpperCase()} ${path}`)
      )
      expect(secured.toSorted()).toEqual(
        MATRIX.map((entry) => entry.operation).toSorted()
      )
    })
  )

  /**
   * The bucket a group draws from is a row in the contract's table; the
   * middleware dies on a group without one, so assert the table covers every
   * group that carries the gate.
   */
  it('every group behind the gate names a rate-limit bucket', () => {
    const gated = Object.values(StarterApi.groups)
      .filter((group) =>
        Object.values(group.endpoints).some((endpoint) =>
          endpoint.middlewares.has(BearerAuth)
        )
      )
      .map((group) => group.identifier)
    expect(gated.length).toBeGreaterThan(0)
    expect(
      gated.filter((identifier) => rateLimitBucketFor(identifier) === undefined)
    ).toEqual([])
    // `/health` is the contract's only public group; it must stay ungated.
    expect(gated).not.toContain('health')
  })

  describe.each(MATRIX)('$operation ($permission)', (entry) => {
    it.effect('answers a read-only token with the expected status', () =>
      Effect.gen(function* () {
        const res = yield* send(entry.request)
        expect(res.status).toBe(entry.expected)
        if (entry.expected === 403) {
          expect((yield* jsonBody(res, ErrorBody))._tag).toBe('AuthorizationDenied')
        }
      })
    )
  })
})
