import { DateTime, Effect } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { type DeveloperPlatformContractCase } from './developer-platform.contract.ts'
import {
  completeWebhookHttpObservation,
  completeWebhookTerminalObservation
} from './webhook-attempt-completion.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'

function observation(eventType: string) {
  return Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    const ctx = yield* WorkspaceContext
    const { endpoint } = yield* webhooks.create({
      url: `https://example.com/${eventType}`,
      events: ['api_token.created']
    })
    return {
      message: {
        deliveryId: `whd_${eventType}`,
        endpointId: endpoint.id,
        workspaceId: ctx.workspace.id,
        eventType,
        payload: { event: eventType }
      },
      endpointUrl: endpoint.url,
      responseStatus: 503,
      attempts: 2,
      finishedAt: yield* DateTime.now,
      durationMs: 10,
      failureReason: 'Receiver unavailable',
      requestHeaders: {},
      responseBody: null
    }
  })
}

export function webhookCompletionCases(
  expect: ContractExpect
): ReadonlyArray<DeveloperPlatformContractCase> {
  return [
    {
      name: 'completion follows persisted results for duplicate and late HTTP observations',
      assert: Effect.gen(function* () {
        const input = yield* observation('completion_ordering')
        const webhooks = yield* WebhookEndpoints
        const audit = yield* AuditEventLog
        const feed = yield* NotificationFeed
        expect(yield* completeWebhookHttpObservation(input)).toEqual({
          status: 'failed',
          outcome: 'retry'
        })
        // Same ordinal already holds a retryable failure; a conflicting
        // duplicate cannot acknowledge it or emit a permanent-failure notice.
        expect(
          yield* completeWebhookHttpObservation({ ...input, responseStatus: 410 })
        ).toEqual({
          status: 'failed',
          outcome: 'retry'
        })
        expect(
          yield* completeWebhookHttpObservation({
            ...input,
            attempts: 3,
            responseStatus: 200
          })
        ).toEqual({
          status: 'delivered',
          outcome: 'ack'
        })
        expect(
          yield* completeWebhookHttpObservation({
            ...input,
            attempts: 1,
            responseStatus: 410
          })
        ).toEqual({
          status: 'delivered',
          outcome: 'ack'
        })
        const deliveries = yield* webhooks.listDeliveries({
          endpointId: input.message.endpointId
        })
        expect(deliveries[0]).toMatchObject({
          status: 'delivered',
          attempts: 3,
          responseStatus: 200,
          nextAttemptAt: null
        })
        expect(
          yield* webhooks.listDeliveryAttempts({ deliveryId: input.message.deliveryId })
        ).toHaveLength(3)
        expect(
          (yield* audit.list({ eventType: 'webhook.delivery_failed' })).items.filter(
            (row) => row.targetId === input.message.endpointId
          )
        ).toHaveLength(0)
        expect(
          (yield* feed.list).filter(
            (row) =>
              row.event?.type === 'webhook.permanent' &&
              row.event.eventType === input.message.eventType
          )
        ).toHaveLength(0)
      }).pipe(Effect.scoped)
    },
    {
      name: 'completion emits terminal notifications and audits once across redelivery',
      assert: Effect.gen(function* () {
        const input = yield* observation('completion_terminal')
        const webhooks = yield* WebhookEndpoints
        const audit = yield* AuditEventLog
        const feed = yield* NotificationFeed
        const refused = { ...input, responseStatus: 410 }
        yield* completeWebhookHttpObservation(refused)
        yield* completeWebhookHttpObservation(refused)
        expect(
          (yield* feed.list).filter(
            (row) =>
              row.event?.type === 'webhook.permanent' &&
              row.event.eventType === input.message.eventType
          )
        ).toHaveLength(1)
        expect(
          (yield* audit.list({ eventType: 'webhook.delivery_failed' })).items.filter(
            (row) => row.targetId === input.message.endpointId
          )
        ).toHaveLength(1)

        const queued = {
          ...input,
          message: {
            ...input.message,
            deliveryId: 'whd_completion_dlq',
            eventType: 'completion_dlq'
          },
          attempts: 6
        }
        yield* completeWebhookHttpObservation(queued)
        const terminal = {
          message: queued.message,
          attempts: 1,
          status: 'dead_lettered',
          failureReason: 'Queue retries exhausted',
          endpointUrl: null
        } satisfies Parameters<typeof completeWebhookTerminalObservation>[0]
        expect(yield* completeWebhookTerminalObservation(terminal)).toEqual({
          status: 'dead_lettered',
          outcome: 'ack'
        })
        yield* completeWebhookTerminalObservation(terminal)
        expect(
          (yield* webhooks.listDeliveries({
            endpointId: input.message.endpointId
          })).find((row) => row.id === queued.message.deliveryId)
        ).toMatchObject({ status: 'dead_lettered', attempts: 6, responseStatus: 503 })
        expect(
          (yield* feed.list).filter(
            (row) =>
              row.event?.type === 'webhook.dead_letter' &&
              row.event.eventType === 'completion_dlq'
          )
        ).toHaveLength(1)
        expect(
          (yield* audit.list({
            eventType: 'webhook.delivery_dead_lettered'
          })).items.filter((row) => row.targetId === input.message.endpointId)
        ).toHaveLength(1)
      }).pipe(Effect.scoped)
    },
    {
      name: 'notification failure cannot retry a settled webhook completion',
      assert: Effect.gen(function* () {
        const input = yield* observation('completion_notice_outage')
        const webhooks = yield* WebhookEndpoints
        const audit = yield* AuditEventLog
        const feed = yield* NotificationFeed
        const refused = { ...input, responseStatus: 410 }
        const result = yield* completeWebhookHttpObservation(refused).pipe(
          Effect.provideService(NotificationFeed, {
            ...feed,
            create: () =>
              Effect.fail(
                new CapabilityUnavailable({
                  capability: 'notifications',
                  reason: 'store unavailable'
                })
              )
          })
        )
        expect(result).toEqual({ status: 'failed_permanent', outcome: 'ack' })
        expect(
          (yield* webhooks.listDeliveries({ endpointId: input.message.endpointId }))[0]
        ).toMatchObject({ status: 'failed_permanent' })
        expect(
          (yield* audit.list({ eventType: 'webhook.delivery_failed' })).items.filter(
            (row) => row.targetId === input.message.endpointId
          )
        ).toHaveLength(1)
        yield* completeWebhookHttpObservation(refused)
        expect(
          (yield* feed.list).filter(
            (row) =>
              row.event?.type === 'webhook.permanent' &&
              row.event.eventType === input.message.eventType
          )
        ).toHaveLength(0)
      }).pipe(Effect.scoped)
    }
  ]
}
