import { hashApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  LIVE_SUITE_TIMEOUT,
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { expect, layer } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { RateLimiter } from '@b2b-saas-starter/api'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { buildWebHandler } from './http.ts'
import { mcpProtocolLayer } from './mcp.ts'
import { makeOAuthTokenVerifier, OAuthTokenVerifier } from './oauth-access-token.ts'
import { jsonBody, mcpClient } from './test-utils.ts'
import { mutationOperations, readOperations } from './operations.ts'

const allow = { limit: () => Promise.resolve({ success: true }) }
const rateBindings = {
  RATE_LIMITER_MCP: allow,
  RATE_LIMITER_REST_READ: allow,
  RATE_LIMITER_REST_WRITE: allow,
  RATE_LIMITER_ASSISTANT: allow
}
const errorBody = Schema.Struct({ _tag: Schema.String })
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))
const toolEnvelope = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ text: Schema.String })),
    structuredContent: Schema.optional(
      Schema.Struct({
        _tag: Schema.Literal('WorkspaceSuspended'),
        workspaceId: Schema.String
      })
    )
  })
})

function execute(sql: string, ...values: ReadonlyArray<string | number>) {
  return Effect.flatMap(TestD1, (db) =>
    Effect.promise(() =>
      db
        .prepare(sql)
        .bind(...values)
        .run()
    )
  )
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'workspace suspension API boundaries',
  (it) => {
    it.effect(
      'AC2/AC5/AC6: OAuth members get a typed denial and outsiders cannot discover suspension',
      () =>
        Effect.gen(function* () {
          const DB = yield* TestD1
          const issuer = 'https://issuer.test/api/auth'
          const audience = 'https://api.test/mcp'
          const keys = yield* Effect.promise(() => generateKeyPair('EdDSA'))
          const jwk = yield* Effect.promise(() => exportJWK(keys.publicKey))
          const verifier = Layer.succeed(OAuthTokenVerifier)(
            makeOAuthTokenVerifier(
              { issuer, audience },
              createLocalJWKSet({ keys: [jwk] })
            )
          )
          const { handler } = HttpRouter.toWebHandler(
            mcpProtocolLayer({ DB }).pipe(
              Layer.provide(
                Layer.mergeAll(
                  selectCapabilitiesLayer({ DB }),
                  verifier,
                  Layer.succeed(RateLimiter)({ take: () => Effect.succeed(true) })
                )
              )
            ),
            { disableLogger: true }
          )
          function clientFor(userId: string) {
            return Effect.promise(() =>
              new SignJWT({
                sub: userId,
                scope: 'mcp:read',
                starter_workspace_id: 'wrk_dev_contract',
                starter_workspace_slug: 'dev-contract-lab',
                starter_workspace_role: 'owner'
              })
                .setProtectedHeader({ alg: 'EdDSA' })
                .setIssuer(issuer)
                .setAudience(audience)
                .setIssuedAt()
                .setExpirationTime('1h')
                .sign(keys.privateKey)
            ).pipe(Effect.map((jwt) => mcpClient(handler, `Bearer ${jwt}`)))
          }
          const member = yield* clientFor('usr_owner')
          const outsider = yield* clientFor('usr_outsider')
          yield* Effect.promise(() => member.initialize())
          yield* Effect.promise(() => outsider.initialize())
          function read(client: ReturnType<typeof mcpClient>) {
            return Effect.promise(() =>
              client.rpc('tools/call', {
                name: 'get_workspace_overview',
                arguments: {}
              })
            ).pipe(Effect.flatMap((response) => jsonBody(response, toolEnvelope)))
          }
          expect((yield* read(member)).result.isError).not.toBe(true)
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='suspended' WHERE id='wrk_dev_contract'`
          )
          expect((yield* read(member)).result.structuredContent).toEqual({
            _tag: 'WorkspaceSuspended',
            workspaceId: 'wrk_dev_contract'
          })
          const hidden = yield* read(outsider)
          expect(hidden.result.isError).toBe(true)
          expect(hidden.result.content[0]?.text).toBe('workspace not found')
          expect(hidden.result.structuredContent).toBeUndefined()
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='active' WHERE id='wrk_dev_contract'`
          )
          expect((yield* read(member)).result.isError).not.toBe(true)
        })
    )
    it.effect(
      'AC1/AC2/AC6: existing REST tokens and MCP sessions observe suspension and reactivation',
      () =>
        Effect.gen(function* () {
          const DB = yield* TestD1
          const credential = 'bsk_suspension_existing'
          const otherCredential = 'bsk_suspension_other'
          const credentials: ReadonlyArray<readonly [string, string, string]> = [
            ['tok_suspension', 'wrk_live', credential],
            ['tok_suspension_other', 'wrk_other', otherCredential]
          ]
          for (const [id, workspaceId, token] of credentials) {
            yield* execute(
              `INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_at) VALUES (?, ?, 'Suspension test', 'bsk_test', ?, '["admin"]', '2026-01-01T00:00:00Z')`,
              id,
              workspaceId,
              yield* Effect.promise(() => hashApiToken(token))
            )
          }
          const { handler } = buildWebHandler({ DB, ...rateBindings })
          const client = mcpClient(handler, `Bearer ${credential}`)
          yield* Effect.promise(() => client.initialize())
          function getOverview(slug: string, token: string) {
            return Effect.promise(() =>
              handler(
                new Request(`https://api.test/workspaces/${slug}/overview`, {
                  headers: { authorization: `Bearer ${token}` }
                })
              )
            )
          }
          function readTool() {
            return Effect.promise(() =>
              client.rpc('tools/call', {
                name: 'get_workspace_overview',
                arguments: {}
              })
            ).pipe(
              Effect.flatMap((response) => jsonBody(response, toolEnvelope)),
              Effect.map((body) => body.result)
            )
          }
          expect((yield* getOverview('live-lab', credential)).status).toBe(200)
          expect((yield* readTool()).isError).not.toBe(true)
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='suspended', suspensionInternalReason='Private investigation detail', suspensionCustomerExplanation='Contact support' WHERE id='wrk_live'`
          )
          const denied = yield* getOverview('live-lab', credential)
          expect(denied.status).toBe(403)
          expect(yield* jsonBody(denied, errorBody)).toEqual({
            _tag: 'WorkspaceSuspended'
          })
          const tool = yield* readTool()
          expect(tool.isError).toBe(true)
          expect(tool.structuredContent).toEqual({
            _tag: 'WorkspaceSuspended',
            workspaceId: 'wrk_live'
          })
          expect(tool.content[0]?.text).toContain('WorkspaceSuspended')
          expect(tool.content[0]?.text).not.toContain('Private investigation detail')
          for (const operation of [...readOperations(), ...mutationOperations()]) {
            const path = operation.endpoint.path
              .replace(':slug', 'live-lab')
              .replaceAll(/:\w+/g, operation.param?.sample ?? '')
            const requestOptions: RequestInit = {
              method: operation.endpoint.method,
              headers: {
                authorization: `Bearer ${credential}`,
                'content-type': 'application/json'
              }
            }
            if ('samplePayload' in operation) {
              requestOptions.body = encodeJson(operation.samplePayload)
            }
            const response = yield* Effect.promise(() =>
              handler(new Request(`https://api.test${path}`, requestOptions))
            )
            expect(response.status).toBe(403)
            expect(yield* jsonBody(response, errorBody)).toEqual({
              _tag: 'WorkspaceSuspended'
            })
          }
          const assistant = yield* Effect.promise(() =>
            handler(
              new Request('https://api.test/assistant/answer', {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${credential}`,
                  'content-type': 'application/json'
                },
                body: encodeJson({
                  workspaceSlug: 'live-lab',
                  question: 'What is this?'
                })
              })
            )
          )
          expect(assistant.status).toBe(403)
          expect(yield* jsonBody(assistant, errorBody)).toEqual({
            _tag: 'WorkspaceSuspended'
          })
          const mutation = yield* Effect.promise(() =>
            client.rpc('tools/call', {
              name: 'create_api_token',
              arguments: { name: 'Blocked', scopes: ['read'] }
            })
          ).pipe(Effect.flatMap((response) => jsonBody(response, toolEnvelope)))
          expect(mutation.result.isError).toBe(true)
          expect(mutation.result.content[0]?.text).toContain('WorkspaceSuspended')
          expect((yield* getOverview('other-lab', otherCredential)).status).toBe(200)
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='active' WHERE id='wrk_live'`
          )
          expect((yield* getOverview('live-lab', credential)).status).toBe(200)
          expect((yield* readTool()).isError).not.toBe(true)
          yield* execute(
            `UPDATE api_tokens SET revoked_at='2026-01-01T00:00:00Z' WHERE id='tok_suspension'`
          )
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='suspended' WHERE id='wrk_live'`
          )
          yield* execute(
            `UPDATE workspaces SET suspensionStatus='active' WHERE id='wrk_live'`
          )
          expect((yield* getOverview('live-lab', credential)).status).toBe(401)
        })
    )
  }
)
