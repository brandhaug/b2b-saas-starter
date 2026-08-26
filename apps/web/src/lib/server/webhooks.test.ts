import { SeedWebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints.seed'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { SeedWebhookPublisher } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'

import {
  disableWebhookEndpoint,
  loadWorkspaceWebhooks,
  rotateWebhookSecret
} from './webhooks'

/**
 * The webhook management surface below its session gate. `disableWebhookEndpoint`
 * and `rotateWebhookSecret` are exported as effects taking only the mutation
 * input, so what is testable without a request or an auth runtime is exactly
 * the behaviour: the `webhook:disable` / `webhook:rotateSecret` gates (both
 * declared-but-unenforced until this page) and the hand-off to the capability.
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

const seedEndpoints: readonly WebhookEndpoint[] = [
  {
    id: 'wh_1',
    url: 'https://example.com/hooks/starter',
    enabled: true,
    events: ['api_token.created'],
    successRate: 100
  }
]

/** Turns a typed failure into a value, so a denial is asserted not thrown. */
function outcome<A, E extends { readonly _tag: string; readonly reason?: string }, R>(
  effect: Effect.Effect<A, E, R>
) {
  return Effect.match(effect, {
    onSuccess: (value) => ({ tag: 'ok', value }),
    onFailure: (failure) => ({ tag: failure._tag, reason: failure.reason })
  })
}

describe('disableWebhookEndpoint', () => {
  it('lets an actor with webhook:disable disable', async () => {
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, ADMIN)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          disableWebhookEndpoint({ endpointId: 'wh_1', actorUserId: ADMIN.userId })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'ok', value: true })
  })

  it('denies a plain member — webhook:disable is withheld from member', async () => {
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          disableWebhookEndpoint({ endpointId: 'wh_1', actorUserId: ADMIN.userId })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('fails closed with no resolved actor', async () => {
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, null)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          disableWebhookEndpoint({ endpointId: 'wh_1', actorUserId: ADMIN.userId })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'AuthorizationDenied', reason: 'no_principal' })
  })
})

describe('rotateWebhookSecret', () => {
  it('returns the new secret to an actor with webhook:rotateSecret', async () => {
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, OWNER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          rotateWebhookSecret({ endpointId: 'wh_1', actorUserId: OWNER.userId })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({ tag: 'ok', value: 'whsec_seed_rotated' })
  })

  it('denies a plain member — webhook:rotateSecret is withheld from member', async () => {
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, MEMBER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        outcome(
          rotateWebhookSecret({ endpointId: 'wh_1', actorUserId: OWNER.userId })
        ).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('resolves no secret for an unknown endpoint — none is minted', async () => {
    const layer = Layer.mergeAll(
      SeedWebhookEndpoints(seedEndpoints).pipe(
        Layer.provide(SeedAuditEventLog([])),
        Layer.provide(SeedWebhookPublisher)
      ),
      testWorkspaceContext(workspace, OWNER)
    )
    const result = await Effect.runPromise(
      Effect.scoped(
        rotateWebhookSecret({
          endpointId: 'wh_missing',
          actorUserId: OWNER.userId
        }).pipe(Effect.provide(layer))
      )
    )
    expect(result).toBeNull()
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
