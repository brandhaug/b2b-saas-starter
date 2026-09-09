import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  type DigestCandidate,
  type NotificationRecipient
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { NotificationEmailEligibility } from '@b2b-saas-starter/capabilities/notifications/notification-email-eligibility'
import { notificationKindLabel } from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { renderNotificationCopy } from '@b2b-saas-starter/capabilities/notifications/notification-events'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import { formatDateTime } from '@b2b-saas-starter/i18n/format'
import {
  type EmailDispatcher,
  selectEmailDispatcherLayer
} from '@b2b-saas-starter/email'
import { dispatchTrackedEmail } from '@b2b-saas-starter/email/tracked'
import { type EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
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
 * Groups the already-selected candidate pairs into one digest per recipient.
 * Eligibility and current preference reads belong to the capability service.
 * Items are newest first; digests are ordered by recipient email so a run is
 * deterministic.
 */
export function buildDigests(
  candidates: ReadonlyArray<DigestCandidate>
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
  NotificationEmailEligibility | EmailDispatcher | EmailDelivery | Scope.Scope
> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now
    const until = windowEnd ?? DateTime.formatIso(now)
    const since = DateTime.formatIso(
      DateTime.subtractDuration(DateTime.makeUnsafe(until), DIGEST_WINDOW)
    )
    const eligibility = yield* NotificationEmailEligibility
    const selection = yield* eligibility.digest({ since, until })
    if (selection.suspendedCount > 0) {
      yield* Effect.annotateLogsScoped({
        notificationDigestSkipped: selection.suspendedCount,
        skipReason: 'workspace_suspended'
      })
    }
    const digests = buildDigests(selection.candidates)

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
      candidates: selection.candidateCount,
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
