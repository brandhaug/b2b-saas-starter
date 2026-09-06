import { Effect, Exit } from 'effect'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { walkKeysetPages } from '../internal/keyset-cursor.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import { type SeedDeliveryFixture } from './webhook-endpoints.seed.ts'

// Both adapters receive these rows, including nullable attempt times and ties.
export const adminDeliveryFixtures = [
  {
    id: 'whd_admin_z',
    endpointId: 'wh_admin_a',
    workspaceId: 'wrk_live',
    eventType: 'demo.event',
    status: 'dead_lettered',
    attempts: 6,
    lastAttemptAt: '2026-09-01T00:00:00.000Z',
    responseStatus: 503,
    payload: { nested: { original: ['verbatim', 42] } }
  },
  {
    id: 'whd_admin_y',
    endpointId: 'wh_admin_b',
    workspaceId: 'wrk_other',
    eventType: 'demo.event',
    status: 'failed_permanent',
    attempts: 1,
    lastAttemptAt: '2026-09-01T00:00:00.000Z',
    responseStatus: 410,
    payload: { other: true }
  },
  {
    id: 'whd_admin_null_z',
    endpointId: 'wh_admin_b',
    workspaceId: 'wrk_other',
    eventType: 'demo.event',
    status: 'dead_lettered',
    attempts: 1,
    lastAttemptAt: null,
    responseStatus: null,
    payload: {}
  },
  {
    id: 'whd_admin_null_a',
    endpointId: 'wh_admin_a',
    workspaceId: 'wrk_live',
    eventType: 'demo.event',
    status: 'failed_permanent',
    attempts: 1,
    lastAttemptAt: null,
    responseStatus: null,
    payload: {}
  },
  {
    id: 'whd_admin_ok',
    endpointId: 'wh_admin_a',
    workspaceId: 'wrk_live',
    eventType: 'demo.event',
    status: 'delivered',
    attempts: 1,
    lastAttemptAt: '2026-09-02T00:00:00.000Z',
    responseStatus: 200,
    payload: {}
  },
  {
    id: 'whd_admin_retry',
    endpointId: 'wh_admin_a',
    workspaceId: 'wrk_live',
    eventType: 'demo.event',
    status: 'failed',
    attempts: 1,
    lastAttemptAt: '2026-09-02T00:00:00.000Z',
    responseStatus: 503,
    payload: {}
  }
] satisfies ReadonlyArray<SeedDeliveryFixture>

export function adminWebhookContract(expect: ContractExpect) {
  return Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    const log = yield* AuditEventLog
    const walk = yield* walkKeysetPages(
      (input) => webhooks.listGlobalDeliveries(input),
      { limit: 1 }
    )
    expect(walk.exhausted).toBe(true)
    expect(walk.items.map((row) => row.id)).toEqual([
      'whd_admin_z',
      'whd_admin_y',
      'whd_admin_null_z',
      'whd_admin_null_a'
    ])
    expect(walk.items.map((row) => row.workspace.id)).toEqual([
      'wrk_live',
      'wrk_other',
      'wrk_other',
      'wrk_live'
    ])
    const first = yield* webhooks.listGlobalDeliveries({ limit: 2 })
    expect(first.items.map((row) => row.id)).toEqual(['whd_admin_z', 'whd_admin_y'])
    const last = yield* webhooks.listGlobalDeliveries({
      limit: 2,
      cursor: first.nextCursor ?? undefined
    })
    expect(last.items.map((row) => row.id)).toEqual([
      'whd_admin_null_z',
      'whd_admin_null_a'
    ])
    expect(last.nextCursor).toBe(null)
    expect((yield* webhooks.listGlobalDeliveries({ limit: 0 })).items).toHaveLength(1)
    expect(yield* webhooks.listGlobalDeliveries({ cursor: 'invalid' })).toEqual({
      items: [],
      nextCursor: null
    })

    const replay = yield* webhooks.replayDeliveryAsAdmin({
      deliveryId: 'whd_admin_z',
      actorUserId: 'usr_sysadmin'
    })
    expect(replay.deliveryId === 'whd_admin_z').toBe(false)
    // Replay neither changes nor removes the terminal source.
    expect((yield* webhooks.listGlobalDeliveries()).items).toEqual(walk.items)
    const audits = yield* log.listGlobal
    expect(
      audits.filter((row) => row.eventType === 'webhook.delivery_replayed')
    ).toHaveLength(1)
    expect(
      audits.find((row) => row.eventType === 'webhook.delivery_replayed')?.actorType
    ).toBe('user')

    for (const deliveryId of [
      'missing',
      'whd_admin_ok',
      'whd_admin_retry',
      replay.deliveryId
    ]) {
      const refused = yield* Effect.exit(
        webhooks.replayDeliveryAsAdmin({ deliveryId, actorUserId: 'usr_sysadmin' })
      )
      expect(failureTag(refused)).toBe('WebhookDispatchRejected')
    }
    yield* Effect.forEach(
      Array.from({ length: 20 }, (_, index) => index),
      (index) =>
        webhooks.recordDeliveryAttempt({
          id: `whd_admin_disable_${index}`,
          endpointId: 'wh_admin_b',
          workspaceId: 'wrk_other',
          eventType: 'demo.event',
          status: 'failed',
          attempts: 1,
          payload: {}
        })
    )
    const disabled = yield* Effect.exit(
      webhooks.replayDeliveryAsAdmin({
        deliveryId: 'whd_admin_y',
        actorUserId: 'usr_sysadmin'
      })
    )
    expect(Exit.isFailure(disabled)).toBe(true)
    expect(failureTag(disabled)).toBe('WebhookDispatchRejected')
    const afterRefusals = yield* log.listGlobal
    expect(
      afterRefusals.filter((row) => row.eventType === 'webhook.delivery_replayed')
    ).toHaveLength(1)
    return replay
  })
}
