import { DateTime, Effect, Layer } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  isTerminalDeliveryStatus,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT
} from './webhook-delivery-plan.ts'
import {
  planAdminReplay,
  type AdminReplaySource,
  type GlobalWebhookDelivery,
  WebhookDeliveryAdmin
} from './webhook-delivery-admin.ts'
import { seedDeliveryViewPage } from './webhook-delivery-view.ts'
import { WebhookPublisher } from './webhook-publisher.ts'
import { SeedWebhookStore, type SeedDeliveryRow } from './webhook-store.seed.ts'

export const SeedWebhookDeliveryAdmin: Layer.Layer<
  WebhookDeliveryAdmin,
  never,
  SeedWebhookStore | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookDeliveryAdmin)(
  Effect.gen(function* () {
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher
    const {
      endpoints,
      deliveries,
      workspaces: seedWorkspaces
    } = yield* SeedWebhookStore

    function globalDeliveryRow(row: SeedDeliveryRow): GlobalWebhookDelivery | null {
      const endpoint = endpoints.find((candidate) => candidate.id === row.endpointId)
      const workspace = seedWorkspaces.find(
        (candidate) => candidate.id === endpoint?.workspaceId
      )
      if (endpoint === undefined || workspace === undefined) {
        return null
      }
      return {
        id: row.id,
        endpointId: row.endpointId,
        endpointUrl: endpoint.url,
        endpointEnabled: endpoint.enabled,
        endpointConsecutiveFailures: endpoint.consecutiveFailures,
        endpointFailureLimitReached:
          endpoint.consecutiveFailures >= WEBHOOK_FAILURE_AUTO_DISABLE_AT,
        eventType: row.eventType,
        status: row.status,
        attempts: row.attempts,
        lastAttemptAt: row.lastAttemptAt,
        responseStatus: row.responseStatus,
        workspace
      }
    }

    function globalDeliveries(): Array<GlobalWebhookDelivery> {
      const rows: Array<GlobalWebhookDelivery> = []
      for (const delivery of deliveries) {
        if (isTerminalDeliveryStatus(delivery.status)) {
          const row = globalDeliveryRow(delivery)
          if (row !== null) {
            rows.push(row)
          }
        }
      }
      return rows
    }

    return {
      listGlobalDeliveries: (input) =>
        Effect.sync(() => seedDeliveryViewPage(globalDeliveries(), input)),
      replayDeliveryAsAdmin: Effect.fn('WebhookDeliveryAdmin.replayDeliveryAsAdmin')(
        function* (input) {
          const source = deliveries.find((row) => row.id === input.deliveryId)
          const endpoint = endpoints.find((row) => row.id === source?.endpointId)
          let replaySource: AdminReplaySource | undefined
          if (source && endpoint) {
            replaySource = {
              ...source,
              workspaceId: endpoint.workspaceId,
              enabled: endpoint.enabled
            }
          }
          const replay = yield* planAdminReplay(replaySource, input.actorUserId)
          // No ambient workspace identity: this is an explicitly attributed admin write.
          deliveries.push({
            ...replay.plan,
            id: replay.deliveryId,
            workspaceId: replay.workspaceId,
            lastAttemptAt: DateTime.formatIso(yield* DateTime.now),
            requestHeaders: null,
            responseBody: null
          })
          yield* audit.record(replay.auditEvent)
          yield* publisher.enqueue({
            endpointId: replay.plan.endpointId,
            workspaceId: replay.workspaceId,
            eventType: replay.plan.eventType,
            deliveryId: replay.deliveryId,
            payload: replay.plan.payload
          })
          return { deliveryId: replay.deliveryId }
        }
      )
    }
  })
)
