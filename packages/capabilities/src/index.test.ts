import { DateTime, Effect, Layer, Option } from 'effect'
import { describe, expect, it } from '@effect/vitest'
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
  SEED_READONLY_API_TOKEN,
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
import { workspaceMembershipContractCases } from './governance/workspace-membership.contract.ts'
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
  it.effect('exposes seed starter modules through the catalog interface', () =>
    Effect.gen(function* () {
      const catalog = yield* StarterModuleCatalog
      const modules = yield* catalog.listModules
      expect(modules.length).toBeGreaterThan(5)
    }).pipe(Effect.provide(seedWorkspaceLayer))
  )

  it.effect('counts unread notifications through the feed interface', () =>
    Effect.gen(function* () {
      const feed = yield* NotificationFeed
      const unread = yield* feed.unreadCount
      expect(unread).toBeGreaterThan(0)
    }).pipe(Effect.provide(seedWorkspaceLayer))
  )

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
  it.effect('assembles the overview from the capability services', () =>
    Effect.gen(function* () {
      const overview = yield* workspaceOverview
      expect(overview.workspace.slug).toBe('starter-lab')
      expect(overview.modules.length).toBeGreaterThan(5)
      expect(overview.readinessScore).toBe(
        computeReadinessScore(overview.modules.map((module) => module.state))
      )
    }).pipe(Effect.provide(seedWorkspaceLayer))
  )

  it.effect(
    'pre-computes the dashboard aggregates consistently with its own data',
    () =>
      Effect.gen(function* () {
        const dashboard = yield* workspaceDashboard
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
      }).pipe(Effect.provide(seedWorkspaceLayer))
  )
})

describe('seed bearer token verification', () => {
  function verify(token: string) {
    return Effect.gen(function* () {
      const registry = yield* ApiTokenRegistry
      return yield* registry.verifyBearerToken(token)
    }).pipe(Effect.provide(SeedLayer))
  }

  it.effect('accepts the documented seed fixture token', () =>
    Effect.gen(function* () {
      const verified = yield* verify(SEED_API_TOKEN)
      expect(verified.workspaceSlug).toBe('starter-lab')
      expect(verified.scopes).toContain('read')
      expect(verified.scopes).toContain('admin')
    })
  )

  // Verification answers "which token is this", never "may it do this" — the
  // narrow fixture proves the reported scopes are the token's own, not a
  // judgement about the request.
  it.effect('reports the read-only fixture token as read-only', () =>
    Effect.gen(function* () {
      const verified = yield* verify(SEED_READONLY_API_TOKEN)
      expect(verified.workspaceSlug).toBe('starter-lab')
      expect(verified.scopes).toEqual(['read'])
    })
  )

  it.effect('rejects any other token with AuthorizationDenied', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(verify('bsk_live_not_a_token'))
      expect(error._tag).toBe('AuthorizationDenied')
    })
  )
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

  function feedFor(actor?: Actor) {
    return Layer.merge(
      scopedFeed,
      testWorkspaceContext(seedWorkspaceRecord, actor ?? null)
    )
  }

  it.effect('shows broadcast plus own notifications to the actor', () =>
    Effect.gen(function* () {
      const feed = yield* NotificationFeed
      const list = yield* feed.list
      const unread = yield* feed.unreadCount
      expect(list.map((notification) => notification.id)).toEqual([
        'not_broadcast',
        'not_a_unread',
        'not_a_read'
      ])
      expect(unread).toBe(2)
    }).pipe(Effect.provide(feedFor(actorA)))
  )

  it.effect('shows only broadcast notifications without an actor', () =>
    Effect.gen(function* () {
      const feed = yield* NotificationFeed
      const list = yield* feed.list
      const unread = yield* feed.unreadCount
      expect(list.map((notification) => notification.id)).toEqual(['not_broadcast'])
      expect(unread).toBe(1)
    }).pipe(Effect.provide(feedFor()))
  )
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

  it.effect('overrides fixture module state with env-derived status', () =>
    Effect.gen(function* () {
      const catalog = yield* StarterModuleCatalog
      const modules = yield* catalog.listModules
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
    }).pipe(Effect.provide(layer))
  )

  it.effect('overrides integration surface status with env-derived status', () =>
    Effect.gen(function* () {
      const integrations = yield* IntegrationSurfaces
      const surfaces = yield* integrations.list
      const byProvider = new Map(surfaces.map((surface) => [surface.provider, surface]))
      // billing env present but not runtime-wired → attention, not ready.
      expect(byProvider.get('stripe')?.status).toBe('attention')
      expect(byProvider.get('github')?.status).toBe('needs-config')
      expect(byProvider.get('github')?.summary).toContain('GITHUB_CLIENT_ID')
      // turnstile has no env status in this run → fixture value retained.
      expect(byProvider.get('turnstile')?.status).toBe('disabled')
    }).pipe(Effect.provide(layer))
  )

  it.effect('leaves fixture state untouched when no env information is passed', () =>
    Effect.gen(function* () {
      const catalog = yield* StarterModuleCatalog
      const modules = yield* catalog.listModules
      const betterAuth = modules.find((module) => module.id === 'better-auth')
      expect(betterAuth?.state.status).toBe('needs-config')
    }).pipe(Effect.provide(selectWorkspaceLayer({}, seedWorkspaceRecord.slug)))
  )
})

type ExecutedQuery = { readonly sql: string; readonly params: readonly unknown[] }

/** The D1 binding type `layerFromD1` accepts — derived, never re-declared. */
type D1Binding = Parameters<typeof layerFromD1>[0]
type D1Statement = ReturnType<D1Binding['prepare']>

/** Empty-but-well-formed D1 result metadata for statements that match no row. */
const noRowsMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0
}

// Minimal fake D1 binding: records every executed statement and batch, and
// returns empty result sets. Enough to observe the SQL the Live layers run
// without standing up a real database. Members the effect-d1 driver never
// calls on this path (sessions, exec, dump) reject instead of pretending.
/** Shape the fake returns for `run`/`all`: no rows, success, empty metadata. */
type EmptyD1Result = {
  readonly results: never[]
  readonly success: true
  readonly meta: typeof noRowsMeta
}

function makeFakeD1() {
  const executed: ExecutedQuery[] = []
  const batches: ExecutedQuery[][] = []
  // A prepared statement is handed back to the driver as a `D1PreparedStatement`,
  // so the query it carries is remembered here rather than on the object.
  const queryOf = new WeakMap<D1Statement, ExecutedQuery>()
  function record(query: ExecutedQuery): EmptyD1Result {
    executed.push(query)
    return { results: [], success: true, meta: noRowsMeta }
  }
  function prepare(sql: string): D1Statement {
    function statement(params: readonly unknown[]): D1Statement {
      function raw(options: { columnNames: true }): Promise<[string[]]>
      function raw(options?: { columnNames?: false }): Promise<unknown[][]>
      function raw(options?: {
        columnNames?: boolean
      }): Promise<[string[]] | unknown[][]> {
        executed.push({ sql, params })
        if (options?.columnNames === true) return Promise.resolve([[]])
        return Promise.resolve([])
      }
      const prepared: D1Statement = {
        bind: (...next: readonly unknown[]) => statement(next),
        first: () => Promise.resolve(null),
        run: () => Promise.resolve(record({ sql, params })),
        all: () => Promise.resolve(record({ sql, params })),
        raw
      }
      queryOf.set(prepared, { sql, params })
      return prepared
    }
    return statement([])
  }
  const binding: D1Binding = {
    prepare,
    batch: (statements) => {
      batches.push(
        statements.flatMap((statement) => {
          const query = queryOf.get(statement)
          if (query === undefined) return []
          return [query]
        })
      )
      return Promise.resolve([])
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
    withSession: () => {
      throw new Error('fake D1: these tests never open a session')
    },
    dump: () => Promise.resolve(new ArrayBuffer(0))
  }
  return { binding, executed, batches }
}

describe('webhook endpoint workspace scoping', () => {
  const workspaceB = {
    id: 'wrk_b',
    slug: 'workspace-b',
    name: 'Workspace B',
    planId: 'starter'
  }

  function foreignEndpointLayer(fake: ReturnType<typeof makeFakeD1>) {
    return Layer.merge(
      LiveWebhookEndpoints.pipe(
        Layer.provide(LiveAuditEventLog),
        Layer.provide(layerFromD1(fake.binding))
      ),
      testWorkspaceContext(workspaceB)
    )
  }

  it.effect('does not mutate or audit another workspace´s endpoint', () => {
    const fake = makeFakeD1()
    return Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const disabled = yield* webhooks.disable({ endpointId: 'wh_belongs_to_a' })
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
    }).pipe(Effect.provide(foreignEndpointLayer(fake)))
  })

  it.effect('rotates no secret for another workspace´s endpoint', () => {
    const fake = makeFakeD1()
    return Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const rotated = yield* webhooks.rotateSecret({ endpointId: 'wh_belongs_to_a' })
      // No endpoint matched: no secret is returned and nothing was written.
      expect(Option.isNone(rotated)).toBe(true)
      expect(fake.batches).toHaveLength(0)
    }).pipe(Effect.provide(foreignEndpointLayer(fake)))
  })
})

describe('catalog refresh run recording', () => {
  it.effect('records a run and resolves the module count', () =>
    Effect.gen(function* () {
      const count = yield* runCatalogRefresh
      expect(count).toBeGreaterThan(5)
    }).pipe(Effect.provide(SeedLayer))
  )
})

describe('workspace list projection', () => {
  it.effect('lists the seed workspace with counts for a member', () =>
    Effect.gen(function* () {
      const items = yield* listWorkspacesForUser('usr_martin')
      expect(items).toHaveLength(1)
      const item = items[0]
      expect(item?.workspace.slug).toBe('starter-lab')
      expect(item?.moduleCount).toBeGreaterThan(5)
      expect(item?.memberCount).toBe(4)
      expect(item?.notificationCount).toBeGreaterThan(0)
    }).pipe(Effect.provide(SeedLayer))
  )

  it.effect('returns an empty list for a user with no memberships', () =>
    Effect.gen(function* () {
      const items = yield* listWorkspacesForUser('usr_stranger')
      expect(items).toEqual([])
    }).pipe(Effect.provide(SeedLayer))
  )
})

// The Live half of this same list runs in live-layers.test.ts. Two adapters,
// one contract — capabilities invariant 4.
describe('seed workspace membership contract', () => {
  const cases = workspaceMembershipContractCases(
    { member: 'usr_martin', newcomer: 'usr_newcomer', stranger: 'usr_stranger' },
    expect
  )
  for (const contractCase of cases) {
    it.effect(contractCase.name, () =>
      contractCase.assert.pipe(Effect.provide(seedWorkspaceLayer))
    )
  }
})

describe('bearer verification write throttling', () => {
  const nowMillis = Date.parse('2026-05-16T09:00:00.000Z')

  /** ISO timestamp `offsetMs` before the fixed `nowMillis` reference. */
  function isoBefore(offsetMs: number): string {
    return DateTime.formatIso(DateTime.makeUnsafe(nowMillis - offsetMs))
  }

  it('bumps lastUsedAt for never-used and stale tokens', () => {
    expect(shouldBumpLastUsedAt(null, nowMillis)).toBe(true)
    expect(shouldBumpLastUsedAt('not-a-timestamp', nowMillis)).toBe(true)
    expect(
      shouldBumpLastUsedAt(isoBefore(LAST_USED_WRITE_INTERVAL_MS), nowMillis)
    ).toBe(true)
  })

  it('skips the bump when lastUsedAt is fresher than the interval', () => {
    expect(shouldBumpLastUsedAt(isoBefore(0), nowMillis)).toBe(false)
    expect(
      shouldBumpLastUsedAt(isoBefore(LAST_USED_WRITE_INTERVAL_MS - 1000), nowMillis)
    ).toBe(false)
  })

  it.effect('performs no writes when verification fails', () => {
    const fake = makeFakeD1()
    const layer = LiveApiTokenRegistry.pipe(
      Layer.provide(LiveAuditEventLog),
      Layer.provide(layerFromD1(fake.binding))
    )

    return Effect.gen(function* () {
      const registry = yield* ApiTokenRegistry
      const error = yield* Effect.flip(registry.verifyBearerToken('bsk_live_unknown'))
      expect(error._tag).toBe('AuthorizationDenied')
      expect('reason' in error && error.reason).toBe('invalid_token')
      // Exactly the lookup ran — no lastUsedAt UPDATE, no audit insert.
      expect(fake.executed).toHaveLength(1)
      expect(fake.executed[0]?.sql.toLowerCase()).toContain('select')
      expect(fake.batches).toHaveLength(0)
    }).pipe(Effect.provide(layer))
  })
})
