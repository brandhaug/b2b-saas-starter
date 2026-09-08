import { RateLimiter } from '@b2b-saas-starter/api'
import { SeedLayer } from '@b2b-saas-starter/capabilities/layers'
import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import {
  StrongAuthentication,
  StrongAuthenticationRequired
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { WebhookPublisher } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { SeedWebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints.seed'
import {
  seedWebhookEndpoints,
  seedDeliveries
} from '@b2b-saas-starter/capabilities/seed-fixture'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { SEED_API_TOKEN } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WideEventLoggerLive } from '@b2b-saas-starter/logger'
import { expect, it } from '@effect/vitest'
import { Effect, Layer, Logger, Schema } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { mcpProtocolLayer } from './mcp.ts'
import { authorizeMcpOperation, type McpCaller } from './request-guards.ts'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { OAuthTokenVerifier } from './oauth-access-token.ts'
import { mcpClient, jsonBody } from './test-utils.ts'

const result = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ text: Schema.String }))
  })
})
const decodeAudit = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      items: Schema.Array(
        Schema.Struct({
          eventType: Schema.String,
          actorType: Schema.String,
          actor: Schema.String
        })
      )
    })
  )
)

const clientId = 'https://client.example/metadata.json'

function call(
  client: ReturnType<typeof mcpClient>,
  name: string,
  args: Schema.Json = {}
) {
  return Effect.promise(() => client.rpc('tools/call', { name, arguments: args })).pipe(
    Effect.flatMap((response) => jsonBody(response, result)),
    Effect.map((body) => body.result)
  )
}

/** Real protocol and authorization, with an issuer and mutable consent fixture. */
const encodeTelemetry = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

function authorityHarness() {
  const telemetry: Array<string> = []
  const logger = Logger.layer([
    Logger.map(Logger.formatStructured, (event) => {
      telemetry.push(encodeTelemetry(event))
    })
  ])
  let userId = 'usr_demo'
  let workspaceId = 'wrk_starter'
  let scopes = ['mcp:read', 'mcp:write']
  let granted = true
  let grantedScopes = ['mcp:read', 'mcp:write']
  let consentBinding = 'consent:0'
  let grantBinding = 'consent:0'
  let sessionId: string | undefined = 'session-test'
  let qualified = true
  const grants = Layer.succeed(McpClientConnections)({
    getGrant: () =>
      Effect.sync(() => {
        if (!granted) {
          return null
        }
        return { binding: grantBinding, scopes: grantedScopes }
      }).pipe(Effect.tap(() => Effect.log('grant resolved in invocation'))),
    describeClient: () => Effect.succeed(null),
    listForUser: () =>
      Effect.sync(() => {
        if (!granted) {
          return []
        }
        return [
          {
            id: 'consent',
            client: { clientId, name: 'Test', uri: null },
            workspace: { id: 'wrk_starter', slug: 'starter-lab', name: 'Starter' },
            scopes: grantedScopes,
            grantedAt: '2026-01-01T00:00:00Z'
          }
        ]
      }),
    recordGrant: () => Effect.void,
    revoke: () =>
      Effect.sync(() => {
        granted = false
        return true
      })
  })
  const issuer = Layer.succeed(OAuthTokenVerifier)({
    verify: () =>
      Effect.sync(() => ({
        userId,
        workspaceId,
        workspaceSlug: 'starter-lab',
        workspaceRole: 'owner',
        scopes,
        clientId,
        consentBinding,
        sessionId
      }))
  })
  const assurance = Layer.succeed(StrongAuthentication)({
    status: () =>
      Effect.succeed({
        qualified: true,
        recovering: false,
        hasFactors: true,
        passwordVerified: true
      }),
    require: () => {
      if (qualified) {
        return Effect.void
      }
      return Effect.fail(new StrongAuthenticationRequired())
    }
  })
  const limiter = Layer.succeed(RateLimiter)({ take: () => Effect.succeed(true) })
  const handler = HttpRouter.toWebHandler(
    mcpProtocolLayer({}).pipe(
      Layer.provide(Layer.mergeAll(SeedLayer, grants, issuer, limiter, assurance)),
      HttpRouter.provideRequest(logger)
    ),
    { disableLogger: true }
  ).handler
  return {
    handler,
    telemetry,
    setUser: (id: string) => {
      userId = id
    },
    setWorkspace: (id: string) => {
      workspaceId = id
    },
    setScopes: (value: Array<string>) => {
      scopes = value
    },
    revoke: () => {
      granted = false
    },
    reduceGrant: () => {
      grantedScopes = ['mcp:read']
      grantBinding = 'consent:1'
    },
    restoreGrant: () => {
      grantedScopes = ['mcp:read', 'mcp:write']
      grantBinding = 'consent:2'
    },
    reconsent: () => {
      granted = true
      grantBinding = 'new-consent:0'
    },
    oldCredential: () => {
      consentBinding = 'old-consent:0'
    },
    clearSession: () => {
      sessionId = undefined
    },
    staleAssurance: () => {
      qualified = false
    }
  }
}

it.effect('OAuth privileged calls fail without current session-bound assurance', () =>
  Effect.gen(function* () {
    const harness = authorityHarness()
    const oauth = mcpClient(harness.handler, 'Bearer signed.oauth.jwt')
    yield* Effect.promise(() => oauth.initialize())
    harness.clearSession()
    expect(
      (yield* call(oauth, 'create_api_token', {
        name: 'missing session',
        scopes: ['read']
      })).isError
    ).toBe(true)
    harness.staleAssurance()
    expect(
      (yield* call(oauth, 'create_api_token', {
        name: 'stale assurance',
        scopes: ['read']
      })).isError
    ).toBe(true)
  })
)

it.effect(
  'MCP authorization checks system admins even with a member workspace role',
  () =>
    Effect.gen(function* () {
      const caller: McpCaller = {
        kind: 'oauth',
        token: {
          userId: 'usr_system_member',
          workspaceId: 'wrk_starter',
          workspaceSlug: 'starter-lab',
          workspaceRole: 'member',
          scopes: ['mcp:read'],
          clientId,
          consentBinding: 'binding:current',
          sessionId: 'session:current'
        }
      }
      const callerUserId = 'usr_system_member'
      const connections = Layer.succeed(McpClientConnections)({
        getGrant: () =>
          Effect.succeed({ binding: 'binding:current', scopes: ['mcp:read'] }),
        describeClient: () => Effect.succeed(null),
        listForUser: () => Effect.succeed([]),
        recordGrant: () => Effect.void,
        revoke: () => Effect.succeed(false)
      })
      const suspension = Layer.succeed(WorkspaceSuspensionService)({
        list: Effect.succeed([]),
        get: () => Effect.die('unused'),
        requireAllowed: () => Effect.void,
        transition: () => Effect.die('unused')
      })
      function context(systemRole: 'admin' | 'user') {
        return Layer.succeed(WorkspaceContext)({
          workspace: {
            id: 'wrk_starter',
            slug: 'starter-lab',
            name: 'Starter',
            planId: 'starter'
          },
          actor: { userId: callerUserId, role: 'member', systemRole },
          actorType: 'user'
        })
      }
      const weakAssurance = Layer.succeed(StrongAuthentication)({
        status: () =>
          Effect.succeed({
            qualified: false,
            recovering: false,
            hasFactors: true,
            passwordVerified: false
          }),
        require: () => Effect.fail(new StrongAuthenticationRequired())
      })
      function authorize(systemRole: 'admin' | 'user') {
        return authorizeMcpOperation(
          caller,
          { notification: ['read'] },
          'mcp:read'
        ).pipe(
          Effect.result,
          Effect.provide(
            Layer.mergeAll(context(systemRole), connections, suspension, weakAssurance)
          )
        )
      }
      const denied = yield* authorize('admin')
      expect(denied._tag).toBe('Failure')
      if (denied._tag === 'Failure') {
        expect(denied.failure._tag).toBe('StrongAuthenticationRequired')
      }
      const member = yield* authorize('user')
      expect(member._tag).toBe('Success')
    })
)

it.effect(
  'OAuth writes require a write grant and current role; token minting cannot exceed it',
  () =>
    Effect.gen(function* () {
      const harness = authorityHarness()
      const oauth = mcpClient(harness.handler, 'Bearer signed.oauth.jwt')
      yield* Effect.promise(() => oauth.initialize())
      harness.setScopes(['mcp:read'])
      const before = yield* call(oauth, 'list_audit_events')
      expect(
        (yield* call(oauth, 'create_api_token', { name: 'denied', scopes: ['read'] }))
          .isError
      ).toBe(true)
      expect(yield* call(oauth, 'list_audit_events')).toEqual(before)
      harness.setScopes(['mcp:read', 'mcp:write'])
      const source = yield* call(oauth, 'create_api_token', {
        name: 'replacement source',
        scopes: ['admin', 'read']
      })
      const sourceToken = yield* decodeCreated(source.content[0]?.text)
      harness.setUser('usr_ops')
      const beforeReplacement = yield* call(oauth, 'list_audit_events')
      expect(
        (yield* call(oauth, 'replace_api_token', {
          tokenId: sourceToken.id,
          scopes: ['admin'],
          overlapSeconds: 0
        })).isError
      ).toBe(true)
      expect(yield* call(oauth, 'list_audit_events')).toEqual(beforeReplacement)
      expect(
        (yield* call(oauth, 'replace_api_token', {
          tokenId: sourceToken.id,
          scopes: ['read'],
          overlapSeconds: 0
        })).isError
      ).not.toBe(true)
      expect(
        (yield* call(oauth, 'create_api_token', {
          name: 'escalation',
          scopes: ['admin']
        })).isError
      ).toBe(true)
      expect((yield* call(oauth, 'request_workspace_export')).isError).toBe(true)
      expect(
        (yield* call(oauth, 'create_api_token', {
          name: 'permitted',
          scopes: ['write']
        })).isError
      ).not.toBe(true)
      harness.setUser('usr_dev')
      expect(
        (yield* call(oauth, 'delete_webhook', { endpointId: 'wh_release' })).isError
      ).toBe(true)
      harness.setUser('removed-user')
      expect(
        (yield* call(oauth, 'delete_webhook', { endpointId: 'wh_release' })).content[0]
          ?.text
      ).toBe('workspace not found')
      harness.setUser('usr_demo')
      harness.setWorkspace('foreign-workspace')
      expect(
        (yield* call(oauth, 'delete_webhook', { endpointId: 'wh_release' })).isError
      ).toBe(true)
    })
)

for (const revoke of ['revoke', 'reduceGrant', 'oldCredential'] satisfies ReadonlyArray<
  'revoke' | 'reduceGrant' | 'oldCredential'
>) {
  it.effect(
    `OAuth ${revoke} is resolved on the next invocation of the same session`,
    () =>
      Effect.gen(function* () {
        const harness = authorityHarness()
        const client = mcpClient(harness.handler, 'Bearer signed.oauth.jwt')
        yield* Effect.promise(() => client.initialize())
        expect(
          (yield* call(client, 'create_api_token', { name: 'first', scopes: ['read'] }))
            .isError
        ).not.toBe(true)
        const observer = mcpClient(harness.handler, `Bearer ${SEED_API_TOKEN}`)
        yield* Effect.promise(() => observer.initialize())
        const before = yield* call(observer, 'list_audit_events')
        harness[revoke]()
        expect(
          (yield* call(client, 'delete_webhook', { endpointId: 'wh_release' })).isError
        ).toBe(true)
        expect((yield* call(client, 'list_audit_events')).isError).toBe(true)
        expect(yield* call(observer, 'list_audit_events')).toEqual(before)
      })
  )
}

it.effect(
  'API token and OAuth writes record truthful actor provenance without secret telemetry',
  () =>
    Effect.gen(function* () {
      const harness = authorityHarness()
      const oauth = mcpClient(harness.handler, 'Bearer signed.oauth.jwt')
      const apiToken = mcpClient(harness.handler, `Bearer ${SEED_API_TOKEN}`)
      yield* Effect.promise(() => oauth.initialize())
      yield* Effect.promise(() => apiToken.initialize())
      for (const client of [oauth, apiToken]) {
        expect(
          (yield* call(client, 'create_api_token', {
            name: 'attribution',
            scopes: ['read']
          })).isError
        ).not.toBe(true)
      }
      const audit = yield* call(oauth, 'list_audit_events')
      const page = yield* decodeAudit(audit.content[0]?.text)
      const created = page.items
        .filter((event) => event.eventType === 'api_token.created')
        .slice(0, 2)
      expect(created).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actorType: 'user', actor: 'Demo Admin' }),
          expect.objectContaining({ actorType: 'api_token', actor: 'system' })
        ])
      )
    })
)

it.effect(
  'failed queue writes retain one pending row and are never retried or reported as queued',
  () =>
    Effect.gen(function* () {
      let attempts = 0
      const publisher = Layer.succeed(WebhookPublisher)({
        publish: () => Effect.void,
        enqueue: () =>
          Effect.suspend(() => {
            attempts += 1
            return Effect.fail(
              new CapabilityUnavailable({
                capability: 'webhook-publisher',
                reason: 'unavailable'
              })
            )
          })
      })
      const webhooks = SeedWebhookEndpoints(seedWebhookEndpoints, seedDeliveries).pipe(
        Layer.provide(publisher),
        Layer.provide(SeedLayer)
      )
      const limiter = Layer.succeed(RateLimiter)({ take: () => Effect.succeed(true) })
      const verifier = Layer.succeed(OAuthTokenVerifier)({
        verify: () => Effect.die('unexpected OAuth')
      })
      const handler = HttpRouter.toWebHandler(
        mcpProtocolLayer({}).pipe(
          Layer.provide(
            Layer.mergeAll(SeedLayer, webhooks, limiter, verifier, WideEventLoggerLive)
          )
        ),
        { disableLogger: true }
      ).handler
      const client = mcpClient(handler, `Bearer ${SEED_API_TOKEN}`)
      yield* Effect.promise(() => client.initialize())
      for (const [name, args] of [
        ['send_webhook_test_event', { endpointId: 'wh_release' }],
        ['replay_webhook_delivery', { deliveryId: 'whd_seed_failed' }]
      ] satisfies ReadonlyArray<[string, Schema.Json]>) {
        const failure = yield* call(client, name, args)
        expect(failure.isError).toBe(true)
        expect(failure.content[0]?.text).toContain(
          'pending delivery may have been saved'
        )
      }
      expect(attempts).toBe(2)
      const deliveries = yield* call(client, 'list_webhook_deliveries', {
        endpointId: 'wh_release'
      })
      expect(deliveries.content[0]?.text).toContain('pending')
    })
)

const decodeCreated = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, token: Schema.String }))
)
const decodeRotated = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ signingSecret: Schema.String }))
)
const decodeLink = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ url: Schema.String }))
)
it.effect('one-time secrets and signed URLs never enter invocation telemetry', () =>
  Effect.gen(function* () {
    const harness = authorityHarness()
    const client = mcpClient(harness.handler, 'Bearer signed.oauth.jwt')
    yield* Effect.promise(() => client.initialize())
    const created = yield* call(client, 'create_api_token', {
      name: 'telemetry test',
      scopes: ['read']
    })
    const rotated = yield* call(client, 'rotate_webhook_secret', {
      endpointId: 'wh_release'
    })
    const link = yield* call(client, 'get_workspace_export_download_link', {
      exportId: 'exp_seed_ready'
    })
    const token = yield* decodeCreated(created.content[0]?.text)
    const replaced = yield* call(client, 'replace_api_token', {
      tokenId: token.id,
      scopes: ['read'],
      overlapSeconds: 0
    })
    expect(replaced.isError).not.toBe(true)
    const replacement = yield* decodeCreated(replaced.content[0]?.text)
    const secret = yield* decodeRotated(rotated.content[0]?.text)
    const signed = yield* decodeLink(link.content[0]?.text)
    expect(harness.telemetry.length).toBeGreaterThan(0)
    const telemetry = harness.telemetry.join('\n')
    expect(telemetry).toContain('grant resolved in invocation')
    for (const value of [
      token.token,
      replacement.token,
      secret.signingSecret,
      signed.url,
      new URL(signed.url).search
    ]) {
      expect(telemetry).not.toContain(value)
    }
  })
)

for (const change of ['reconsent', 'restoreGrant'] satisfies ReadonlyArray<
  'reconsent' | 'restoreGrant'
>) {
  it.effect(`OAuth ${change} cannot revive a previously issued credential`, () =>
    Effect.gen(function* () {
      const harness = authorityHarness()
      const client = mcpClient(harness.handler, 'Bearer signed.oauth.jwt')
      yield* Effect.promise(() => client.initialize())
      harness.revoke()
      harness.reduceGrant()
      harness[change]()
      expect(
        (yield* call(client, 'delete_webhook', { endpointId: 'wh_release' })).isError
      ).toBe(true)
    })
  )
}
