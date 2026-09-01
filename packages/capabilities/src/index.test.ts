import { layerFromD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer, Option } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { SeedLayer } from './layers.ts'
import { seedMembers, seedWorkspaceRecord, demoUserIdentity } from './seed-fixture.ts'
import { SeedWorkspaceInvitations } from './governance/workspace-invitations.seed.ts'
import {
  makeSeedRoster,
  SeedWorkspaceMembership
} from './governance/workspace-membership.ts'
import { LiveApiTokenRegistry } from './developer-platform/api-token-registry.live.ts'
import { SeedApiTokenRegistry } from './developer-platform/api-token-registry.seed.ts'
import {
  ApiTokenRegistry,
  LAST_USED_WRITE_INTERVAL_MS,
  SEED_API_TOKEN,
  SEED_READONLY_API_TOKEN,
  shouldBumpLastUsedAt
} from './developer-platform/api-token-registry.ts'
import { LiveWebhookEndpoints } from './developer-platform/webhook-endpoints.live.ts'
import { SeedWebhookEndpoints } from './developer-platform/webhook-endpoints.seed.ts'
import { WebhookEndpoints } from './developer-platform/webhook-endpoints.ts'
import {
  developerPlatformContractCases,
  planLimitContractCases
} from './developer-platform/developer-platform.contract.ts'
import {
  LiveWebhookPublisher,
  SeedWebhookPublisher
} from './developer-platform/webhook-publisher.ts'
import { selectCapabilitiesLayer, selectWorkspaceLayer } from './runtime.ts'
import {
  NotificationFeed,
  SeedNotificationFeed
} from './notifications/notification-feed.ts'
import { testWorkspaceContext, type Actor } from './workspace-context.ts'
import {
  SeedWorkspaceLifecycle,
  WorkspaceLifecycle
} from './governance/workspace-lifecycle.ts'
import { workspaceLifecycleContractCases } from './governance/workspace-lifecycle.contract.ts'
import {
  auditEventContractDataset,
  auditEventLogContractCases
} from './governance/audit-event-log.contract.ts'
import { Billing } from './billing/billing.ts'
import {
  AuditEventLog,
  LiveAuditEventLog,
  SeedAuditEventLog
} from './governance/audit-event-log.ts'
import { workspaceMembershipContractCases } from './governance/workspace-membership.contract.ts'
import { platformUserAdminContractCases } from './governance/platform-user-admin.contract.ts'
import {
  CONTRACT_EXPIRED_AT,
  workspaceInvitationsContractCases
} from './governance/workspace-invitations.contract.ts'
import {
  listWorkspacesForUser,
  workspaceDashboard,
  workspaceOverview
} from './workspace-projections.ts'

const seedWorkspaceLayer = Layer.merge(
  SeedLayer,
  testWorkspaceContext(seedWorkspaceRecord)
)

// The Live half of this same list runs in live-layers.test.ts. One contract,
// two adapters — capabilities invariant 4. Fresh fixture stores (empty token /
// endpoint lists, a dedicated audit-log instance) so cases never lean on the
// demo SeedLayer fixtures.
describe('seed developer-platform contract', () => {
  const auditLog = SeedAuditEventLog([])
  const publisher = SeedWebhookPublisher
  const layer = Layer.mergeAll(
    Layer.merge(auditLog, testWorkspaceContext(seedWorkspaceRecord)),
    SeedApiTokenRegistry([]).pipe(Layer.provide(auditLog), Layer.provide(publisher)),
    SeedWebhookEndpoints([]).pipe(Layer.provide(auditLog), Layer.provide(publisher))
  )
  for (const contractCase of developerPlatformContractCases(expect)) {
    it.effect(contractCase.name, () => contractCase.assert.pipe(Effect.provide(layer)))
  }
})

// The plan-limit gate needs a workspace whose plan actually caps the resource;
// the demo fixture sits on `team` (uncapped).
describe('seed developer-platform plan-limit contract', () => {
  const auditLog = SeedAuditEventLog([])
  const layer = Layer.mergeAll(
    auditLog,
    testWorkspaceContext({
      id: 'wrk_capped_seed',
      slug: 'capped-seed-lab',
      name: 'Capped Seed Lab',
      planId: 'starter'
    }),
    SeedApiTokenRegistry([]).pipe(
      Layer.provide(auditLog),
      Layer.provide(SeedWebhookPublisher)
    )
  )
  for (const contractCase of planLimitContractCases(expect)) {
    it.effect(contractCase.name, () => contractCase.assert.pipe(Effect.provide(layer)))
  }
})

describe('seed audit event log contract', () => {
  const workspaceId = 'wrk_audit_contract'
  const layer = Layer.merge(
    SeedAuditEventLog(auditEventContractDataset(workspaceId)),
    testWorkspaceContext({
      id: workspaceId,
      slug: 'audit-lab',
      name: 'Audit Lab',
      planId: 'team'
    })
  )
  const cases = auditEventLogContractCases(
    (input) => Effect.flatMap(AuditEventLog, (log) => log.list(input)),
    expect
  )
  for (const contractCase of cases) {
    it.effect(contractCase.name, () => contractCase.assert.pipe(Effect.provide(layer)))
  }
})

describe('starter capabilities', () => {
  // Billing's audit writes must land in the same fixture log every other
  // Seed adapter reads — a private instance would record events nothing
  // reads back (capabilities invariant 4).
  it.effect('seed billing audit events land in the shared fixture log', () =>
    Effect.gen(function* () {
      const billing = yield* Billing
      const applied = yield* billing.applyProviderEvent({
        workspaceId: seedWorkspaceRecord.id,
        planId: 'team'
      })
      expect(applied).toBe(true)
      const audit = yield* AuditEventLog
      const events = yield* audit.listGlobal
      expect(events.some((event) => event.eventType === 'billing.plan_changed')).toBe(
        true
      )
    }).pipe(Effect.provide(SeedLayer))
  )

  it.effect('counts unread notifications through the feed interface', () =>
    Effect.gen(function* () {
      const feed = yield* NotificationFeed
      const unread = yield* feed.unreadCount
      expect(unread).toBeGreaterThan(0)
    }).pipe(Effect.provide(seedWorkspaceLayer))
  )
})

describe('layer selection without D1', () => {
  it.effect('selects the seed layer for an identity-keyed read', () =>
    Effect.gen(function* () {
      const items = yield* listWorkspacesForUser('usr_martin')
      expect(items.map((item) => item.workspace.slug)).toContain('starter-lab')
    }).pipe(Effect.provide(selectCapabilitiesLayer({})))
  )

  it.effect('selects the seed workspace layer with fixture membership', () =>
    Effect.gen(function* () {
      const notifications = yield* Effect.flatMap(NotificationFeed, (feed) => feed.list)
      expect(notifications.length).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        selectWorkspaceLayer({}, seedWorkspaceRecord.slug, {
          userId: 'usr_demo'
        })
      )
    )
  )
})

describe('workspace read projections', () => {
  it.effect('assembles the overview from the capability services', () =>
    Effect.gen(function* () {
      const overview = yield* workspaceOverview
      expect(overview.workspace.slug).toBe('starter-lab')
      expect(overview.notifications.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(seedWorkspaceLayer))
  )

  it.effect(
    'pre-computes the dashboard aggregates consistently with its own data',
    () =>
      Effect.gen(function* () {
        const dashboard = yield* workspaceDashboard
        expect(dashboard.unreadCount).toBe(
          dashboard.notifications.filter((notification) => !notification.read).length
        )
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

type ExecutedQuery = { readonly sql: string; readonly params: ReadonlyArray<unknown> }

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
  readonly results: Array<never>
  readonly success: true
  readonly meta: typeof noRowsMeta
}

function makeFakeD1() {
  const executed: Array<ExecutedQuery> = []
  const batches: Array<Array<ExecutedQuery>> = []
  // A prepared statement is handed back to the driver as a `D1PreparedStatement`,
  // so the query it carries is remembered here rather than on the object.
  const queryOf = new WeakMap<D1Statement, ExecutedQuery>()
  function record(query: ExecutedQuery): EmptyD1Result {
    executed.push(query)
    return { results: [], success: true, meta: noRowsMeta }
  }
  function prepare(sql: string): D1Statement {
    function statement(params: ReadonlyArray<unknown>): D1Statement {
      function raw(options: { columnNames: true }): Promise<[Array<string>]>
      function raw(options?: { columnNames?: false }): Promise<Array<Array<unknown>>>
      function raw(options?: {
        columnNames?: boolean
      }): Promise<[Array<string>] | Array<Array<unknown>>> {
        executed.push({ sql, params })
        if (options?.columnNames === true) {
          return Promise.resolve([[]])
        }
        return Promise.resolve([])
      }
      const prepared: D1Statement = {
        bind: (...next: ReadonlyArray<unknown>) => statement(next),
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
          if (query === undefined) {
            return []
          }
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
        Layer.provide(LiveWebhookPublisher()),
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

describe('workspace list projection', () => {
  it.effect('lists the seed workspace with counts for a member', () =>
    Effect.gen(function* () {
      const items = yield* listWorkspacesForUser('usr_martin')
      expect(items).toHaveLength(1)
      const item = items[0]
      expect(item?.workspace.slug).toBe('starter-lab')
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

describe('seed platform user admin contract', () => {
  const cases = platformUserAdminContractCases(
    {
      existing: demoUserIdentity.id,
      outsider: 'usr_outsider',
      unknown: 'usr_stranger',
      workspaceId: seedWorkspaceRecord.id
    },
    expect
  )
  for (const contractCase of cases) {
    it.effect(contractCase.name, () =>
      contractCase.assert.pipe(Effect.provide(SeedLayer))
    )
  }
})

// The Live half of this same list runs in live-layers.test.ts.
describe('seed workspace invitations contract', () => {
  const accepter = { userId: 'usr_accepter', email: 'accepter@seed-invite.test' }
  const expired = {
    invitationId: 'inv_seed_expired',
    email: 'expired@seed-invite.test'
  }

  // Built here rather than reusing `seedWorkspaceLayer`, because the cases need
  // an already-expired invitation and the demo fixture should not carry one.
  // Membership and invitations share a roster for the same reason `layers.ts`
  // gives them one: accepting adds a member.
  const invitationLayer = Layer.unwrap(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster(seedMembers)
      return Layer.mergeAll(
        SeedWorkspaceInvitations({
          roster,
          workspace: seedWorkspaceRecord,
          seed: [
            {
              id: expired.invitationId,
              email: expired.email,
              role: 'member',
              status: 'pending',
              expiresAt: CONTRACT_EXPIRED_AT
            }
          ]
        }),
        SeedWorkspaceMembership(roster, seedWorkspaceRecord),
        testWorkspaceContext(seedWorkspaceRecord)
      )
    })
  )

  const cases = workspaceInvitationsContractCases(
    {
      emailFor: (slot) => `${slot}@seed-invite.test`,
      accepter,
      expired
    },
    expect
  )
  for (const contractCase of cases) {
    it.effect(contractCase.name, () =>
      contractCase.assert.pipe(Effect.provide(invitationLayer))
    )
  }
})

// The Live half of this same list runs in live-layers.test.ts.
describe('seed workspace lifecycle contract', () => {
  const cases = workspaceLifecycleContractCases(
    { creator: 'usr_newcomer', existingSlug: 'starter-lab' },
    expect
  )
  for (const contractCase of cases) {
    it.effect(contractCase.name, () =>
      contractCase.assert.pipe(Effect.provide(seedWorkspaceLayer))
    )
  }
})

// Deletion acts on whatever workspace the context resolves, so the seed
// adapter's delete coverage uses its own throwaway context rather than the
// shared fixture layer above.
describe('seed workspace lifecycle deletion', () => {
  const doomed = {
    id: 'wrk_doomed_seed',
    slug: 'doomed-lab',
    name: 'Doomed',
    planId: 'starter'
  }

  it.effect('removes a created workspace from its own context', () =>
    Effect.gen(function* () {
      const lifecycle = yield* WorkspaceLifecycle
      const created = yield* lifecycle.create({
        name: 'Doomed Lab',
        slug: 'created-doomed-lab',
        userId: 'usr_newcomer'
      })
      yield* Effect.provide(
        lifecycle.remove,
        testWorkspaceContext({ ...doomed, id: created.id, slug: created.slug })
      )
      // Creating again under the same slug now succeeds — the row is gone.
      const recreated = yield* lifecycle.create({
        name: 'Doomed Lab II',
        slug: created.slug,
        userId: 'usr_newcomer'
      })
      expect(recreated.slug).toBe(created.slug)
    }).pipe(Effect.provide(SeedWorkspaceLifecycle({ workspace: seedWorkspaceRecord })))
  )
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
      Layer.provide(LiveWebhookPublisher()),
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
