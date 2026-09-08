// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vite-plus/test'
import { Effect, ManagedRuntime } from 'effect'
import {
  TestDatabase,
  TestD1
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { fixtureSession } from '@/test/fixture-session'
import type * as AuthModule from './auth'

// Only session lookup and Worker bindings are substituted. The handlers resolve
// membership and permissions through the production Live capabilities on local D1.
const actor = vi.hoisted(() => ({ userId: 'usr_owner' }))
vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))
const database = ManagedRuntime.make(TestDatabase)
function execute(sql: string, ...values: ReadonlyArray<string>) {
  return database.runPromise(
    Effect.flatMap(TestD1, (db) =>
      Effect.promise(() =>
        db
          .prepare(sql)
          .bind(...values)
          .run()
      )
    )
  )
}

beforeAll(async () => {
  const DB = await database.runPromise(TestD1)
  vi.doMock('cloudflare:workers', () => ({ env: { DB } }))
  await execute(`INSERT INTO workspace_members (id,workspaceId,userId,role) VALUES
    ('mem_isolation_other','wrk_other','usr_outsider','owner'),
    ('mem_isolation_multi_a','wrk_dev_contract','usr_joiner','owner'),
    ('mem_isolation_multi_b','wrk_other','usr_joiner','member')`)
  await execute(`INSERT INTO notifications (id,workspace_id,title,message,created_at) VALUES
    ('not_isolation_a','wrk_dev_contract','Own announcement','Own message','2026-01-01T00:00:00Z'),
    ('not_isolation_b','wrk_other','Private announcement','Foreign message','2026-01-01T00:00:00Z')`)
}, 120_000)
beforeEach(() => {
  actor.userId = 'usr_owner'
})
afterAll(async () => {
  await database.dispose()
})

describe('browser server handler Workspace isolation', () => {
  it('AC-2.1/AC-2.3: distinct users and a multi-Workspace user receive only their authorized page segments and counts', async () => {
    const { loadWorkspaceDashboardHandler: dashboard } =
      await import('./workspace-dashboard.effects')
    const { loadWorkspaceWebhooksHandler: webhooks } =
      await import('./webhooks.effects')
    const own = await dashboard({ workspaceSlug: 'dev-contract-lab' })
    expect(own.viewer).toEqual({ role: 'owner' })
    expect(own.notifications.map((notification) => notification.id)).toEqual([
      'not_isolation_a'
    ])
    expect(own.unreadCount).toBe(1)
    const missing = dashboard({ workspaceSlug: 'missing-lab' })
    await expect(missing).rejects.toEqual({ isNotFound: true })
    await expect(dashboard({ workspaceSlug: 'other-lab' })).rejects.toEqual({
      isNotFound: true
    })
    actor.userId = 'usr_outsider'
    const other = await dashboard({ workspaceSlug: 'other-lab' })
    expect(other.notifications.map((notification) => notification.id)).toEqual([
      'not_isolation_b'
    ])
    expect(other.unreadCount).toBe(1)
    await expect(dashboard({ workspaceSlug: 'dev-contract-lab' })).rejects.toEqual({
      isNotFound: true
    })
    actor.userId = 'usr_joiner'
    const fullAccess = await dashboard({ workspaceSlug: 'dev-contract-lab' })
    expect(fullAccess.viewer).toEqual({
      role: 'owner'
    })
    const limited = await dashboard({ workspaceSlug: 'other-lab' })
    expect(limited.viewer).toEqual({ role: 'member' })
    expect(limited.notifications.map((notification) => notification.id)).toEqual([
      'not_isolation_b'
    ])
    expect(limited).toMatchObject({
      webhooks: null,
      apiTokens: null,
      invitations: null,
      auditEvents: null,
      unreadCount: 1
    })
    await expect(webhooks({ workspaceSlug: 'other-lab' })).rejects.toMatchObject({
      name: 'ForbiddenError'
    })
  }, 120_000)

  it('AC-2.2/AC-2.3: foreign record IDs and slugs cannot mutate records, read secondary data, or add audit events', async () => {
    const webhooks = await import('./webhooks.effects')
    const { loadWorkspaceAuditEventsHandler: audit } =
      await import('./workspace-audit.effects')
    actor.userId = 'usr_outsider'
    const created = await webhooks.createWebhookEndpointHandler({
      workspaceSlug: 'other-lab',
      url: 'https://private.example/browser',
      events: ['api_token.created']
    })
    const foreignId = created.endpoint.id
    const before = await webhooks.loadWorkspaceWebhooksHandler({
      workspaceSlug: 'other-lab'
    })
    const auditBefore = await audit({ workspaceSlug: 'other-lab', filters: {} })
    expect(auditBefore.events.length).toBeGreaterThan(0)
    actor.userId = 'usr_owner'
    await expect(
      webhooks.updateWebhookEndpointHandler({
        workspaceSlug: 'other-lab',
        endpointId: foreignId,
        enabled: false
      })
    ).rejects.toEqual({ isNotFound: true })
    for (const endpointId of [foreignId, 'missing-endpoint']) {
      await expect(
        webhooks.updateWebhookEndpointHandler({
          workspaceSlug: 'dev-contract-lab',
          endpointId,
          enabled: false
        })
      ).rejects.toMatchObject({ _tag: 'WebhookEndpointNotFound' })
      await expect(
        webhooks.rotateWebhookSecretHandler({
          workspaceSlug: 'dev-contract-lab',
          endpointId
        })
      ).rejects.toMatchObject({ _tag: 'WebhookEndpointNotFound' })
      await expect(
        webhooks.sendTestEventHandler({ workspaceSlug: 'dev-contract-lab', endpointId })
      ).rejects.toMatchObject({ _tag: 'WebhookEndpointNotFound' })
    }
    const hiddenAudit = await audit({
      workspaceSlug: 'dev-contract-lab',
      filters: {},
      event: auditBefore.events[0]?.id ?? 'missing-event'
    })
    expect(hiddenAudit.selectedEvent).toBeNull()
    expect(hiddenAudit.events).toEqual([])
    expect(hiddenAudit.nextCursor).toBeNull()
    actor.userId = 'usr_outsider'
    expect(
      await webhooks.loadWorkspaceWebhooksHandler({ workspaceSlug: 'other-lab' })
    ).toEqual(before)
    expect(await audit({ workspaceSlug: 'other-lab', filters: {} })).toEqual(
      auditBefore
    )
    // A legitimate update proves the mutation can reach persistence.
    expect(
      await webhooks.updateWebhookEndpointHandler({
        workspaceSlug: 'other-lab',
        endpointId: foreignId,
        enabled: false
      })
    ).toMatchObject({ id: foreignId, enabled: false })
  }, 120_000)

  it('AC-2.2/AC-2.3: the same session observes role demotion and membership removal before reads and writes', async () => {
    const { loadWorkspaceDashboardHandler: dashboard } =
      await import('./workspace-dashboard.effects')
    const webhooks = await import('./webhooks.effects')
    actor.userId = 'usr_joiner'
    const created = await webhooks.createWebhookEndpointHandler({
      workspaceSlug: 'dev-contract-lab',
      url: 'https://own.example/browser',
      events: ['api_token.created']
    })
    await execute(
      `UPDATE workspace_members SET role='member' WHERE id='mem_isolation_multi_a'`
    )
    const demoted = await dashboard({ workspaceSlug: 'dev-contract-lab' })
    expect(demoted).toMatchObject({
      viewer: { role: 'member' },
      webhooks: null,
      apiTokens: null,
      invitations: null,
      auditEvents: null
    })
    await expect(
      webhooks.updateWebhookEndpointHandler({
        workspaceSlug: 'dev-contract-lab',
        endpointId: created.endpoint.id,
        enabled: false
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    await execute(`DELETE FROM workspace_members WHERE id='mem_isolation_multi_a'`)
    await expect(dashboard({ workspaceSlug: 'dev-contract-lab' })).rejects.toEqual({
      isNotFound: true
    })
    await expect(
      webhooks.rotateWebhookSecretHandler({
        workspaceSlug: 'dev-contract-lab',
        endpointId: created.endpoint.id
      })
    ).rejects.toEqual({ isNotFound: true })
    // Removing access to A does not remove this user's legitimate membership in B.
    const remainingAccess = await dashboard({ workspaceSlug: 'other-lab' })
    expect(remainingAccess.viewer).toEqual({
      role: 'member'
    })
    actor.userId = 'usr_owner'
    const page = await webhooks.loadWorkspaceWebhooksHandler({
      workspaceSlug: 'dev-contract-lab'
    })
    expect(
      page.endpoints.find((endpoint) => endpoint.id === created.endpoint.id)
    ).toMatchObject({ enabled: true, deliveries: [] })
  }, 120_000)
})
