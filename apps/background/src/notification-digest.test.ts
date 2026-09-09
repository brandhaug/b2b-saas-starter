import {
  NotificationFeed,
  type DigestCandidate,
  type DigestWindow
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { layerWithoutDependencies as NotificationEmailEligibilityLayer } from '@b2b-saas-starter/capabilities/notifications/notification-email-eligibility'
import { SeedNotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { SeedEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.seed'
import {
  WorkspaceSuspended,
  WorkspaceSuspensionService
} from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import {
  EmailDispatcher,
  EmailSendError,
  type EmailDeliveryResult,
  type EmailMessage
} from '@b2b-saas-starter/email'
import { render } from 'react-email'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'

import { buildDigests, runNotificationDigest } from './notification-digest.ts'

const owner = { userId: 'usr_owner', email: 'owner@example.com', name: 'Owner' }
const member = { userId: 'usr_member', email: 'member@example.com', name: 'Member' }
const workspace = { id: 'wrk_1', slug: 'starter-lab', name: 'Starter Lab' }

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
    const digests = buildDigests([
      candidate(owner, 'n1', 'webhook.delivery_failed', '2026-09-02T09:00:00.000Z'),
      candidate(owner, 'n2', 'announcement', '2026-09-02T10:00:00.000Z')
    ])
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
    const digests = buildDigests([
      candidate(owner, 'n1', 'announcement', '2026-09-02T10:00:00.000Z'),
      candidate(member, 'n1', 'announcement', '2026-09-02T10:00:00.000Z')
    ])
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
      listPage: () => Effect.die('unused in digest tests'),
      unreadCount: Effect.die('unused in digest tests'),
      markRead: () => Effect.die('unused in digest tests'),
      notifyUser: () => Effect.die('unused in digest tests'),
      prepareWorkspaceOwners: () =>
        Effect.succeed({ writes: [], publish: Effect.void }),
      notifyWorkspaceOwners: () => Effect.die('unused in digest tests'),
      create: () => Effect.die('unused in digest tests'),
      loadForEmail: () => Effect.die('unused in digest tests'),
      record: () => Effect.die('unused in digest tests'),
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

  function stubDispatcher(
    sent: Array<EmailMessage>,
    providerAccepted = false
  ): Layer.Layer<EmailDispatcher> {
    return Layer.succeed(EmailDispatcher)({
      send: (message) =>
        Effect.sync(() => {
          sent.push(message)
          if (providerAccepted) {
            return {
              mode: 'cloudflare-email',
              to: message.to,
              subject: message.subject,
              providerMessageId: 'provider_digest_1'
            } satisfies EmailDeliveryResult
          }
          return {
            mode: 'log',
            to: message.to,
            subject: message.subject
          } satisfies EmailDeliveryResult
        })
    })
  }

  const preferences = SeedNotificationPreferences([
    // The member turned webhook failures off; everything else is on defaults.
    { userId: member.userId, kind: 'webhook.delivery_failed', channel: 'off' }
  ]).pipe(Layer.provide(SeedAuditEventLog([])))
  const activeSuspension = Layer.succeed(WorkspaceSuspensionService)({
    list: Effect.succeed([]),
    get: () => Effect.die('unused'),
    requireAllowed: () => Effect.void,
    transition: () => Effect.die('unused')
  })

  function layersFor(
    feed: Layer.Layer<NotificationFeed>,
    dispatcher: Layer.Layer<EmailDispatcher>,
    suspension: Layer.Layer<WorkspaceSuspensionService> = activeSuspension
  ) {
    const dependencies = Layer.mergeAll(
      feed,
      preferences,
      SeedEmailDelivery(),
      suspension
    )
    const eligibility = NotificationEmailEligibilityLayer.pipe(
      Layer.provide(dependencies)
    )
    return Layer.mergeAll(dependencies, eligibility, dispatcher)
  }

  it.effect(
    'consumes a suspended digest item and does not replay it after recovery',
    () => {
      let suspended = true
      const suspension = Layer.succeed(WorkspaceSuspensionService)({
        list: Effect.succeed([]),
        get: () => Effect.die('unused'),
        requireAllowed: () => {
          if (suspended) {
            return Effect.fail(new WorkspaceSuspended({ workspaceId: 'wrk_1' }))
          }
          return Effect.void
        },
        transition: () => Effect.die('unused')
      })
      const rows = [
        candidate(owner, 'suspended-1', 'announcement', '2026-09-03T07:00:00.000Z')
      ]
      return Effect.gen(function* () {
        yield* TestClock.setTime(FROZEN_NOW)
        const first = yield* runNotificationDigest('https://app.test')
        suspended = false
        const second = yield* runNotificationDigest('https://app.test')
        expect(first.sent).toBe(0)
        expect(second.sent).toBe(0)
      }).pipe(
        Effect.provide(
          layersFor(stubFeed([], rows), stubDispatcher([], false), suspension)
        )
      )
    }
  )

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
          Effect.provide(layersFor(stubFeed(seen, rows), stubDispatcher(sent)))
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
            layersFor(
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
              stubDispatcher(sent)
            )
          )
        )
      )
      expect(summary).toMatchObject({ candidates: 1, digests: 0, sent: 0 })
      expect(sent).toHaveLength(0)
    })
  )

  it.effect('does not resend a provider-accepted digest in the same window', () => {
    const sent: Array<EmailMessage> = []
    const rows = [candidate(owner, 'n1', 'announcement', '2026-09-03T07:00:00.000Z')]
    const layers = layersFor(stubFeed([], rows), stubDispatcher(sent, true))
    return Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(FROZEN_NOW)
        const first = yield* runNotificationDigest('https://app.test')
        const second = yield* runNotificationDigest('https://app.test')
        expect(first).toMatchObject({ sent: 1, failed: 0 })
        expect(second).toMatchObject({ sent: 0, failed: 0 })
        expect(sent).toHaveLength(1)
      })
    ).pipe(Effect.provide(layers))
  })

  it.effect('retries a failed digest later in the same retry window', () => {
    const sent: Array<EmailMessage> = []
    let attempts = 0
    const rows = [candidate(owner, 'n1', 'announcement', '2026-09-03T07:00:00.000Z')]
    const dispatcher = Layer.succeed(EmailDispatcher)({
      send: (message) => {
        attempts += 1
        if (attempts === 1) {
          return Effect.fail(
            new EmailSendError({
              message: 'email send failed: transient',
              to: message.to,
              subject: message.subject,
              failureKind: 'transient'
            })
          )
        }
        return Effect.sync(() => {
          sent.push(message)
          return {
            mode: 'cloudflare-email',
            to: message.to,
            subject: message.subject,
            providerMessageId: 'provider_digest_retry'
          } satisfies EmailDeliveryResult
        })
      }
    })
    const layers = layersFor(stubFeed([], rows), dispatcher)
    return Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(FROZEN_NOW)
        const first = yield* runNotificationDigest('https://app.test')
        yield* TestClock.adjust(Duration.minutes(3))
        const second = yield* runNotificationDigest('https://app.test')
        expect(first).toMatchObject({ sent: 0, failed: 1 })
        expect(second).toMatchObject({ sent: 1, failed: 0 })
        expect(attempts).toBe(2)
        expect(sent).toHaveLength(1)
      })
    ).pipe(Effect.provide(layers))
  })
})
