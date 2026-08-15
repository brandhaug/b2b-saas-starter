import { Effect, Layer } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
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
import { provisionTestD1 } from '@b2b-saas-starter/db/testing'
import { ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import {
  WebhookEndpoints,
  type WebhookDeliveryAttemptInput
} from './developer-platform/webhook-endpoints.ts'
import { AuditEventLog } from './governance/audit-event-log.ts'
import { WorkspaceMembership } from './governance/workspace-membership.ts'
import { StarterModuleCatalog } from './catalog/starter-module-catalog.ts'
import {
  CatalogRefreshHistory,
  LiveCatalogRefreshHistory
} from './catalog/catalog-refresh-history.ts'
import { makeLiveCapabilitiesLayer, type CapabilityServices } from './layers.ts'
import { liveWorkspaceContext, WorkspaceContext } from './workspace-context.ts'
import type { CapabilityUnavailable, WorkspaceNotFound } from './errors.ts'

// Live-layer coverage against a real local D1 (all migrations applied). The
// Seed-layer tests in index.test.ts validate contracts; these validate that
// the D1 adapters — queries, batches, workspace scoping — behave the same.

const iso = '2026-07-03T09:00:00.000Z'

/** Workspaces, members, and one starter module every test in this file reads. */
const insertFixtureRows = Effect.gen(function* () {
  const db = yield* Database
  yield* db.insert(user).values([
    { id: 'usr_owner', email: 'owner@live.test', name: 'Owner One' },
    { id: 'usr_outsider', email: 'outsider@live.test', name: 'Outsider' }
  ])
  // `workspaces` and `workspace_members` are owned by the organization plugin:
  // their timestamps default to epoch integers, and a member row carries a
  // surrogate id rather than a composite key.
  yield* db.insert(workspaces).values([
    { id: 'wrk_live', slug: 'live-lab', name: 'Live Lab' },
    { id: 'wrk_other', slug: 'other-lab', name: 'Other Lab' }
  ])
  yield* db.insert(workspaceMembers).values({
    id: 'mem_live_owner',
    workspaceId: 'wrk_live',
    userId: 'usr_owner',
    role: 'owner'
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
  // The endpoint the webhook delivery-attempt suite records attempts against.
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

/**
 * The provisioned D1 is this file's fixture: acquired once and released when
 * the test layer's scope closes, so no test lifecycle hooks are needed.
 */
const TestDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const provisioned = yield* Effect.acquireRelease(
      Effect.promise(() => provisionTestD1()),
      (testD1) => Effect.promise(() => testD1.dispose())
    )
    const database = layerFromD1(provisioned.d1)
    yield* insertFixtureRows.pipe(Effect.provide(database))
    return database
  })
)

/** Runs an effect against the live capability layers of one workspace. */
function inWorkspace<A, E>(
  slug: string,
  effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>,
  actor?: { readonly userId: string }
): Effect.Effect<A, E | WorkspaceNotFound | CapabilityUnavailable, Database> {
  return Effect.provide(
    effect,
    Layer.merge(makeLiveCapabilitiesLayer(), liveWorkspaceContext(slug, actor))
  )
}

layer(TestDatabase, { timeout: '120 seconds' })('live capability layers', (it) => {
  describe('live workspace context', () => {
    it.effect('resolves the workspace and actor for a member', () =>
      Effect.gen(function* () {
        const ctx = yield* inWorkspace('live-lab', WorkspaceContext, {
          userId: 'usr_owner'
        })
        expect(ctx.workspace.id).toBe('wrk_live')
        expect(ctx.actor?.role).toBe('owner')
      })
    )

    it.effect('fails with WorkspaceNotFound for an unknown slug', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace('no-such-workspace', WorkspaceContext)
        )
        expect(error._tag).toBe('WorkspaceNotFound')
      })
    )

    it.effect('fails identically for a non-member actor (non-disclosing)', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          inWorkspace('live-lab', WorkspaceContext, { userId: 'usr_outsider' })
        )
        expect(error._tag).toBe('WorkspaceNotFound')
      })
    )
  })

  describe('live api token lifecycle', () => {
    it.effect('creates, verifies, lists, revokes, and audits a token', () =>
      Effect.gen(function* () {
        const created = yield* inWorkspace(
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

        const verified = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* registry.verifyBearerToken(created.token, 'read')
          })
        )
        expect(verified.workspaceSlug).toBe('live-lab')
        expect(verified.scopes).toEqual(['read', 'write'])

        const insufficientScope = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* Effect.flip(
              registry.verifyBearerToken(created.token, 'admin')
            )
          })
        )
        expect(insufficientScope.reason).toBe('insufficient_scope')

        const listed = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* registry.list
          })
        )
        const listedToken = listed.find((token) => token.id === created.id)
        expect(listedToken?.prefix).toBe(created.prefix)
        // The raw token is returned once at creation and never listed.
        const listedValues = listed.flatMap((token) => Object.values(token).flat())
        expect(listedValues).not.toContain(created.token)

        const revoked = yield* inWorkspace(
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

        const afterRevoke = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const registry = yield* ApiTokenRegistry
            return yield* Effect.flip(registry.verifyBearerToken(created.token, 'read'))
          })
        )
        expect(afterRevoke.reason).toBe('invalid_token')

        // Both mutations committed their audit rows atomically alongside the write.
        const events = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          })
        )
        const types = events.map((event) => event.eventType)
        expect(types).toContain('api_token.created')
        expect(types).toContain('api_token.revoked')
        expect(
          events.find((event) => event.eventType === 'api_token.created')?.actor
        ).toBe('Owner One')
      })
    )
  })

  describe('live audit event workspace isolation', () => {
    it.effect("lists only the requesting workspace's events", () =>
      Effect.gen(function* () {
        yield* inWorkspace(
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
        const liveEvents = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            return yield* audit.list
          })
        )
        expect(liveEvents.some((event) => event.eventType === 'isolation.check')).toBe(
          false
        )
        const otherEvents = yield* inWorkspace(
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
    )
  })

  describe('live starter module catalog', () => {
    it.effect('joins module state for the workspace with typed booleans', () =>
      Effect.gen(function* () {
        const modules = yield* inWorkspace(
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
    )
  })

  describe('live catalog refresh history', () => {
    it.effect('records a run and reads it back with a weekday label', () =>
      Effect.gen(function* () {
        const history = yield* CatalogRefreshHistory
        yield* history.recordRun({
          label: 'derived on read',
          status: 'ok',
          modules: 3,
          durationMs: 42,
          startedAt: iso
        })
        const runs = yield* history.listRecent
        const run = runs.find((candidate) => candidate.startedAt === iso)
        expect(run?.status).toBe('ok')
        expect(run?.modules).toBe(3)
        expect(run?.durationMs).toBe(42)
        // The label is derived from the stored start date, not from the input.
        expect(run?.label).toBe('Fri')
      }).pipe(Effect.provide(LiveCatalogRefreshHistory))
    )
  })

  describe('live workspace membership projection', () => {
    it.effect('lists memberships for a member and nothing for an outsider', () =>
      Effect.gen(function* () {
        const memberships = yield* inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const membership = yield* WorkspaceMembership
            return {
              forOwner: yield* membership.listWorkspacesForUser('usr_owner'),
              forOutsider: yield* membership.listWorkspacesForUser('usr_outsider')
            }
          })
        )
        expect(memberships.forOwner.map((entry) => entry.workspace.slug)).toContain(
          'live-lab'
        )
        expect(memberships.forOutsider).toEqual([])
      })
    )
  })

  // Real-D1 coverage for the terminal-outcome audit contract: LiveWebhookEndpoints
  // batches the audit insert with the delivery row, so these assert the actual
  // audit_events rows rather than a stub's recorded inputs.
  describe('live webhook delivery attempts', () => {
    function recordAttempt(input: WebhookDeliveryAttemptInput) {
      return inWorkspace(
        'live-lab',
        Effect.flatMap(WebhookEndpoints, (webhooks) =>
          webhooks.recordDeliveryAttempt(input)
        )
      )
    }

    function auditRowsFor(eventType: string) {
      return Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.eventType, eventType))
      })
    }

    const auditEventCount = Effect.gen(function* () {
      const db = yield* Database
      const rows = yield* db.select({ total: count() }).from(auditEvents)
      return rows[0]?.total ?? 0
    })

    function deliveryRow(deliveryId: string) {
      return Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, deliveryId))
      })
    }

    it.effect(
      'batches a webhook.delivery_failed audit event with the terminal attempt row',
      () =>
        Effect.gen(function* () {
          yield* recordAttempt({
            id: 'whd_live_perm',
            endpointId: 'wh_live',
            workspaceId: 'wrk_live',
            eventType: 'demo.event',
            status: 'failed_permanent',
            attempts: 1,
            responseStatus: 410,
            nextAttemptAt: null
          })

          const deliveries = yield* deliveryRow('whd_live_perm')
          expect(deliveries).toHaveLength(1)
          expect(deliveries[0]?.status).toBe('failed_permanent')

          const rows = yield* auditRowsFor('webhook.delivery_failed')
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
    )

    it.effect(
      'batches a webhook.delivery_dead_lettered audit event with the DLQ attempt row',
      () =>
        Effect.gen(function* () {
          yield* recordAttempt({
            endpointId: 'wh_live',
            workspaceId: 'wrk_live',
            eventType: 'demo.event',
            status: 'dead_lettered',
            attempts: 5,
            responseStatus: null,
            nextAttemptAt: null
          })

          const rows = yield* auditRowsFor('webhook.delivery_dead_lettered')
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({
            workspaceId: 'wrk_live',
            actorUserId: null,
            targetType: 'webhook_endpoint',
            targetId: 'wh_live'
          })
          expect(rows[0]?.metadata).toMatchObject({ attempts: 5 })
        })
    )

    it.effect('writes a non-terminal delivered row without an audit event', () =>
      Effect.gen(function* () {
        const before = yield* auditEventCount
        yield* recordAttempt({
          id: 'whd_live_ok',
          endpointId: 'wh_live',
          workspaceId: 'wrk_live',
          eventType: 'demo.event',
          status: 'delivered',
          attempts: 1,
          responseStatus: 200,
          nextAttemptAt: null
        })
        const after = yield* auditEventCount
        expect(after).toBe(before)

        const deliveries = yield* deliveryRow('whd_live_ok')
        expect(deliveries[0]?.status).toBe('delivered')
      })
    )
  })
})
