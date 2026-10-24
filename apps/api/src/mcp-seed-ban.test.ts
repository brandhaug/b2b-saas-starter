import { RateLimiter } from '@b2b-saas-starter/api'
import { SeedLayer } from '@b2b-saas-starter/capabilities/layers'
import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { PlatformUserAdmin } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { type McpAccessTokenPrincipal } from '@b2b-saas-starter/authz/mcp-access-token'
import { Effect, Layer, Schema } from 'effect'
import { expect, it } from '@effect/vitest'
import { HttpRouter } from 'effect/http'
import { mcpProtocolLayer } from './mcp.ts'
import { OAuthTokenVerifier } from './oauth-access-token.ts'
import { jsonBody, mcpClient } from './test-utils.ts'

const responseSchema = Schema.Struct({
  result: Schema.Struct({ isError: Schema.optional(Schema.Boolean) })
})

it.effect('Seed MCP reads observe bans and unbans with the same OAuth credential', () =>
  Effect.gen(function* () {
    const services = yield* Layer.build(SeedLayer)
    const admin = yield* PlatformUserAdmin.pipe(Effect.provideContext(services))
    const caller = {
      userId: 'usr_dev',
      workspaceId: 'wrk_starter',
      workspaceSlug: 'starter-lab',
      workspaceRole: 'member',
      scopes: ['mcp:read'],
      clientId: 'https://client.example/metadata.json',
      consentBinding: 'seed-ban-consent'
    } satisfies McpAccessTokenPrincipal
    const handler = HttpRouter.toWebHandler(
      mcpProtocolLayer({}).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeedContext(services),
            Layer.succeed(OAuthTokenVerifier)({ verify: () => Effect.succeed(caller) }),
            Layer.mock(McpClientConnections, {
              getGrant: () =>
                Effect.succeed({
                  binding: caller.consentBinding,
                  scopes: caller.scopes
                })
            }),
            Layer.succeed(RateLimiter)({ take: () => Effect.succeed(true) })
          )
        )
      ),
      { disableLogger: true }
    )
    yield* Effect.addFinalizer(() => Effect.promise(() => handler.dispose()))
    const client = mcpClient(handler.handler, 'Bearer same.oauth.credential')
    yield* Effect.promise(() => client.initialize())
    function read() {
      return Effect.promise(() =>
        client.rpc('tools/call', {
          name: 'get_workspace_overview',
          arguments: {}
        })
      ).pipe(Effect.flatMap((response) => jsonBody(response, responseSchema)))
    }
    expect((yield* read()).result.isError).not.toBe(true)
    yield* admin.banUser({ userId: caller.userId, actorUserId: 'usr_admin' })
    expect((yield* read()).result.isError).toBe(true)
    yield* admin.unbanUser({ userId: caller.userId, actorUserId: 'usr_admin' })
    expect((yield* read()).result.isError).not.toBe(true)
  }).pipe(Effect.scoped)
)
