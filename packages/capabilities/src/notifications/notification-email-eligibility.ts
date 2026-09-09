import { EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Context, Effect, Layer, Result } from 'effect'

import { WorkspaceSuspensionService } from '../governance/workspace-suspension.ts'
import { isAllowedDuringWorkspaceSuspension } from './notification-events.ts'
import {
  NotificationFeed,
  type DigestCandidate,
  type DigestWindow,
  type NotificationEmailContext
} from './notification-feed.ts'
import { NotificationPreferences } from './notification-preferences.ts'
import {
  type NotificationChannel,
  type NotificationKind
} from './notification-kinds.ts'

export type InstantNotificationEmailInput = {
  readonly notificationId: string
  readonly recipientUserId: string
}

export type InstantNotificationEmailDecision =
  | {
      readonly _tag: 'deliver'
      readonly context: NotificationEmailContext
    }
  | {
      readonly _tag: 'skip'
      readonly reason:
        | 'not_deliverable'
        | 'workspace_suspended'
        | `channel_${NotificationChannel}`
    }

export type DigestNotificationEmailSelection = {
  /** All unread, visible candidates that passed workspace policy. */
  readonly candidateCount: number
  /** The subset selected by each recipient's current digest preference. */
  readonly candidates: ReadonlyArray<DigestCandidate>
  readonly suspendedCount: number
}

export type NotificationEmailEligibilityInterface = {
  /** Re-read one queued notification and settle every non-send outcome. */
  readonly instant: (
    input: InstantNotificationEmailInput
  ) => Effect.Effect<InstantNotificationEmailDecision, CapabilityUnavailable>
  /** Re-read a digest window and settle suspended items durably. */
  readonly digest: (
    window: DigestWindow
  ) => Effect.Effect<DigestNotificationEmailSelection, CapabilityUnavailable>
}

export class NotificationEmailEligibility extends Context.Service<
  NotificationEmailEligibility,
  NotificationEmailEligibilityInterface
>()('@b2b-saas-starter/capabilities/NotificationEmailEligibility') {}

function notificationDeliveryId(
  notificationId: string,
  recipientUserId: string
): string {
  return `notification:${notificationId}:${recipientUserId}`
}

function digestSuppressionId(
  until: string,
  notificationId: string,
  recipientUserId: string
): string {
  return `digest-suppressed:${until}:${notificationId}:${recipientUserId}`
}

export const make: Effect.Effect<
  NotificationEmailEligibilityInterface,
  never,
  | NotificationFeed
  | NotificationPreferences
  | WorkspaceSuspensionService
  | EmailDelivery
> = Effect.gen(function* () {
  const feed = yield* NotificationFeed
  const preferences = yield* NotificationPreferences
  const suspension = yield* WorkspaceSuspensionService
  const delivery = yield* EmailDelivery

  const instant = Effect.fn('NotificationEmailEligibility.instant')(function* (
    input: InstantNotificationEmailInput
  ): Effect.fn.Return<InstantNotificationEmailDecision, CapabilityUnavailable> {
    const context = yield* feed.loadForEmail(
      input.notificationId,
      input.recipientUserId
    )
    if (context === null) {
      yield* delivery.abandon(
        notificationDeliveryId(input.notificationId, input.recipientUserId)
      )
      return { _tag: 'skip', reason: 'not_deliverable' }
    }

    // Account security notices have no workspace and remain deliverable. A
    // queued workspace notice is settled here so reactivation cannot replay it.
    if (
      !isAllowedDuringWorkspaceSuspension(context.notification) &&
      context.workspace !== null
    ) {
      const allowed = yield* Effect.result(
        suspension.requireAllowed(context.workspace.id, 'product')
      )
      if (Result.isFailure(allowed)) {
        if (allowed.failure._tag === 'WorkspaceSuspended') {
          const id = notificationDeliveryId(input.notificationId, input.recipientUserId)
          yield* delivery.claim({
            id,
            purpose: 'notification',
            recipient: context.recipient.email,
            userId: input.recipientUserId,
            workspaceId: context.workspace.id,
            referenceId: input.notificationId,
            queuedAt: context.notification.createdAt
          })
          yield* delivery.abandon(id, 'workspace_suspended')
          return { _tag: 'skip', reason: 'workspace_suspended' }
        }
        return yield* Effect.fail(allowed.failure)
      }
    }

    const channel = yield* preferences.resolve(
      input.recipientUserId,
      context.notification.kind
    )
    if (channel !== 'instant') {
      yield* delivery.abandon(
        notificationDeliveryId(input.notificationId, input.recipientUserId)
      )
      return { _tag: 'skip', reason: `channel_${channel}` }
    }
    return { _tag: 'deliver', context }
  })

  const digest = Effect.fn('NotificationEmailEligibility.digest')(function* (
    window: DigestWindow
  ): Effect.fn.Return<DigestNotificationEmailSelection, CapabilityUnavailable> {
    const candidates = yield* feed.listDigestCandidates(window)
    const eligibleCandidates: Array<DigestCandidate> = []
    const suspendedCandidates: Array<DigestCandidate> = []
    let suspendedCount = 0

    for (const candidate of candidates) {
      if (isAllowedDuringWorkspaceSuspension(candidate.notification)) {
        eligibleCandidates.push(candidate)
        continue
      }

      const suppressionId = digestSuppressionId(
        window.until,
        candidate.notification.id,
        candidate.recipient.userId
      )
      const consumed = yield* delivery.get(suppressionId)
      if (consumed?.reason === 'workspace_suspended') {
        suspendedCount += 1
        continue
      }
      if (candidate.workspace === null) {
        eligibleCandidates.push(candidate)
        continue
      }

      const allowed = yield* Effect.result(
        suspension.requireAllowed(candidate.workspace.id, 'product')
      )
      if (Result.isSuccess(allowed)) {
        eligibleCandidates.push(candidate)
      } else if (allowed.failure._tag === 'WorkspaceSuspended') {
        suspendedCount += 1
        suspendedCandidates.push(candidate)
      } else {
        return yield* Effect.fail(allowed.failure)
      }
    }

    // Resolve each recipient once, then use those current choices for both
    // suppression and digest selection.
    const recipientIds = [
      ...new Set(candidates.map((candidate) => candidate.recipient.userId))
    ]
    const channels = new Map<
      string,
      ReadonlyMap<NotificationKind, NotificationChannel>
    >()
    for (const userId of recipientIds) {
      const resolved = yield* preferences.list(userId)
      channels.set(
        userId,
        new Map(resolved.map((entry) => [entry.kind, entry.channel]))
      )
    }

    // Consume suspended digest items durably. Otherwise unread rows would
    // reappear after reactivation and be sent retroactively.
    for (const candidate of suspendedCandidates) {
      const recipientUserId = candidate.recipient.userId
      const channel = channels.get(recipientUserId)?.get(candidate.notification.kind)
      if (channel !== 'digest' || candidate.workspace === null) {
        continue
      }
      const id = digestSuppressionId(
        window.until,
        candidate.notification.id,
        recipientUserId
      )
      const claimed = yield* delivery.claim({
        id,
        purpose: 'digest',
        recipient: candidate.recipient.email,
        userId: recipientUserId,
        workspaceId: candidate.workspace.id,
        referenceId: candidate.notification.id,
        queuedAt: window.until
      })
      if (claimed !== null) {
        yield* delivery.abandon(id, 'workspace_suspended')
      }
    }

    const digestCandidates = eligibleCandidates.filter(
      (candidate) =>
        channels.get(candidate.recipient.userId)?.get(candidate.notification.kind) ===
        'digest'
    )

    return {
      candidateCount: eligibleCandidates.length,
      candidates: digestCandidates,
      suspendedCount
    }
  })

  return NotificationEmailEligibility.of({ instant, digest })
})

/** Composition root provides the existing Seed/Live services at this seam. */
export const layerWithoutDependencies = Layer.effect(NotificationEmailEligibility)(make)
