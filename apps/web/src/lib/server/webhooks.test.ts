import {
  SeedWebhookEndpoints,
  type SeedWebhookEndpointFixture
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints.seed'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { SeedWebhookPublisher } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { SeedNotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed.seed'
import { SeedNotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import {
  loadWorkspaceWebhooks,
  replayWebhookDelivery,
  rotateWebhookSecret,
  sendTestEvent,
  updateWebhookEndpoint
} from './webhooks.effects'

/**
 * The webhook management surface below its session gate. The mutation effects
 * are exported taking only the mutation input, so what is testable without a
 * request or an auth runtime is exactly the behaviour: the permission gates
 * and the hand-off to the capability (typed 404 included).
 *
 * Real clock on purpose: plain `it` + `Effect.runPromise`, not
 * `@effect/vitest`'s TestClock epoch.
 */

const workspace: Workspace = {
  // The Seed adapters scope fixture rows to the seed workspace, so this test
  // context must use its id.
  id: 'wrk_starter',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

const OWNER = actor('owner')

// Roles: owner/admin hold every `webhook` action via `starterResources`;
// a plain member holds none.
const ADMIN = actor('admin')
const MEMBER = actor('member')

const seedEndpoints: ReadonlyArray<SeedWebhookEndpointFixture> = [
  {
    id: 'wh_1',
    url: 'https://example.com/hooks/starter',
    enabled: true,
    events: ['api_token.created']
  }
]

/**
 * One fixture endpoint layer per case: the Seed adapters now also need the
 * notification feed (dead-letter notifications) and the audit log (terminal
 * deliveries), provided here exactly once per layer.
 */
function endpointLayer() {
  return SeedWebhookEndpoints(seedEndpoints).pipe(
    Layer.provide(SeedAuditEventLog([])),
    Layer.provide(SeedWebhookPublisher),
    Layer.provide(
      SeedNotificationFeed([]).pipe(
        Layer.provide(
          SeedNotificationPreferences([]).pipe(Layer.provide(SeedAuditEventLog([])))
        )
      )
    )
  )
}

/** Turns a typed failure into a value, so a denial is asserted not thrown. */
function outcome<A, E extends { readonly _tag: string; readonly reason?: string }, R>(
  effect: Effect.Effect<A, E, R>
) {
  return Effect.match(effect, {
    onSuccess: (value) => ({ tag: 'ok', value }),
    onFailure: (failure) => ({ tag: failure._tag, reason: failure.reason })
  })
}

describe('updateWebhookEndpoint', () => {
  it('lets an actor with webhook:update disable', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, ADMIN)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(updateWebhookEndpoint({ endpointId: 'wh_1', enabled: false })).pipe(
          Effect.provide(layer)
        )
      )
    )
    expect(result).toMatchObject({ tag: 'ok', value: { enabled: false } })
  })

  it('fails the typed 404 for an unknown endpoint', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, ADMIN)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          updateWebhookEndpoint({ endpointId: 'wh_missing', enabled: false })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'WebhookEndpointNotFound' })
  })

  it('denies a plain member — webhook:update is withheld from member', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(updateWebhookEndpoint({ endpointId: 'wh_1', enabled: false })).pipe(
          Effect.provide(layer)
        )
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('fails closed with no resolved actor', async () => {
    const layer = Layer.mergeAll(endpointLayer(), testWorkspaceContext(workspace, null))
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(updateWebhookEndpoint({ endpointId: 'wh_1', enabled: false })).pipe(
          Effect.provide(layer)
        )
      )
    )
    expect(result).toEqual({ tag: 'AuthorizationDenied', reason: 'no_principal' })
  })
})

describe('rotateWebhookSecret', () => {
  it('returns the new secret to an actor with webhook:rotateSecret', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, OWNER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(rotateWebhookSecret({ endpointId: 'wh_1' })).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'ok', value: 'whsec_seed_rotated' })
  })

  it('denies a plain member — webhook:rotateSecret is withheld from member', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(rotateWebhookSecret({ endpointId: 'wh_1' })).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('fails the typed 404 for an unknown endpoint — none is minted', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, OWNER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          rotateWebhookSecret({
            endpointId: 'wh_missing'
          })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'WebhookEndpointNotFound' })
  })
})

describe('replayWebhookDelivery', () => {
  it('requeues a failed delivery with attempts reset for webhook:replay', async () => {
    const auditLog = SeedAuditEventLog([])
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(auditLog),
        Layer.provide(SeedWebhookPublisher),
        Layer.provide(
          SeedNotificationFeed([]).pipe(
            Layer.provide(
              SeedNotificationPreferences([]).pipe(Layer.provide(SeedAuditEventLog([])))
            )
          )
        )
      ),
      testWorkspaceContext(workspace, OWNER)
    )
    // Seed a failed delivery with recorded payload through the same interface.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Seed the failure the operator replays, through the same interface
          // the queue consumer writes with.
          const webhooks = yield* WebhookEndpoints
          yield* webhooks.recordDeliveryAttempt({
            id: 'whd_failed',
            endpointId: 'wh_1',
            workspaceId: workspace.id,
            eventType: 'api_token.created',
            status: 'dead_lettered',
            attempts: 6,
            responseStatus: 503,
            payload: { hello: 'world' }
          })
          const result = yield* outcome(
            replayWebhookDelivery({ deliveryId: 'whd_failed' })
          )
          expect(result).toMatchObject({ tag: 'ok' })
          if (!('value' in result)) {
            return
          }
          // The copy lists back through the same service: pending, attempts
          // reset, linked to its source.
          const rows = yield* webhooks.listDeliveries({ endpointId: 'wh_1' })
          const copy = rows.find((row) => row.id === result.value.deliveryId)
          expect(copy).toMatchObject({
            status: 'pending',
            attempts: 0,
            replayedFrom: 'whd_failed'
          })
          expect(copy?.payload).toEqual({ hello: 'world' })
        }).pipe(Effect.provide(layer))
      )
    )
  })

  it('denies a plain member — webhook:replay is withheld from member', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(replayWebhookDelivery({ deliveryId: 'whd_missing' })).pipe(
          Effect.provide(layer)
        )
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })
})

describe('sendTestEvent', () => {
  it('queues a pending webhook.test_event for webhook:test', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, OWNER)
    )
    const row = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sent = yield* sendTestEvent({ endpointId: 'wh_1' })
          const webhooks = yield* WebhookEndpoints
          const rows = yield* webhooks.listDeliveries({ endpointId: 'wh_1' })
          return rows.find((delivery) => delivery.id === sent.deliveryId)
        }).pipe(Effect.provide(layer))
      )
    )
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 0,
      eventType: 'webhook.test_event'
    })
  })

  it('refuses a disabled endpoint', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, OWNER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          Effect.gen(function* () {
            // Disable first through the same surface the UI uses, then ask for
            // the test send — one layer build, so the mutation is visible.
            yield* updateWebhookEndpoint({ endpointId: 'wh_1', enabled: false })
            return yield* sendTestEvent({ endpointId: 'wh_1' })
          })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toMatchObject({ tag: 'WebhookDispatchRejected' })
  })

  it('denies a plain member — webhook:test is withheld from member', async () => {
    const layer = Layer.mergeAll(
      endpointLayer(),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(sendTestEvent({ endpointId: 'wh_1' })).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })
})

/**
 * The loader seam, driven against the app's own Seed layer: `DB` is undefined
 * under Vitest (vite.config.ts), so `runWorkspaceCapabilities` answers from
 * the in-memory fixture. Both users below are seed members of `starter-lab` —
 * `usr_demo` owns it, `usr_dev` is a plain member.
 */
describe('loadWorkspaceWebhooks', () => {
  it('lists endpoints with deliveries attached for an owner', async () => {
    const payload = await loadWorkspaceWebhooks({
      workspaceSlug: 'starter-lab',
      userId: 'usr_demo'
    })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.unreadCount).toBeTypeOf('number')
    expect(payload.endpoints.length).toBeGreaterThan(0)
    // Every endpoint carries its delivery list, even when empty.
    for (const endpoint of payload.endpoints) {
      expect(Array.isArray(endpoint.deliveries)).toBe(true)
    }
  })

  it('denies a plain member — reading webhooks is itself gated', async () => {
    await expect(
      loadWorkspaceWebhooks({ workspaceSlug: 'starter-lab', userId: 'usr_dev' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})
