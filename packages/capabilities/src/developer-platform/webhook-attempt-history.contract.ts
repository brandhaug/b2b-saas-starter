import { WebhookDeliveryId, WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { type WebhookDeliveryAttemptInput } from './webhook-delivery-plan.ts'
import { Effect } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { type DeveloperPlatformContractCase } from './developer-platform.contract.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import { WebhookDeliveries } from './webhook-deliveries.ts'
import { WebhookDispatch } from './webhook-dispatch.ts'

export function webhookAttemptHistoryCases(
  expect: ContractExpect
): ReadonlyArray<DeveloperPlatformContractCase> {
  return [
    {
      name: 'terminal delivery state survives endpoint recovery and stays scoped to its workspace',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* service.create({
          url: 'https://example.com/settled-delivery',
          events: ['demo.event']
        })
        const identity = {
          deliveryId: WebhookDeliveryId.make('whd_settled'),
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id
        }
        expect(yield* dispatch.isDeliverySettled(identity)).toBe(false)
        yield* dispatch.recordDeliveryAttempt({
          id: identity.deliveryId,
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          attempts: 1,
          status: 'failed',
          payload: {}
        })
        expect(yield* dispatch.isDeliverySettled(identity)).toBe(false)
        yield* dispatch.recordTerminalDeliveryAttempt({
          ...identity,
          eventType: 'demo.event',
          attempts: 2,
          status: 'failed_permanent',
          failureReason: 'workspace_suspended',
          payload: {}
        })
        yield* service.update({ endpointId: endpoint.id, enabled: true })
        expect(yield* dispatch.isDeliverySettled(identity)).toBe(true)
        expect(
          yield* dispatch.isDeliverySettled({ ...identity, workspaceId: 'wrk_other' })
        ).toBe(false)
        expect(
          yield* dispatch.isDeliverySettled({
            ...identity,
            endpointId: WebhookEndpointId.make('wh_other')
          })
        ).toBe(false)
      })
    },
    {
      name: 'concurrent independent failures reach the atomic disable rung exactly once and re-enable remains effective',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const ctx = yield* WorkspaceContext
        const audit = yield* AuditEventLog
        const { endpoint } = yield* service.create({
          url: 'https://example.com/attempt-atomic',
          events: ['demo.event']
        })
        const base: WebhookDeliveryAttemptInput = {
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          status: 'failed',
          attempts: 1,
          responseStatus: 503,
          payload: {}
        }
        const results = yield* Effect.all(
          Array.from({ length: 20 }, (_, index) =>
            dispatch.recordDeliveryAttempt({
              ...base,
              id: WebhookDeliveryId.make(`whd_atomic_${index}`)
            })
          ),
          { concurrency: 'unbounded' }
        )
        expect(
          results.map((row) => row.consecutiveFailures).toSorted((a, b) => a - b)
        ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
        expect(
          yield* dispatch.getDispatchTarget(
            endpoint.id,
            ctx.workspace.id,
            WebhookDeliveryId.make('whd_atomic_19')
          )
        ).toBe(null)
        expect(
          (yield* audit.list({
            eventType: 'webhook_endpoint.auto_disabled'
          })).items.filter((row) => row.targetId === endpoint.id)
        ).toHaveLength(1)
        yield* service.update({ endpointId: endpoint.id, enabled: true })
        const duplicate = yield* dispatch.recordDeliveryAttempt({
          ...base,
          id: WebhookDeliveryId.make('whd_atomic_19')
        })
        expect(duplicate.recorded).toBe(false)
        expect(
          (yield* dispatch.getDispatchTarget(
            endpoint.id,
            ctx.workspace.id,
            WebhookDeliveryId.make('whd_atomic_19')
          )) !== null
        ).toBe(true)
        const terminal = yield* dispatch.recordTerminalDeliveryAttempt({
          ...base,
          deliveryId: WebhookDeliveryId.make('whd_atomic_19'),
          status: 'dead_lettered'
        })
        expect(terminal.recorded).toBe(true)
        expect(terminal.failureAction).toBe('silent')
        expect(terminal.consecutiveFailures).toBe(20)
        expect(
          (yield* dispatch.getDispatchTarget(
            endpoint.id,
            ctx.workspace.id,
            WebhookDeliveryId.make('whd_atomic_19')
          )) !== null
        ).toBe(true)
        expect(
          (yield* audit.list({
            eventType: 'webhook_endpoint.auto_disabled'
          })).items.filter((row) => row.targetId === endpoint.id)
        ).toHaveLength(1)
        yield* dispatch.recordDeliveryAttempt({
          ...base,
          id: WebhookDeliveryId.make('whd_atomic_after_reenable')
        })
        expect(
          yield* dispatch.getDispatchTarget(
            endpoint.id,
            ctx.workspace.id,
            WebhookDeliveryId.make('whd_atomic_after_reenable')
          )
        ).toBe(null)
        expect(
          (yield* audit.list({
            eventType: 'webhook_endpoint.auto_disabled'
          })).items.filter((row) => row.targetId === endpoint.id)
        ).toHaveLength(2)
      })
    },
    {
      name: 'independent success and failure update the streak in commit order',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* service.create({
          url: 'https://example.com/mixed-results',
          events: ['demo.event']
        })
        const base: WebhookDeliveryAttemptInput = {
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          status: 'failed',
          attempts: 1,
          payload: {}
        }
        yield* dispatch.recordDeliveryAttempt({
          ...base,
          id: WebhookDeliveryId.make('whd_mixed_prime')
        })
        const [success, failure] = yield* Effect.all(
          [
            dispatch.recordDeliveryAttempt({
              ...base,
              id: WebhookDeliveryId.make('whd_mixed_ok'),
              status: 'delivered'
            }),
            dispatch.recordDeliveryAttempt({
              ...base,
              id: WebhookDeliveryId.make('whd_mixed_fail')
            })
          ],
          { concurrency: 'unbounded' }
        )
        expect(success.consecutiveFailures).toBe(0)
        expect([1, 2].includes(failure.consecutiveFailures)).toBe(true)
        const unchanged = yield* dispatch.recordDeliveryAttempt({
          ...base,
          id: WebhookDeliveryId.make('whd_mixed_fail')
        })
        expect(unchanged.recorded).toBe(false)
        // A failure returning one committed after the reset. Returning two
        // means it committed first, and the success left the streak at zero.
        expect(unchanged.consecutiveFailures).toBe(2 - failure.consecutiveFailures)
      })
    },
    {
      name: 'retry preserves an original null payload and absent replay provenance',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const deliveryLog = yield* WebhookDeliveries
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* service.create({
          url: 'https://example.com/null-payload',
          events: ['demo.event']
        })
        const base = {
          id: WebhookDeliveryId.make('whd_null_payload'),
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event'
        }
        yield* dispatch.recordDeliveryAttempt({
          ...base,
          status: 'failed',
          attempts: 1,
          payload: null
        })
        yield* dispatch.recordDeliveryAttempt({
          ...base,
          status: 'delivered',
          attempts: 2,
          payload: { changed: true },
          replayedFrom: WebhookDeliveryId.make('unrelated')
        })
        const rows = yield* deliveryLog.listDeliveries({ endpointId: endpoint.id })
        expect(rows[0]?.payload).toBe(null)
        expect(rows[0]?.replayedFrom).toBe(null)
      })
    },
    {
      name: 'immutable attempts survive failure then success and concurrent duplicate processing',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const deliveryLog = yield* WebhookDeliveries
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* service.create({
          url: 'https://example.com/attempt-history',
          events: ['demo.event']
        })
        const base = {
          id: WebhookDeliveryId.make('whd_history_success'),
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          payload: { stable: true }
        }
        const failed: WebhookDeliveryAttemptInput = {
          ...base,
          status: 'failed',
          attempts: 1,
          responseStatus: 500,
          durationMs: 87,
          failureReason: 'http_500',
          responseBody: 'x'.repeat(3000)
        }
        const duplicates = yield* Effect.all(
          [
            dispatch.recordDeliveryAttempt(failed),
            dispatch.recordDeliveryAttempt(failed)
          ],
          { concurrency: 'unbounded' }
        )
        expect(duplicates.filter((result) => result.recorded)).toHaveLength(1)
        expect(duplicates.map((result) => result.consecutiveFailures)).toEqual([1, 1])
        const success = yield* dispatch.recordDeliveryAttempt({
          ...base,
          status: 'delivered',
          attempts: 3,
          responseStatus: 204,
          durationMs: 24
        })
        expect(success.consecutiveFailures).toBe(0)
        const stale = yield* dispatch.recordDeliveryAttempt({
          ...base,
          status: 'failed_permanent',
          attempts: 2,
          responseStatus: 410,
          durationMs: 32
        })
        expect(stale.recorded).toBe(false)
        expect(stale.status).toBe('delivered')
        expect(stale.consecutiveFailures).toBe(0)
        const history = yield* deliveryLog.listDeliveryAttempts({ deliveryId: base.id })
        expect(history.map((row) => row.attempts)).toEqual([1, 2, 3])
        expect(history[0]).toMatchObject({
          status: 'failed',
          durationMs: 87,
          failureReason: 'http_500'
        })
        expect(history[0]?.responseBody?.endsWith('… [truncated]')).toBe(true)
        expect(
          (yield* deliveryLog.listDeliveries({ endpointId: endpoint.id }))[0]
        ).toMatchObject({
          id: base.id,
          attempts: 3,
          status: 'delivered',
          responseStatus: 204
        })
        const audit = yield* AuditEventLog
        expect(
          (yield* audit.list({ eventType: 'webhook.delivery_failed' })).items.filter(
            (row) => row.targetId === endpoint.id
          )
        ).toHaveLength(0)
      })
    },
    {
      name: 'dead letter is a terminal observation of the existing delivery without another HTTP failure',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const deliveryLog = yield* WebhookDeliveries
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* service.create({
          url: 'https://example.com/attempt-terminal',
          events: ['demo.event']
        })
        const base = {
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          payload: { stable: true }
        }
        yield* Effect.all(
          Array.from({ length: 4 }, (_, index) =>
            dispatch.recordDeliveryAttempt({
              ...base,
              id: WebhookDeliveryId.make(`whd_history_prime_${index}`),
              status: 'failed',
              attempts: 1
            })
          ),
          { concurrency: 'unbounded' }
        )
        yield* dispatch.recordDeliveryAttempt({
          ...base,
          id: WebhookDeliveryId.make('whd_history_dlq'),
          status: 'failed',
          attempts: 7,
          responseStatus: 503,
          durationMs: 99,
          responseBody: 'unavailable'
        })
        const terminal: Parameters<typeof dispatch.recordTerminalDeliveryAttempt>[0] = {
          ...base,
          deliveryId: WebhookDeliveryId.make('whd_history_dlq'),
          status: 'dead_lettered',
          attempts: 1,
          failureReason: 'retries_exhausted'
        }
        const results = yield* Effect.all(
          [
            dispatch.recordTerminalDeliveryAttempt(terminal),
            dispatch.recordTerminalDeliveryAttempt({ ...terminal, attempts: 2 })
          ],
          { concurrency: 'unbounded' }
        )
        expect(results.filter((row) => row.recorded)).toHaveLength(1)
        expect(results.map((row) => row.consecutiveFailures)).toEqual([5, 5])
        expect(results.map((row) => row.failureAction)).toEqual(['silent', 'silent'])
        const history = yield* deliveryLog.listDeliveryAttempts({
          deliveryId: terminal.deliveryId
        })
        expect(history.map((row) => row.phase)).toEqual(['http', 'terminal'])
        expect(history.map((row) => row.attempts)).toEqual([7, 7])
        expect(history[1]).toMatchObject({
          durationMs: null,
          responseStatus: null,
          failureReason: 'retries_exhausted'
        })
        expect(
          (yield* deliveryLog.listDeliveries({ endpointId: endpoint.id })).find(
            (row) => row.id === terminal.deliveryId
          )
        ).toMatchObject({
          id: terminal.deliveryId,
          status: 'dead_lettered',
          responseStatus: 503,
          responseBody: 'unavailable',
          attempts: 7
        })
        const audit = yield* AuditEventLog
        expect(
          (yield* audit.list({
            eventType: 'webhook.delivery_dead_lettered'
          })).items.filter((row) => row.targetId === endpoint.id)
        ).toHaveLength(1)
        const replay = yield* deliveryLog.replayDelivery({
          deliveryId: terminal.deliveryId
        })
        expect(
          yield* deliveryLog.listDeliveryAttempts({ deliveryId: replay.deliveryId })
        ).toHaveLength(0)
        expect(
          (yield* deliveryLog.listDeliveries({ endpointId: endpoint.id })).find(
            (row) => row.id === replay.deliveryId
          )
        ).toMatchObject({
          replayedFrom: terminal.deliveryId,
          attempts: 0,
          payload: base.payload
        })
      })
    },
    {
      name: 'never-dispatched outcomes are recorded and foreign workspace writes create no evidence',
      assert: Effect.gen(function* () {
        const service = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const deliveryLog = yield* WebhookDeliveries
        const ctx = yield* WorkspaceContext
        const { endpoint } = yield* service.create({
          url: 'https://example.com/attempt-refused',
          events: ['demo.event']
        })
        const sent = yield* service.sendTestEvent({ endpointId: endpoint.id })
        const input: Parameters<typeof dispatch.recordTerminalDeliveryAttempt>[0] = {
          deliveryId: sent.deliveryId,
          endpointId: endpoint.id,
          workspaceId: ctx.workspace.id,
          eventType: 'demo.event',
          status: 'failed_permanent',
          attempts: 0,
          failureReason: 'invalid_url',
          payload: { stable: true }
        }
        const refused = yield* dispatch.recordTerminalDeliveryAttempt(input)
        expect(refused.consecutiveFailures).toBe(1)
        expect(
          (yield* deliveryLog.listDeliveryAttempts({ deliveryId: input.deliveryId }))[0]
        ).toMatchObject({
          phase: 'terminal',
          durationMs: null,
          requestHeaders: null,
          responseStatus: null,
          failureReason: 'invalid_url'
        })
        const foreign = yield* dispatch.recordTerminalDeliveryAttempt({
          ...input,
          deliveryId: WebhookDeliveryId.make('whd_history_foreign'),
          workspaceId: 'wrk_foreign'
        })
        expect(foreign.recorded).toBe(false)
        expect(
          yield* deliveryLog.listDeliveryAttempts({
            deliveryId: WebhookDeliveryId.make('whd_history_foreign')
          })
        ).toHaveLength(0)
        const visible = yield* deliveryLog
          .listDeliveryAttempts({ deliveryId: input.deliveryId })
          .pipe(
            Effect.provideService(WorkspaceContext, {
              ...ctx,
              workspace: { ...ctx.workspace, id: 'wrk_foreign' }
            })
          )
        expect(visible).toHaveLength(0)
      })
    }
  ]
}
