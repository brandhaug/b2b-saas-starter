import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  NotificationFeed,
  type DigestCandidate,
  type NotificationRecipient
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  notificationKindLabel,
  type NotificationChannel,
  type NotificationKind
} from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import {
  isAllowedDuringWorkspaceSuspension,
  renderNotificationCopy
} from '@b2b-saas-starter/capabilities/notifications/notification-events'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import { formatDateTime } from '@b2b-saas-starter/i18n/format'
import {
  type EmailDispatcher,
  selectEmailDispatcherLayer
} from '@b2b-saas-starter/email'
import { dispatchTrackedEmail } from '@b2b-saas-starter/email/tracked'
import { EmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import {
  NotificationDigestEmail,
  type DigestItem
} from '@b2b-saas-starter/email/notification-emails'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { DateTime, Duration, Effect, Layer, Result, Schedule, type Scope } from 'effect'

import { appUrlFrom, preferencesUrl } from './notification-links.ts'
import { type Env } from './queue-consumer.ts'

/** How far back one digest looks — one run per day, so one day of rows. */
export const DIGEST_WINDOW = Duration.hours(24)

export type RecipientDigest = {
  readonly recipient: NotificationRecipient
  readonly items: ReadonlyArray<DigestItem>
}

/** Resolves a recipient's channel for a kind — the digest's one policy input. */
export type ChannelResolver = (
  userId: string,
  kind: NotificationKind
) => NotificationChannel

/**
 * Formats a Notification's ISO timestamp for the digest email: the template
 * reads no clock, so the sender turns the ISO string it already holds into a
 * display line. UTC by construction — `DateTime.formatIso` writes UTC.
 */
export function formatDigestTimestamp(
  createdAt: string,
  locale: Locale = DEFAULT_LOCALE,
  timeZone = 'UTC'
): string {
  return formatDateTime(
    createdAt,
    locale,
    { dateStyle: 'medium', timeStyle: 'short' },
    timeZone
  )
}

/**
 * Groups the window's candidate pairs into one digest per recipient, keeping
 * only the kinds that recipient takes as `digest`. Pure: the clock has already
 * cut the window, and the preferences are handed in as a function, so the
 * grouping is testable with fixed rows. Items are newest first; digests are
 * ordered by recipient email so a run is deterministic.
 */
export function buildDigests(
  candidates: ReadonlyArray<DigestCandidate>,
  channelFor: ChannelResolver
): ReadonlyArray<RecipientDigest> {
  const byRecipient = new Map<
    string,
    { recipient: NotificationRecipient; items: Array<DigestItem> }
  >()
  for (const candidate of candidates.toSorted((a, b) =>
    b.notification.createdAt.localeCompare(a.notification.createdAt)
  )) {
    const kind = candidate.notification.kind
    const { recipient } = candidate
    if (channelFor(recipient.userId, kind) !== 'digest') {
      continue
    }
    const locale = recipient.locale ?? DEFAULT_LOCALE
    const copy = renderNotificationCopy(
      candidate.notification,
      locale,
      recipient.timeZone ?? 'UTC'
    )
    let entry = byRecipient.get(recipient.userId)
    if (entry === undefined) {
      entry = { recipient, items: [] }
      byRecipient.set(recipient.userId, entry)
    }
    entry.items.push({
      id: candidate.notification.id,
      kindLabel: notificationKindLabel(kind, locale),
      title: copy.title,
      message: copy.message,
      workspaceName: candidate.workspace?.name ?? null,
      createdAt: formatDigestTimestamp(
        candidate.notification.createdAt,
        locale,
        candidate.recipient.timeZone ?? 'UTC'
      )
    })
  }
  return [...byRecipient.values()]
    .map((entry) => ({
      recipient: entry.recipient,
      items: entry.items
    }))
    .toSorted((a, b) => a.recipient.email.localeCompare(b.recipient.email))
}

export type DigestRunSummary = {
  readonly since: string
  readonly until: string
  readonly candidates: number
  readonly digests: number
  readonly sent: number
  readonly failed: number
}

/**
 * Re-read the window's unread notifications and current preferences on every
 * pass. The stable window/user identity prevents resending accepted digests;
 * later scheduled passes retry unresolved sends within the six-hour limit.
 */
export function runNotificationDigest(
  appUrl: string,
  windowEnd?: string
): Effect.Effect<
  DigestRunSummary,
  CapabilityUnavailable,
  | NotificationFeed
  | NotificationPreferences
  | EmailDispatcher
  | EmailDelivery
  | WorkspaceSuspensionService
  | Scope.Scope
> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now
    const until = windowEnd ?? DateTime.formatIso(now)
    const since = DateTime.formatIso(
      DateTime.subtractDuration(DateTime.makeUnsafe(until), DIGEST_WINDOW)
    )
    const feed = yield* NotificationFeed
    const preferences = yield* NotificationPreferences
    const emailDelivery = yield* EmailDelivery

    const candidates = yield* feed.listDigestCandidates({ since, until })
    const suspension = yield* WorkspaceSuspensionService
    const eligibleCandidates: Array<(typeof candidates)[number]> = []
    const suspendedCandidates: Array<(typeof candidates)[number]> = []
    let suspended = 0
    for (const candidate of candidates) {
      if (isAllowedDuringWorkspaceSuspension(candidate.notification)) {
        eligibleCandidates.push(candidate)
        continue
      }
      const consumed = yield* emailDelivery.get(
        `digest-suppressed:${until}:${candidate.notification.id}:${candidate.recipient.userId}`
      )
      if (consumed?.reason === 'workspace_suspended') {
        suspended += 1
        continue
      }
      if (candidate.workspace === null) {
        eligibleCandidates.push(candidate)
        continue
      }
      const workspaceId = candidate.workspace.id
      const allowed = yield* Effect.result(
        suspension.requireAllowed(workspaceId, 'product')
      )
      if (Result.isSuccess(allowed)) {
        eligibleCandidates.push(candidate)
      } else if (allowed.failure._tag === 'WorkspaceSuspended') {
        suspended += 1
        suspendedCandidates.push(candidate)
      } else {
        return yield* Effect.fail(allowed.failure)
      }
    }
    if (suspended > 0) {
      yield* Effect.annotateLogsScoped({
        notificationDigestSkipped: suspended,
        skipReason: 'workspace_suspended'
      })
    }

    // One preference read per recipient, not per (recipient, kind) pair.
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
    // Consume suspended digest items durably. Otherwise an unread row would
    // reappear after reactivation and be sent retroactively.
    for (const candidate of suspendedCandidates) {
      if (candidate.workspace === null) {
        continue
      }
      const workspaceId = candidate.workspace.id
      const recipientUserId = candidate.recipient.userId
      const kind = candidate.notification.kind
      if (channels.get(recipientUserId)?.get(kind) !== 'digest') {
        continue
      }
      const id = `digest-suppressed:${until}:${candidate.notification.id}:${recipientUserId}`
      const claimed = yield* emailDelivery.claim({
        id,
        purpose: 'digest',
        recipient: candidate.recipient.email,
        userId: candidate.recipient.userId,
        workspaceId,
        referenceId: candidate.notification.id,
        queuedAt: until
      })
      if (claimed !== null) {
        yield* emailDelivery.abandon(id, 'workspace_suspended')
      }
    }
    const digests = buildDigests(eligibleCandidates, (userId, kind) => {
      // `list` returns every kind, so a miss can only mean the store dropped
      // the recipient between the two reads; treat it as "not in the digest".
      return channels.get(userId)?.get(kind) ?? 'off'
    })

    let sent = 0
    let failed = 0
    for (const digest of digests) {
      const { userId } = digest.recipient
      const outcome = yield* Effect.result(
        dispatchTrackedEmail(
          {
            id: `digest:${until}:${userId}`,
            purpose: 'digest',
            recipient: digest.recipient.email,
            userId,
            workspaceId: null,
            referenceId: until,
            queuedAt: until
          },
          {
            to: digest.recipient.email,
            subject: m.backend_email_subject_digest(
              { count: digest.items.length },
              { locale: digest.recipient.locale ?? DEFAULT_LOCALE }
            ),
            element: NotificationDigestEmail({
              recipientName: digest.recipient.name,
              items: digest.items,
              openUrl: `${appUrl}/workspaces`,
              preferencesUrl: preferencesUrl(appUrl),
              locale: digest.recipient.locale ?? DEFAULT_LOCALE
            })
          }
        )
      )
      if (Result.isSuccess(outcome) && outcome.success.status !== 'skipped') {
        sent += 1
      } else if (Result.isFailure(outcome)) {
        failed += 1
        yield* Effect.logError('notification_digest.send_failed', {
          userId,
          reason: outcome.failure._tag
        })
      }
    }

    const summary: DigestRunSummary = {
      since,
      until,
      candidates: eligibleCandidates.length,
      digests: digests.length,
      sent,
      failed
    }
    yield* Effect.annotateLogsScoped({ ...summary })
    return summary
  })
}

/**
 * The daily and retry schedules share the same 08:00 UTC window. Durable
 * claims protect accepted sends when a store failure repeats the pass.
 */
export function sendDailyDigest(
  env: Env,
  scheduledTime: number
): Effect.Effect<DigestRunSummary, CapabilityUnavailable> {
  return withTriggerScope(
    {
      service: 'background',
      event: 'notification_digest',
      env,
      metadata: { scheduledTime }
    },
    runNotificationDigest(
      appUrlFrom(env),
      `${DateTime.formatIso(DateTime.makeUnsafe(scheduledTime)).slice(0, 10)}T08:00:00.000Z`
    ).pipe(
      Effect.provide(
        Layer.merge(
          selectCapabilitiesLayer(starterEnv(env)),
          selectEmailDispatcherLayer(env)
        )
      ),
      Effect.retry(
        Schedule.upTo({ times: 2 })(
          Schedule.jittered(Schedule.exponential('5 seconds'))
        )
      )
    )
  )
}
