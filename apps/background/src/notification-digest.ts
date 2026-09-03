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
  describeNotificationKind,
  type NotificationChannel,
  type NotificationKind
} from '@b2b-saas-starter/capabilities/notifications/notification-kinds'
import { NotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { EmailDispatcher, selectEmailDispatcherLayer } from '@b2b-saas-starter/email'
import {
  NotificationDigestEmail,
  type DigestItem
} from '@b2b-saas-starter/email/notification-emails'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { DateTime, Duration, Effect, Layer, Result, type Scope } from 'effect'

import { appUrlFrom, preferencesUrl } from './notification-links.ts'
import { type Env } from './webhook-consumer.ts'

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
    let entry = byRecipient.get(recipient.userId)
    if (entry === undefined) {
      entry = { recipient, items: [] }
      byRecipient.set(recipient.userId, entry)
    }
    entry.items.push({
      kindLabel: describeNotificationKind(kind).label,
      title: candidate.notification.title,
      message: candidate.notification.message,
      workspaceName: candidate.workspace?.name ?? null,
      createdAt: candidate.notification.createdAt
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
    const channels = new Map<string, NotificationChannel>()
    for (const userId of recipientIds) {
      const resolved = yield* preferences.list(userId)
      for (const entry of resolved) {
        channels.set(`${userId} ${entry.kind}`, entry.channel)
      }
    }
    const digests = buildDigests(candidates, (userId, kind) => {
      // `list` returns every kind, so a miss can only mean the store dropped
      // the recipient between the two reads; treat it as "not in the digest".
      return channels.get(`${userId} ${kind}`) ?? 'off'
    })

    let sent = 0
    let failed = 0
    for (const digest of digests) {
      const outcome = yield* Effect.result(
        dispatcher.send({
          from: '',
          to: digest.recipient.email,
          subject: `[B2B SaaS Starter] Your daily digest: ${String(digest.items.length)} unread`,
          element: NotificationDigestEmail({
            recipientName: digest.recipient.name,
            items: digest.items,
            openUrl: `${appUrl}/workspaces`,
            preferencesUrl: preferencesUrl(appUrl)
          })
        })
      )
      if (Result.isSuccess(outcome)) {
        sent += 1
      } else {
        failed += 1
        yield* Effect.logWarning('notification_digest.send_failed', {
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
 * The cron fires once a day (ADR 0055), so a failed run surfaces on the event
 * and the platform's own retry of the scheduled invocation is left alone.
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
      )
    )
  )
}
