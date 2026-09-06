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
  type NotificationChannel,
  type NotificationKind
} from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { renderNotificationEvent } from '@b2b-saas-starter/capabilities/notifications/notification-events'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import { formatDateTime } from '@b2b-saas-starter/i18n/format'
import { EmailDispatcher, selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
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

function localizedKindLabel(kind: string, locale: Locale): string {
  const options = { locale }
  switch (kind) {
    case 'api_token.created': {
      return m.backend_email_notification_kind_api_token_created({}, options)
    }
    case 'api_token.revoked': {
      return m.backend_email_notification_kind_api_token_revoked({}, options)
    }
    case 'workspace_member.role_changed': {
      return m.backend_email_notification_kind_role_changed({}, options)
    }
    case 'two_factor.changed': {
      return m.backend_email_notification_kind_two_factor_changed({}, options)
    }
    case 'webhook.delivery_failed': {
      return m.backend_email_notification_kind_webhook_failed({}, options)
    }
    case 'workspace_member.joined': {
      return m.backend_email_notification_kind_member_joined({}, options)
    }
    case 'billing.plan_changed': {
      return m.backend_email_notification_kind_plan_changed({}, options)
    }
    case 'account.impersonated': {
      return m.backend_email_notification_kind_impersonated({}, options)
    }
    default: {
      return m.backend_email_notification_kind_announcement({}, options)
    }
  }
}

function notificationCopy(
  notification: {
    readonly title: string
    readonly message: string
    readonly event?: Parameters<typeof renderNotificationEvent>[0] | undefined
  },
  locale: Locale,
  timeZone = 'UTC'
) {
  if (notification.event === undefined) {
    return { title: notification.title, message: notification.message }
  }
  return renderNotificationEvent(notification.event, locale, timeZone)
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
  for (const candidate of candidates) {
    const kind = candidate.notification.kind
    const { recipient } = candidate
    if (channelFor(recipient.userId, kind) !== 'digest') {
      continue
    }
    const locale = recipient.locale ?? DEFAULT_LOCALE
    const copy = notificationCopy(
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
      kindLabel: localizedKindLabel(kind, locale),
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
      items: entry.items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
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
 * One digest run: cut the 24-hour window ending now (read from `Clock`, so a
 * test freezes it), collect every unread pair, resolve each recipient's
 * preferences once, group, and send one email per recipient with at least one
 * digest item. A failed send is counted and logged, never retried within the
 * run — the next morning's digest is the retry.
 */
export function runNotificationDigest(
  appUrl: string
): Effect.Effect<
  DigestRunSummary,
  CapabilityUnavailable,
  NotificationFeed | NotificationPreferences | EmailDispatcher | Scope.Scope
> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now
    const until = DateTime.formatIso(now)
    const since = DateTime.formatIso(DateTime.subtractDuration(now, DIGEST_WINDOW))
    const feed = yield* NotificationFeed
    const preferences = yield* NotificationPreferences
    const dispatcher = yield* EmailDispatcher

    const candidates = yield* feed.listDigestCandidates({ since, until })

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
    const digests = buildDigests(candidates, (userId, kind) => {
      // `list` returns every kind, so a miss can only mean the store dropped
      // the recipient between the two reads; treat it as "not in the digest".
      return channels.get(userId)?.get(kind) ?? 'off'
    })

    let sent = 0
    let failed = 0
    for (const digest of digests) {
      const outcome = yield* Effect.result(
        dispatcher.send({
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
        })
      )
      if (Result.isSuccess(outcome)) {
        sent += 1
      } else {
        failed += 1
        yield* Effect.logError('notification_digest.send_failed', {
          to: digest.recipient.email,
          reason: outcome.failure.message
        })
      }
    }

    const summary: DigestRunSummary = {
      since,
      until,
      candidates: candidates.length,
      digests: digests.length,
      sent,
      failed
    }
    yield* Effect.annotateLogsScoped({ ...summary })
    return summary
  })
}

/**
 * The `scheduled` entry: real layers plus a `notification_digest` wide event.
 * Sends are counted, never fatal, so a run that fails sent nothing — a bounded
 * retry of the whole run is safe (the reads are its only failure channel).
 * Two jittered retries ride out a transient store blip; after that the run
 * rejects and the failed cron invocation is recorded by the platform.
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
    runNotificationDigest(appUrlFrom(env)).pipe(
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
