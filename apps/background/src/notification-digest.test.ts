import {
  NotificationFeed,
  type DigestCandidate,
  type DigestWindow
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { SeedNotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { EmailDispatcher, type EmailMessage } from '@b2b-saas-starter/email'
import { render } from '@react-email/render'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'

import { buildDigests, runNotificationDigest } from './notification-digest.ts'

const owner = { userId: 'usr_owner', email: 'owner@example.com', name: 'Owner' }
const member = { userId: 'usr_member', email: 'member@example.com', name: 'Member' }
const workspace = { slug: 'starter-lab', name: 'Starter Lab' }

function candidate(
  recipient: typeof owner,
  id: string,
  kind: DigestCandidate['notification']['kind'],
  createdAt: string
): DigestCandidate {
  return {
    notification: {
      id,
      kind,
      title: `title ${id}`,
      message: `message ${id}`,
      createdAt,
      read: false
    },
    recipient,
    workspace
  }
}

describe('buildDigests', () => {
  it('groups per recipient, keeps digest kinds only, newest first', () => {
    const digests = buildDigests(
      [
        candidate(owner, 'n1', 'webhook.delivery_failed', '2026-09-02T10:00:00.000Z'),
        candidate(owner, 'n2', 'announcement', '2026-09-02T12:00:00.000Z'),
        // Security kind on its default: instant, so not in the digest.
        candidate(owner, 'n3', 'api_token.created', '2026-09-02T13:00:00.000Z'),
        candidate(member, 'n1', 'webhook.delivery_failed', '2026-09-02T10:00:00.000Z')
      ],
      (userId, kind) => {
        // The member turned webhook failures off.
        if (userId === member.userId && kind === 'webhook.delivery_failed') {
          return 'off'
        }
        if (kind === 'api_token.created') {
          return 'instant'
        }
        return 'digest'
      }
    )
    expect(digests).toHaveLength(1)
    expect(digests[0]?.recipient).toEqual(owner)
    expect(digests[0]?.items.map((item) => item.title)).toEqual([
      'title n2',
      'title n1'
    ])
    expect(digests[0]?.items[0]).toMatchObject({
      kindLabel: 'Announcements',
      workspaceName: 'Starter Lab'
    })
  })

  it('orders digests by recipient email so a run is deterministic', () => {
    const digests = buildDigests(
      [
        candidate(owner, 'n1', 'announcement', '2026-09-02T10:00:00.000Z'),
        candidate(member, 'n1', 'announcement', '2026-09-02T10:00:00.000Z')
      ],
      () => 'digest'
    )
    expect(digests.map((digest) => digest.recipient.email)).toEqual([
      'member@example.com',
      'owner@example.com'
    ])
  })
})

describe('runNotificationDigest', () => {
  /** The frozen "now" the cron would fire at: 08:00 UTC. */
  const FROZEN_NOW = Date.UTC(2026, 8, 3, 8, 0, 0)

  function stubFeed(
    seen: Array<DigestWindow>,
    rows: ReadonlyArray<DigestCandidate>
  ): Layer.Layer<NotificationFeed> {
    return Layer.succeed(NotificationFeed)({
      list: Effect.die('unused in digest tests'),
      unreadCount: Effect.die('unused in digest tests'),
      markRead: () => Effect.die('unused in digest tests'),
      notifyUser: () => Effect.die('unused in digest tests'),
      create: () => Effect.die('unused in digest tests'),
      loadForEmail: () => Effect.die('unused in digest tests'),
      listDigestCandidates: (window) =>
        Effect.sync(() => {
          seen.push(window)
          return rows.filter(
            (row) =>
              row.notification.createdAt >= window.since &&
              row.notification.createdAt < window.until
          )
        })
    })
  }

  function stubDispatcher(sent: Array<EmailMessage>): Layer.Layer<EmailDispatcher> {
    return Layer.succeed(EmailDispatcher)({
      send: (message) =>
        Effect.sync(() => {
          sent.push(message)
          return { mode: 'log', to: message.to, subject: message.subject }
        })
    })
  }

  const preferences = SeedNotificationPreferences([
    // The member turned webhook failures off; everything else is on defaults.
    { userId: member.userId, kind: 'webhook.delivery_failed', channel: 'off' }
  ]).pipe(Layer.provide(SeedAuditEventLog([])))

  it.effect('cuts a 24h window ending now and sends one digest per recipient', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FROZEN_NOW)
      const seen: Array<DigestWindow> = []
      const sent: Array<EmailMessage> = []
      const rows = [
        // Inside the window for both recipients.
        candidate(owner, 'n1', 'webhook.delivery_failed', '2026-09-02T10:00:00.000Z'),
        candidate(member, 'n1', 'webhook.delivery_failed', '2026-09-02T10:00:00.000Z'),
        candidate(owner, 'n2', 'announcement', '2026-09-03T07:59:59.000Z'),
        candidate(member, 'n2', 'announcement', '2026-09-03T07:59:59.000Z'),
        // Exactly 24h ago is inside (inclusive lower bound).
        candidate(owner, 'n0', 'announcement', '2026-09-02T08:00:00.000Z'),
        // Older than the window: yesterday's digest covered it.
        candidate(owner, 'old', 'announcement', '2026-09-02T07:59:59.000Z'),
        // Security kind on its instant default: never in the digest.
        candidate(owner, 'sec', 'api_token.created', '2026-09-03T01:00:00.000Z')
      ]
      const summary = yield* Effect.scoped(
        runNotificationDigest('https://app.test').pipe(
          Effect.provide(
            Layer.mergeAll(stubFeed(seen, rows), preferences, stubDispatcher(sent))
          )
        )
      )

      expect(seen).toEqual([
        { since: '2026-09-02T08:00:00.000Z', until: '2026-09-03T08:00:00.000Z' }
      ])
      expect(summary).toMatchObject({
        since: '2026-09-02T08:00:00.000Z',
        until: '2026-09-03T08:00:00.000Z',
        candidates: 6,
        digests: 2,
        sent: 2,
        failed: 0
      })
      expect(sent.map((message) => message.to)).toEqual([
        'member@example.com',
        'owner@example.com'
      ])
      expect(sent[1]?.subject).toContain('3 unread')
      expect(sent[0]?.subject).toContain('1 unread')

      const ownerHtml = yield* Effect.promise(() => render(sent[1]!.element))
      expect(ownerHtml).toContain('title n2')
      expect(ownerHtml).toContain('title n1')
      expect(ownerHtml).toContain('title n0')
      expect(ownerHtml).not.toContain('title old')
      expect(ownerHtml).not.toContain('title sec')
      expect(ownerHtml).toContain('https://app.test/account/notifications')
    })
  )

  it.effect('sends nothing when the window holds no digest-channel rows', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(FROZEN_NOW)
      const sent: Array<EmailMessage> = []
      const summary = yield* Effect.scoped(
        runNotificationDigest('https://app.test').pipe(
          Effect.provide(
            Layer.mergeAll(
              stubFeed(
                [],
                [
                  candidate(
                    owner,
                    'sec',
                    'api_token.created',
                    '2026-09-03T01:00:00.000Z'
                  )
                ]
              ),
              preferences,
              stubDispatcher(sent)
            )
          )
        )
      )
      expect(summary).toMatchObject({ candidates: 1, digests: 0, sent: 0 })
      expect(sent).toHaveLength(0)
    })
  )
})
