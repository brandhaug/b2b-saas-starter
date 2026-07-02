import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { computeReadinessScore } from './catalog/adoption-readiness.ts'
import { runCatalogRefresh } from './catalog/catalog-refresh-history.ts'
import { SeedLayer } from './layers.ts'
import { seedWorkspaceRecord } from './seed-fixture.ts'
import { StarterModuleCatalog } from './catalog/starter-module-catalog.ts'
import {
  ApiTokenRegistry,
  LAST_USED_WRITE_INTERVAL_MS,
  LiveApiTokenRegistry,
  SEED_API_TOKEN,
  shouldBumpLastUsedAt
} from './developer-platform/api-token-registry.ts'
import {
  LiveWebhookEndpoints,
  WebhookEndpoints
} from './developer-platform/webhook-endpoints.ts'
import { IntegrationSurfaces } from './notifications/integration-surfaces.ts'
import { selectWorkspaceLayer } from './runtime.ts'
import { LiveAuditEventLog } from './governance/audit-event-log.ts'
import {
  NotificationFeed,
  SeedNotificationFeed
} from './notifications/notification-feed.ts'
import { testWorkspaceContext, type Actor } from './workspace-context.ts'
import {
  listWorkspacesForUser,
  workspaceDashboard,
  workspaceOverview
} from './workspace-projections.ts'

const seedWorkspaceLayer = Layer.merge(
  SeedLayer,
  testWorkspaceContext(seedWorkspaceRecord)
)

describe('starter capabilities', () => {
  it('exposes seed starter modules through the catalog interface', async () => {
    const modules = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        return yield* catalog.listModules
      }).pipe(Effect.provide(seedWorkspaceLayer))
    )
    expect(modules.length).toBeGreaterThan(5)
  })

  it('counts unread notifications through the feed interface', async () => {
    const unread = await Effect.runPromise(
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return yield* feed.unreadCount
      }).pipe(Effect.provide(seedWorkspaceLayer))
    )
    expect(unread).toBeGreaterThan(0)
  })

  it('derives readiness from module state', () => {
    const score = computeReadinessScore([
      {
        moduleId: 'a',
        enabled: true,
        status: 'ready',
        missingConfig: [],
        updatedAt: ''
      },
      {
        moduleId: 'b',
        enabled: true,
        status: 'needs-config',
        missingConfig: [],
        updatedAt: ''
      }
    ])
    expect(score).toBe(50)
  })
})

describe('workspace read projections', () => {
  it('assembles the overview from the capability services', async () => {
    const overview = await Effect.runPromise(
      workspaceOverview.pipe(Effect.provide(seedWorkspaceLayer))
    )
    expect(overview.workspace.slug).toBe('starter-lab')
    expect(overview.modules.length).toBeGreaterThan(5)
    expect(overview.readinessScore).toBe(
      computeReadinessScore(overview.modules.map((module) => module.state))
    )
  })

  it('pre-computes the dashboard aggregates consistently with its own data', async () => {
    const dashboard = await Effect.runPromise(
      workspaceDashboard.pipe(Effect.provide(seedWorkspaceLayer))
    )
    const statusTotal = dashboard.moduleStatusCounts.reduce(
      (sum, entry) => sum + entry.count,
      0
    )
    expect(statusTotal).toBe(dashboard.modules.length)
    expect(dashboard.readyCount).toBe(
      dashboard.modules.filter((module) => module.state.status === 'ready').length
    )
    expect(dashboard.unreadCount).toBe(
      dashboard.notifications.filter((notification) => !notification.read).length
    )
    expect(dashboard.webhooks.length).toBeGreaterThan(0)
    expect(dashboard.refreshRuns.length).toBeGreaterThan(0)
  })
})

describe('seed bearer token verification', () => {
  const verify = (token: string) =>
    Effect.gen(function* () {
      const registry = yield* ApiTokenRegistry
      return yield* registry.verifyBearerToken(token, 'read')
    }).pipe(Effect.provide(SeedLayer))

  it('accepts the documented seed fixture token', async () => {
    const verified = await Effect.runPromise(verify(SEED_API_TOKEN))
    expect(verified.workspaceSlug).toBe('starter-lab')
    expect(verified.scopes).toContain('read')
    expect(verified.scopes).toContain('admin')
  })

  it('rejects any other token with AuthorizationDenied', async () => {
    const error = await Effect.runPromise(Effect.flip(verify('bsk_live_not_a_token')))
    expect(error._tag).toBe('AuthorizationDenied')
  })
})

describe('notification feed actor scoping', () => {
  const base = { message: 'm', createdAt: '2026-05-16T09:00:00.000Z' }
  const scopedFeed = SeedNotificationFeed([
    { id: 'not_broadcast', title: 'broadcast', read: false, ...base },
    { id: 'not_a_unread', title: 'for a', read: false, userId: 'usr_a', ...base },
    { id: 'not_a_read', title: 'for a, read', read: true, userId: 'usr_a', ...base },
    { id: 'not_b_unread', title: 'for b', read: false, userId: 'usr_b', ...base }
  ])
  const actorA: Actor = { userId: 'usr_a', role: 'member', systemRole: 'user' }

  const feedFor = (actor?: Actor) =>
    Layer.merge(scopedFeed, testWorkspaceContext(seedWorkspaceRecord, actor ?? null))

  it('shows broadcast plus own notifications to the actor', async () => {
    const [list, unread] = await Effect.runPromise(
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return [yield* feed.list, yield* feed.unreadCount] as const
      }).pipe(Effect.provide(feedFor(actorA)))
    )
    expect(list.map((notification) => notification.id)).toEqual([
      'not_broadcast',
      'not_a_unread',
      'not_a_read'
    ])
    expect(unread).toBe(2)
  })

  it('shows only broadcast notifications without an actor', async () => {
    const [list, unread] = await Effect.runPromise(
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return [yield* feed.list, yield* feed.unreadCount] as const
      }).pipe(Effect.provide(feedFor()))
    )
    expect(list.map((notification) => notification.id)).toEqual(['not_broadcast'])
    expect(unread).toBe(1)
  })
})

describe('module env status overlay', () => {
  const layer = selectWorkspaceLayer(
    {
      moduleConfig: [
        { moduleId: 'better-auth', configured: true, envPresent: true, missing: [] },
        {
          moduleId: 'cloudflare-email',
          configured: false,
          envPresent: false,
          missing: ['CLOUDFLARE_EMAIL_FROM']
        },
        // env present but the runtime isn't wired yet (runtimeWired: false)
        { moduleId: 'billing', configured: false, envPresent: true, missing: [] },
        {
          moduleId: 'github-oauth',
          configured: false,
          envPresent: false,
          missing: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']
        }
      ]
    },
    seedWorkspaceRecord.slug
  )

  it('overrides fixture module state with env-derived status', async () => {
    const modules = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        return yield* catalog.listModules
      }).pipe(Effect.provide(layer))
    )
    const byId = new Map(modules.map((module) => [module.id, module.state]))
    // Seed fixture says needs-config; env says fully configured.
    expect(byId.get('better-auth')?.status).toBe('ready')
    expect(byId.get('better-auth')?.missingConfig).toEqual([])
    // Env is missing → needs-config with the redacted var names.
    expect(byId.get('cloudflare-email')?.status).toBe('needs-config')
    expect(byId.get('cloudflare-email')?.missingConfig).toEqual([
      'CLOUDFLARE_EMAIL_FROM'
    ])
    // No env mapping → fixture state passes through untouched.
    expect(byId.get('tanstack-start')?.status).toBe('ready')
  })

  it('overrides integration surface status with env-derived status', async () => {
    const surfaces = await Effect.runPromise(
      Effect.gen(function* () {
        const integrations = yield* IntegrationSurfaces
        return yield* integrations.list
      }).pipe(Effect.provide(layer))
    )
    const byProvider = new Map(surfaces.map((surface) => [surface.provider, surface]))
    // billing env present but not runtime-wired → attention, not ready.
    expect(byProvider.get('stripe')?.status).toBe('attention')
    expect(byProvider.get('github')?.status).toBe('needs-config')
    expect(byProvider.get('github')?.summary).toContain('GITHUB_CLIENT_ID')
    // turnstile has no env status in this run → fixture value retained.
    expect(byProvider.get('turnstile')?.status).toBe('disabled')
  })

  it('leaves fixture state untouched when no env information is passed', async () => {
    const modules = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        return yield* catalog.listModules
      }).pipe(Effect.provide(selectWorkspaceLayer({}, seedWorkspaceRecord.slug)))
    )
    const betterAuth = modules.find((module) => module.id === 'better-auth')
    expect(betterAuth?.state.status).toBe('needs-config')
  })
})

type ExecutedQuery = { readonly sql: string; readonly params: readonly unknown[] }

// Minimal fake D1 binding: records every executed statement and batch, and
// returns empty result sets. Enough to observe the SQL the Live layers run
// without standing up a real database.
const makeFakeD1 = () => {
  const executed: ExecutedQuery[] = []
  const batches: ExecutedQuery[][] = []
  const prepare = (sql: string) => {
    const statement = (params: readonly unknown[]) => ({
      sql,
      params,
      bind: (...next: readonly unknown[]) => statement(next),
      all: async () => {
        executed.push({ sql, params })
        return { results: [] }
      },
      raw: async () => {
        executed.push({ sql, params })
        return []
      }
    })
    return statement([])
  }
  const binding = {
    prepare,
    batch: async (statements: readonly ExecutedQuery[]) => {
      batches.push(statements.map(({ sql, params }) => ({ sql, params })))
      return []
    }
  }
  return {
    binding: binding as unknown as Parameters<typeof layerFromD1>[0],
    executed,
    batches
  }
}

describe('webhook endpoint workspace scoping', () => {
  const workspaceB = {
    id: 'wrk_b',
    slug: 'workspace-b',
    name: 'Workspace B',
    planId: 'starter'
  }

  const foreignEndpointLayer = (fake: ReturnType<typeof makeFakeD1>) =>
    Layer.merge(
      LiveWebhookEndpoints.pipe(
        Layer.provide(LiveAuditEventLog),
        Layer.provide(layerFromD1(fake.binding))
      ),
      testWorkspaceContext(workspaceB)
    )

  it('does not mutate or audit another workspace´s endpoint', async () => {
    const fake = makeFakeD1()

    const disabled = await Effect.runPromise(
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        return yield* webhooks.disable({ endpointId: 'wh_belongs_to_a' })
      }).pipe(Effect.provide(foreignEndpointLayer(fake)))
    )

    // No matching endpoint in this workspace — signalled to the caller…
    expect(disabled).toBe(false)
    // …the existence lookup must be scoped to the calling workspace…
    expect(fake.executed).toHaveLength(1)
    const lookup = fake.executed[0]
    expect(lookup?.sql).toContain('workspace_id')
    expect(lookup?.params).toContain(workspaceB.id)
    expect(lookup?.params).toContain('wh_belongs_to_a')
    // …and with no matching row, neither the UPDATE nor the audit insert runs.
    expect(fake.batches).toHaveLength(0)
  })

  it('rotates no secret for another workspace´s endpoint', async () => {
    const fake = makeFakeD1()

    const rotated = await Effect.runPromise(
      Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        return yield* webhooks.rotateSecret({ endpointId: 'wh_belongs_to_a' })
      }).pipe(Effect.provide(foreignEndpointLayer(fake)))
    )

    // No endpoint matched: no secret is returned and nothing was written.
    expect(Option.isNone(rotated)).toBe(true)
    expect(fake.batches).toHaveLength(0)
  })
})

describe('catalog refresh run recording', () => {
  it('records a run and resolves the module count', async () => {
    const count = await Effect.runPromise(
      runCatalogRefresh.pipe(Effect.provide(SeedLayer))
    )
    expect(count).toBeGreaterThan(5)
  })
})

describe('workspace list projection', () => {
  it('lists the seed workspace with counts for a member', async () => {
    const items = await Effect.runPromise(
      listWorkspacesForUser('usr_martin').pipe(Effect.provide(SeedLayer))
    )
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item?.workspace.slug).toBe('starter-lab')
    expect(item?.moduleCount).toBeGreaterThan(5)
    expect(item?.memberCount).toBe(3)
    expect(item?.notificationCount).toBeGreaterThan(0)
  })

  it('returns an empty list for a user with no memberships', async () => {
    const items = await Effect.runPromise(
      listWorkspacesForUser('usr_stranger').pipe(Effect.provide(SeedLayer))
    )
    expect(items).toEqual([])
  })
})

describe('bearer verification write throttling', () => {
  it('bumps lastUsedAt for never-used and stale tokens', () => {
    const now = Date.parse('2026-05-16T09:00:00.000Z')
    expect(shouldBumpLastUsedAt(null, now)).toBe(true)
    expect(shouldBumpLastUsedAt('not-a-timestamp', now)).toBe(true)
    expect(
      shouldBumpLastUsedAt(
        new Date(now - LAST_USED_WRITE_INTERVAL_MS).toISOString(),
        now
      )
    ).toBe(true)
  })

  it('skips the bump when lastUsedAt is fresher than the interval', () => {
    const now = Date.parse('2026-05-16T09:00:00.000Z')
    expect(shouldBumpLastUsedAt(new Date(now).toISOString(), now)).toBe(false)
    expect(
      shouldBumpLastUsedAt(
        new Date(now - LAST_USED_WRITE_INTERVAL_MS + 1_000).toISOString(),
        now
      )
    ).toBe(false)
  })

  it('performs no writes when verification fails', async () => {
    const fake = makeFakeD1()
    const layer = LiveApiTokenRegistry.pipe(
      Layer.provide(LiveAuditEventLog),
      Layer.provide(layerFromD1(fake.binding))
    )

    const error = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          const registry = yield* ApiTokenRegistry
          return yield* registry.verifyBearerToken('bsk_live_unknown', 'read')
        }).pipe(Effect.provide(layer))
      )
    )

    expect(error._tag).toBe('AuthorizationDenied')
    expect('reason' in error && error.reason).toBe('invalid_token')
    // Exactly the lookup ran — no lastUsedAt UPDATE, no audit insert.
    expect(fake.executed).toHaveLength(1)
    expect(fake.executed[0]?.sql.toLowerCase()).toContain('select')
    expect(fake.batches).toHaveLength(0)
  })
})
