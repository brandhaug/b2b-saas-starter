import { DateTime, Effect, Layer } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { DELIVERIES_PAGE_SIZE } from './webhook-delivery-plan.ts'
import { WebhookDeliveries, WebhookDeliveryNotFound } from './webhook-deliveries.ts'
import { WebhookPublisher } from './webhook-publisher.ts'
import { makeWebhookReplay } from './webhook-replay.ts'
import { SeedWebhookStore } from './webhook-store.seed.ts'

export const SeedWebhookDeliveries: Layer.Layer<
  WebhookDeliveries,
  never,
  SeedWebhookStore | AuditEventLog | WebhookPublisher
> = Layer.effect(WebhookDeliveries)(
  Effect.gen(function* () {
    const audit = yield* AuditEventLog
    const publisher = yield* WebhookPublisher
    const store = yield* SeedWebhookStore
    const { endpoints, deliveries, attempts, approvedDestinations, endpointFor } = store

    return {
      listDeliveryAttempts: Effect.fn('WebhookDeliveries.listDeliveryAttempts')(
        function* (input) {
          const ctx = yield* WorkspaceContext
          const delivery = deliveries.find((row) => row.id === input.deliveryId)
          if (!delivery || !endpointFor(delivery.endpointId, ctx.workspace.id)) {
            return []
          }
          return attempts
            .filter((row) => row.deliveryId === delivery.id)
            .toSorted(
              (a, b) => a.attempts - b.attempts || a.phase.localeCompare(b.phase)
            )
        }
      ),
      listDeliveries: Effect.fn('WebhookDeliveries.listDeliveries')(function* (input) {
        const ctx = yield* WorkspaceContext
        // Same join semantics as Live: the endpoint's owning workspace is
        // resolved from context, so a foreign endpoint id yields nothing.
        const owned = new Set<string>()
        for (const endpoint of endpoints) {
          if (endpoint.workspaceId === ctx.workspace.id) {
            owned.add(endpoint.id)
          }
        }
        const matched = deliveries.filter(
          (row) => row.endpointId === input.endpointId && owned.has(row.endpointId)
        )
        // `lastAttemptAt` DESC, row id DESC as the tie-break — a total
        // order, mirroring Live's orderBy so the shared contract can
        // assert the sequence on both adapters.
        const sorted = matched.toSorted((a, b) => {
          if ((a.lastAttemptAt ?? '') > (b.lastAttemptAt ?? '')) {
            return -1
          }
          if ((a.lastAttemptAt ?? '') < (b.lastAttemptAt ?? '')) {
            return 1
          }
          if (a.id > b.id) {
            return -1
          }
          if (a.id < b.id) {
            return 1
          }
          return 0
        })
        return sorted
          .slice(0, DELIVERIES_PAGE_SIZE)
          .map(({ workspaceId: _ws, ...row }) => row)
      }),
      inspectDelivery: Effect.fn('WebhookDeliveries.inspectDelivery')(
        function* (input) {
          const ctx = yield* WorkspaceContext
          const delivery = deliveries.find((row) => row.id === input.deliveryId)
          if (!delivery) {
            return yield* new WebhookDeliveryNotFound({
              deliveryId: input.deliveryId
            })
          }
          const endpoint = endpointFor(delivery.endpointId, ctx.workspace.id)
          if (!endpoint) {
            return yield* new WebhookDeliveryNotFound({ deliveryId: input.deliveryId })
          }
          return {
            endpoint: store.projection(endpoint),
            delivery: { ...delivery },
            attempts: attempts.filter((row) => row.deliveryId === delivery.id)
          }
        }
      ),
      replayDelivery: makeWebhookReplay(
        {
          source: (deliveryId, workspaceId) =>
            Effect.sync(() => {
              const source = deliveries.find(
                (row) =>
                  row.id === deliveryId &&
                  endpointFor(row.endpointId, workspaceId) !== null
              )
              if (!source) {
                return null
              }
              const endpoint = endpointFor(source.endpointId, workspaceId)
              if (!endpoint) {
                return null
              }
              return {
                ...source,
                enabled: endpoint.enabled,
                endpointUrl: endpoint.url
              }
            }),
          reserve: (input) =>
            Effect.gen(function* () {
              const now = DateTime.formatIso(yield* DateTime.now)
              const inserted = yield* Effect.sync(() => {
                if (deliveries.some((row) => row.id === input.deliveryId)) {
                  return false
                }
                deliveries.push({
                  ...input.plan,
                  id: input.deliveryId,
                  workspaceId: input.workspaceId,
                  lastAttemptAt: now,
                  requestHeaders: null,
                  responseBody: null
                })
                if (input.approvedEndpointUrl !== undefined) {
                  approvedDestinations.set(input.deliveryId, input.approvedEndpointUrl)
                }
                return true
              })
              if (inserted) {
                yield* audit.record(input.auditEvent)
              }
              const reserved = deliveries.find((row) => row.id === input.deliveryId)
              if (!reserved) {
                return null
              }
              return {
                ...reserved,
                approvedEndpointUrl: approvedDestinations.get(input.deliveryId) ?? null
              }
            })
        },
        publisher
      )
    }
  })
)
