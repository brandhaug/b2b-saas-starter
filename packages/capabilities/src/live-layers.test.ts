import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import {
  auditEvents,
  Database,
  layerFromD1,
  starterModules,
  user,
  webhookDeliveries,
  webhookEndpoints,
  workspaceMembers,
  workspaceModuleStates,
  workspaces
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import {
  WebhookEndpoints,
  type WebhookDeliveryAttemptInput
} from './developer-platform/webhook-endpoints.ts'
import { AuditEventLog } from './governance/audit-event-log.ts'
import { WorkspaceMembership } from './governance/workspace-membership.ts'
import { StarterModuleCatalog } from './catalog/starter-module-catalog.ts'
import { makeLiveCapabilitiesLayer, type CapabilityServices } from './layers.ts'
import { liveWorkspaceContext, WorkspaceContext } from './workspace-context.ts'

// Live-layer coverage against a real local D1 (all migrations applied). The
// Seed-layer tests in index.test.ts validate contracts; these validate that
// the D1 adapters — queries, batches, workspace scoping — behave the same.

let test: TestD1

const iso = '2026-07-03T09:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(user).values([
        { id: 'usr_owner', email: 'owner@live.test', name: 'Owner One' },
        { id: 'usr_outsider', email: 'outsider@live.test', name: 'Outsider' }
      ])
      yield* db.insert(workspaces).values([
        {
          id: 'wrk_live',
          slug: 'live-lab',
          name: 'Live Lab',
          createdAt: iso,
          updatedAt: iso
        },
        {
          id: 'wrk_other',
          slug: 'other-lab',
          name: 'Other Lab',
          createdAt: iso,
          updatedAt: iso
        }
      ])
      yield* db.insert(workspaceMembers).values({
        workspaceId: 'wrk_live',
        userId: 'usr_owner',
        role: 'owner',
        createdAt: iso
      })
      yield* db.insert(starterModules).values({
        id: 'mod_live',
        name: 'Live module',
        summary: 'live-layer test module',
        category: 'test',
        docsPath: '/docs/live',
        optional: false
      })
      yield* db.insert(workspaceModuleStates).values({
        workspaceId: 'wrk_live',
        moduleId: 'mod_live',
        status: 'ready',
        enabled: true,
        missingConfig: [],
        updatedAt: iso
      })
    }).pipe(Effect.provide(layerFromD1(test.d1)))
  )
}, 60_000)

afterAll(async () => {
  await test.dispose()
})

const layerFor = (slug: string, actor?: { readonly userId: string }) =>
  Layer.merge(makeLiveCapabilitiesLayer(), liveWorkspaceContext(slug, actor)).pipe(
    Layer.provide(layerFromD1(test.d1))
  )

const runIn = <A, E>(
  slug: string,
  effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>,
  actor?: { readonly userId: string }
) => Effect.runPromise(Effect.provide(effect, layerFor(slug, actor)))

const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, layerFromD1(test.d1)))

describe('live workspace context', () => {
  it('resolves the workspace and actor for a member', async () => {
    const ctx = await runIn('live-lab', WorkspaceContext, { userId: 'usr_owner' })
    expect(ctx.workspace.id).toBe('wrk_live')
    expect(ctx.actor?.role).toBe('owner')
  })

  it('fails with WorkspaceNotFound for an unknown slug', async () => {
    const error = await Effect.runPromise(
      Effect.flip(Effect.provide(WorkspaceContext, layerFor('no-such-workspace')))
    )
    expect(error._tag).toBe('WorkspaceNotFound')
  })

  it('fails identically for a non-member actor (non-disclosing)', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.provide(
          WorkspaceContext,
          layerFor('live-lab', { userId: 'usr_outsider' })
        )
      )
    )
    expect(error._tag).toBe('WorkspaceNotFound')
  })
})

describe('live api token lifecycle', () => {
  it('creates, verifies, lists, revokes, and audits a token', async () => {
    const created = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const registry = yield* ApiTokenRegistry
        return yield* registry.create({
          name: 'Live test token',
          scopes: ['read', 'write'],
          actorUserId: 'usr_owner'
        })
      })
    )
    expect(created.token.startsWith('bsk_live_')).toBe(true)
    expect(created.prefix).toBe(created.token.slice(0, 17))

    const verified = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const registry = yield* ApiTokenRegistry
        return yield* registry.verifyBearerToken(created.token, 'read')
      })
    )
    expect(verified.workspaceSlug).toBe('live-lab')
    expect(verified.scopes).toEqual(['read', 'write'])

    const insufficientScope = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const registry = yield* ApiTokenRegistry
        return yield* Effect.flip(registry.verifyBearerToken(created.token, 'admin'))
      })
    )
    expect(insufficientScope.reason).toBe('insufficient_scope')

    const listed = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const registry = yield* ApiTokenRegistry
        return yield* registry.list
      })
    )
    const listedToken = listed.find((token) => token.id === created.id)
    expect(listedToken?.prefix).toBe(created.prefix)
    // The raw token is returned once at creation and never listed.
    expect(JSON.stringify(listed)).not.toContain(created.token)

    const revoked = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const registry = yield* ApiTokenRegistry
        return yield* registry.revoke({
          tokenId: created.id,
          actorUserId: 'usr_owner'
        })
      })
    )
    expect(revoked).toBe(true)

    const afterRevoke = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const registry = yield* ApiTokenRegistry
        return yield* Effect.flip(registry.verifyBearerToken(created.token, 'read'))
      })
    )
    expect(afterRevoke.reason).toBe('invalid_token')

    // Both mutations committed their audit rows atomically alongside the write.
    const events = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        return yield* audit.list
      })
    )
    const types = events.map((event) => event.eventType)
    expect(types).toContain('api_token.created')
    expect(types).toContain('api_token.revoked')
    expect(events.find((event) => event.eventType === 'api_token.created')?.actor).toBe(
      'Owner One'
    )
  })
})

describe('live audit event workspace isolation', () => {
  it("lists only the requesting workspace's events", async () => {
    await runIn(
      'other-lab',
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        yield* audit.record({
          workspaceId: 'wrk_other',
          eventType: 'isolation.check',
          targetType: 'test'
        })
      })
    )
    const liveEvents = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        return yield* audit.list
      })
    )
    expect(liveEvents.some((event) => event.eventType === 'isolation.check')).toBe(
      false
    )
    const otherEvents = await runIn(
      'other-lab',
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        return yield* audit.list
      })
    )
    expect(otherEvents.some((event) => event.eventType === 'isolation.check')).toBe(
      true
    )
  })
})

describe('live starter module catalog', () => {
  it('joins module state for the workspace with typed booleans', async () => {
    const modules = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        return yield* catalog.listModules
      })
    )
    const module = modules.find((candidate) => candidate.id === 'mod_live')
    expect(module?.state.status).toBe('ready')
    expect(module?.state.enabled).toBe(true)
  })
})

describe('live workspace membership projection', () => {
  it('lists memberships for a member and nothing for an outsider', async () => {
    const [forOwner, forOutsider] = await runIn(
      'live-lab',
      Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        return [
          yield* membership.listWorkspacesForUser('usr_owner'),
          yield* membership.listWorkspacesForUser('usr_outsider')
        ] as const
      })
    )
    expect(forOwner.map((entry) => entry.workspace.slug)).toContain('live-lab')
    expect(forOutsider).toEqual([])
  })
})

// Real-D1 coverage for the terminal-outcome audit contract: LiveWebhookEndpoints
// batches the audit insert with the delivery row, so these assert the actual
// audit_events rows rather than a stub's recorded inputs.
describe('live webhook delivery attempts', () => {
  beforeAll(async () => {
    await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(webhookEndpoints).values({
          id: 'wh_live',
          workspaceId: 'wrk_live',
          url: 'https://example.com/hook',
          signingSecret: 'whsec_live_test',
          enabled: true,
          events: ['demo.event'],
          createdAt: iso
        })
      })
    )
  })

  const recordAttempt = (input: WebhookDeliveryAttemptInput) =>
    runIn(
      'live-lab',
      Effect.flatMap(WebhookEndpoints, (webhooks) =>
        webhooks.recordDeliveryAttempt(input)
      )
    )

  const auditRowsFor = (eventType: string) =>
    runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.eventType, eventType))
      })
    )

  const auditEventCount = async () => {
    const rows = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db.select({ total: count() }).from(auditEvents)
      })
    )
    return rows[0]?.total ?? 0
  }

  it('batches a webhook.delivery_failed audit event with the terminal attempt row', async () => {
    await recordAttempt({
      id: 'whd_live_perm',
      endpointId: 'wh_live',
      workspaceId: 'wrk_live',
      eventType: 'demo.event',
      status: 'failed_permanent',
      attempts: 1,
      responseStatus: 410,
      nextAttemptAt: null
    })

    const deliveries = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, 'whd_live_perm'))
      })
    )
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.status).toBe('failed_permanent')

    const rows = await auditRowsFor('webhook.delivery_failed')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      workspaceId: 'wrk_live',
      actorUserId: null,
      targetType: 'webhook_endpoint',
      targetId: 'wh_live'
    })
    // The audit metadata points back at the delivery row it committed with.
    expect(rows[0]?.metadata).toMatchObject({
      deliveryId: 'whd_live_perm',
      eventType: 'demo.event',
      responseStatus: 410
    })
  })

  it('batches a webhook.delivery_dead_lettered audit event with the DLQ attempt row', async () => {
    await recordAttempt({
      endpointId: 'wh_live',
      workspaceId: 'wrk_live',
      eventType: 'demo.event',
      status: 'dead_lettered',
      attempts: 5,
      responseStatus: null,
      nextAttemptAt: null
    })

    const rows = await auditRowsFor('webhook.delivery_dead_lettered')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      workspaceId: 'wrk_live',
      actorUserId: null,
      targetType: 'webhook_endpoint',
      targetId: 'wh_live'
    })
    expect(rows[0]?.metadata).toMatchObject({ attempts: 5 })
  })

  it('writes a non-terminal delivered row without an audit event', async () => {
    const before = await auditEventCount()
    await recordAttempt({
      id: 'whd_live_ok',
      endpointId: 'wh_live',
      workspaceId: 'wrk_live',
      eventType: 'demo.event',
      status: 'delivered',
      attempts: 1,
      responseStatus: 200,
      nextAttemptAt: null
    })
    const after = await auditEventCount()
    expect(after).toBe(before)

    const deliveries = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, 'whd_live_ok'))
      })
    )
    expect(deliveries[0]?.status).toBe('delivered')
  })
})
