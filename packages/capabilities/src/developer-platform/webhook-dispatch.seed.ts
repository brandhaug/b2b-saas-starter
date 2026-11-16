import { WebhookDeliveryId } from '@b2b-saas-starter/db/ids'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { DateTime, Effect, Layer } from 'effect'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { bestEffort } from '../internal/best-effort.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  attemptEvidence,
  type WebhookAttemptObservation
} from './webhook-attempt-history.ts'
import {
  activeSigningSecrets,
  readSigningSecretRotation,
  deadLetteredDeliveryStatus,
  deadLetterNotification,
  failedPermanentDeliveryStatus,
  failureLadderAction,
  isDispatchableDeliveryStatus,
  isSettledDeliveryStatus,
  nextConsecutiveFailures,
  pendingDeliveryStatus,
  terminalDeliveryAuditEventType,
  WEBHOOK_FAILURE_AUTO_DISABLE_AT
} from './webhook-delivery-plan.ts'
import { WebhookDispatch, type RecordedWebhookAttempt } from './webhook-dispatch.ts'
import { SeedWebhookStore, type SeedDeliveryRow } from './webhook-store.seed.ts'

export const SeedWebhookDispatch: Layer.Layer<
  WebhookDispatch,
  never,
  SeedWebhookStore | AuditEventLog | NotificationFeed | ResourceEntitlements
> = Layer.effect(WebhookDispatch)(
  Effect.gen(function* () {
    const audit = yield* AuditEventLog
    const feed = yield* NotificationFeed
    const entitlements = yield* ResourceEntitlements
    const { deliveries, attempts, approvedDestinations, endpointFor } =
      yield* SeedWebhookStore

    const recordAttempt = Effect.fn('WebhookDispatch.recordAttempt')(function* (
      observation: WebhookAttemptObservation
    ) {
      const input = observation.input
      let deliveryId: WebhookDeliveryId
      if (observation.kind === 'queued_terminal') {
        deliveryId = observation.input.id
      } else {
        deliveryId =
          input.id ??
          (yield* newCapabilityId('whd').pipe(
            Effect.map((id) => WebhookDeliveryId.make(id))
          ))
      }
      const attemptedAt = DateTime.formatIso(yield* DateTime.now)
      const id = yield* newCapabilityId('wha')
      const evidence = attemptEvidence(input)
      const endpoint = endpointFor(input.endpointId, input.workspaceId)
      if (!endpoint) {
        return {
          deliveryId,
          recorded: false,
          failureAction: 'silent',
          status: failedPermanentDeliveryStatus,
          consecutiveFailures: 0
        } satisfies RecordedWebhookAttempt & {
          readonly deliveryId: WebhookDeliveryId
        }
      }
      const index = deliveries.findIndex((row) => row.id === deliveryId)
      const previous = deliveries[index]
      // Queue observations may only advance a delivery reserved by the
      // producer. Never create a replayable row from an untrusted queue id.
      if (!previous && observation.kind === 'queued_terminal') {
        return {
          deliveryId,
          recorded: false,
          failureAction: 'silent',
          status: failedPermanentDeliveryStatus,
          consecutiveFailures: endpoint.consecutiveFailures
        } satisfies RecordedWebhookAttempt & {
          readonly deliveryId: WebhookDeliveryId
        }
      }
      if (
        (previous && previous.endpointId !== input.endpointId) ||
        attempts.some(
          (row) =>
            row.deliveryId === deliveryId &&
            row.phase === evidence.phase &&
            (evidence.phase === 'terminal' || row.attempts === input.attempts)
        )
      ) {
        return {
          deliveryId,
          recorded: false,
          failureAction: 'silent',
          status: previous?.status ?? failedPermanentDeliveryStatus,
          consecutiveFailures: endpoint.consecutiveFailures
        } satisfies RecordedWebhookAttempt & {
          readonly deliveryId: WebhookDeliveryId
        }
      }
      let ordinal = input.attempts
      if (evidence.phase === 'terminal') {
        ordinal = Math.max(ordinal, previous?.attempts ?? 0)
      }
      attempts.push({
        id,
        deliveryId,
        attempts: ordinal,
        status: input.status,
        attemptedAt,
        ...evidence
      })
      // The Seed mirror of the Live acceptance guard: only dispatchable
      // rows advance (`dispatchableDeliveryStatuses` in webhook-delivery-plan.ts).
      const advances =
        !previous ||
        (isDispatchableDeliveryStatus(previous.status) &&
          (evidence.phase === 'terminal' ||
            previous.status === pendingDeliveryStatus ||
            previous.attempts < input.attempts))
      if (!advances) {
        return {
          deliveryId,
          recorded: false,
          failureAction: 'silent',
          status: previous.status,
          consecutiveFailures: endpoint.consecutiveFailures
        } satisfies RecordedWebhookAttempt & {
          readonly deliveryId: WebhookDeliveryId
        }
      }
      let responseStatus = evidence.responseStatus
      let requestHeaders = evidence.requestHeaders
      let responseBody = evidence.responseBody
      if (evidence.phase === 'terminal') {
        responseStatus = previous?.responseStatus ?? null
        requestHeaders = previous?.requestHeaders ?? null
        responseBody = previous?.responseBody ?? null
      }
      let payload = input.payload
      let replayedFrom = input.replayedFrom ?? null
      if (previous) {
        payload = previous.payload
        replayedFrom = previous.replayedFrom
      }
      const row: SeedDeliveryRow = {
        id: deliveryId,
        endpointId: input.endpointId,
        workspaceId: input.workspaceId,
        eventType: previous?.eventType ?? input.eventType,
        status: input.status,
        attempts: ordinal,
        lastAttemptAt: attemptedAt,
        nextAttemptAt: input.nextAttemptAt ?? null,
        responseStatus,
        requestHeaders,
        responseBody,
        payload,
        replayedFrom
      }
      if (index === -1) {
        deliveries.push(row)
      } else {
        deliveries[index] = row
      }
      const countsFailure =
        evidence.phase === 'http' ||
        !attempts.some(
          (attempt) => attempt.deliveryId === deliveryId && attempt.phase === 'http'
        )
      if (countsFailure) {
        endpoint.consecutiveFailures = nextConsecutiveFailures(
          endpoint.consecutiveFailures,
          input.status
        )
      }
      const consecutiveFailures = endpoint.consecutiveFailures
      const disabled =
        countsFailure &&
        endpoint.enabled &&
        endpoint.consecutiveFailures >= WEBHOOK_FAILURE_AUTO_DISABLE_AT
      if (disabled) {
        endpoint.enabled = false
      }
      const eventType = terminalDeliveryAuditEventType.get(input.status)
      if (eventType !== undefined) {
        yield* audit.record({
          workspaceId: input.workspaceId,
          actorType: 'system',
          eventType,
          targetType: 'webhook_endpoint',
          targetId: input.endpointId,
          metadata: {
            deliveryId,
            eventType: row.eventType,
            queueAttempts: input.attempts,
            responseStatus: evidence.responseStatus
          }
        })
      }
      if (disabled) {
        yield* audit.record({
          workspaceId: input.workspaceId,
          actorType: 'system',
          eventType: 'webhook_endpoint.auto_disabled',
          targetType: 'webhook_endpoint',
          targetId: input.endpointId,
          metadata: { deliveryId }
        })
      }
      if (input.status === deadLetteredDeliveryStatus) {
        yield* bestEffort(
          feed.create({
            workspaceId: input.workspaceId,
            userId: null,
            kind: 'webhook.delivery_failed',
            ...deadLetterNotification({
              eventType: row.eventType,
              attempts: ordinal,
              url: endpoint.url
            })
          }),
          () => ({ webhookDeadLetterNotification: 'failed', deliveryId })
        )
      }
      let failureAction: 'silent' | 'warn' | 'disable' = 'silent'
      if (countsFailure) {
        failureAction = failureLadderAction(consecutiveFailures)
      }
      return {
        deliveryId,
        recorded: true,
        failureAction,
        status: input.status,
        consecutiveFailures
      } satisfies RecordedWebhookAttempt & { readonly deliveryId: WebhookDeliveryId }
    })

    return {
      isDeliverySettled: (input) =>
        Effect.sync(() => {
          if (!endpointFor(input.endpointId, input.workspaceId)) {
            return false
          }
          return deliveries.some(
            (delivery) =>
              delivery.id === input.deliveryId &&
              delivery.endpointId === input.endpointId &&
              isSettledDeliveryStatus(delivery.status)
          )
        }),
      getDispatchTarget: (endpointId, workspaceId, deliveryId) =>
        Effect.gen(function* () {
          const endpoint = endpointFor(endpointId, workspaceId)
          if (
            !endpoint ||
            !endpoint.enabled ||
            (approvedDestinations.has(deliveryId) &&
              approvedDestinations.get(deliveryId) !== endpoint.url)
          ) {
            return null
          }
          const queued = deliveries.find(
            (delivery) =>
              delivery.id === deliveryId &&
              delivery.endpointId === endpointId &&
              delivery.workspaceId === workspaceId
          )
          if (!queued) {
            return null
          }
          const allowed = yield* entitlements.isActiveForWorkspace({
            workspaceId,
            resource: 'webhook_endpoint',
            resourceId: endpoint.id
          })
          if (!allowed) {
            return null
          }
          return {
            id: endpoint.id,
            url: endpoint.url,
            signingSecrets: activeSigningSecrets(
              readSigningSecretRotation(endpoint),
              yield* DateTime.now
            ),
            eventType: queued.eventType,
            payload: queued.payload
          }
        }),
      recordDeliveryAttempt: (input) =>
        recordAttempt({ kind: 'trusted_attempt', input }),
      recordTerminalDeliveryAttempt: (input) =>
        // Terminal observations require an existing producer-owned row.
        recordAttempt({
          kind: 'queued_terminal',
          input: {
            ...input,
            id: input.deliveryId,
            phase: 'terminal',
            nextAttemptAt: null
          }
        })
    }
  })
)
