import { notifications } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'
import { describe, expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'

import { LiveAuditEventLog } from '../governance/audit-event-log.ts'
import { LIVE_SUITE_TIMEOUT, TestDatabase } from '../testing/live-harness.ts'
import { liveWorkspaceContext } from '../workspace-context.ts'
import { type NotificationEmailQueueMessage } from './notification-email-queue.ts'
import { LiveNotificationFeed } from './notification-feed.live.ts'
import { NotificationFeed } from './notification-feed.ts'
import {
  LiveNotificationPreferences,
  NotificationPreferences
} from './notification-preferences.ts'

/**
 * The feed plus the preference store it resolves against, over the provisioned
 * D1, with a capturing queue so the instant fan-out is observable. Built per
 * call so each case gets its own capture list.
 */
function feedLayer(enqueued: Array<NotificationEmailQueueMessage>) {
  const preferences = LiveNotificationPreferences.pipe(Layer.provide(LiveAuditEventLog))
  return Layer.merge(
    preferences,
    LiveNotificationFeed({
      emailQueue: {
        send: (message) => {
          enqueued.push(message)
          return Promise.resolve()
        },
        sendBatch: (messages) => {
          for (const message of messages) {
            enqueued.push(message.body)
          }
          return Promise.resolve()
        }
      }
    }).pipe(Layer.provide(preferences))
  )
}

function withFeed<A, E>(
  enqueued: Array<NotificationEmailQueueMessage>,
  effect: Effect.Effect<A, E, NotificationFeed | NotificationPreferences>
): Effect.Effect<A, E, Database | RawD1> {
  return Effect.provide(effect, feedLayer(enqueued))
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('live notification feed', (it) => {
  describe('preferences over live D1', () => {
    it.effect(
      'defaults, stores an explicit choice, upserts it, and audits the change',
      () =>
        withFeed(
          [],
          Effect.gen(function* () {
            const preferences = yield* NotificationPreferences
            expect(yield* preferences.resolve('usr_owner', 'api_token.created')).toBe(
              'instant'
            )
            expect(yield* preferences.resolve('usr_owner', 'announcement')).toBe(
              'digest'
            )

            yield* preferences.set({
              userId: 'usr_owner',
              kind: 'announcement',
              channel: 'off'
            })
            yield* preferences.set({
              userId: 'usr_owner',
              kind: 'announcement',
              channel: 'instant'
            })
            expect(yield* preferences.resolve('usr_owner', 'announcement')).toBe(
              'instant'
            )
            const listed = yield* preferences.list('usr_owner')
            expect(listed.filter((entry) => !entry.isDefault)).toEqual([
              { kind: 'announcement', channel: 'instant', isDefault: false }
            ])
          })
        )
    )
  })

  describe('create and instant fan-out', () => {
    it.effect('persists a broadcast and enqueues one message per instant member', () =>
      Effect.gen(function* () {
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const created = yield* withFeed(
          enqueued,
          Effect.gen(function* () {
            const feed = yield* NotificationFeed
            // `api_token.created` defaults to instant for every member.
            return yield* feed.create({
              workspaceId: 'wrk_live',
              userId: null,
              kind: 'api_token.created',
              title: 'API token created',
              message: 'Live test token minted.'
            })
          })
        )
        expect(created.kind).toBe('api_token.created')
        expect(created.read).toBe(false)
        // `wrk_live` has one member in the fixture: usr_owner.
        expect(enqueued).toEqual([
          { notificationId: created.id, recipientUserId: 'usr_owner' }
        ])

        // The row is visible through the workspace-scoped read.
        const listed = yield* Effect.provide(
          Effect.flatMap(NotificationFeed, (feed) => feed.list),
          Layer.merge(
            feedLayer([]),
            liveWorkspaceContext('live-lab', { userId: 'usr_owner' })
          )
        )
        expect(listed.map((row) => row.id)).toContain(created.id)
      })
    )

    it.effect(
      'enqueues nothing for a digest-default kind, and the digest read finds the pair',
      () =>
        Effect.gen(function* () {
          const enqueued: Array<NotificationEmailQueueMessage> = []
          const created = yield* withFeed(
            enqueued,
            Effect.flatMap(NotificationFeed, (feed) =>
              feed.create({
                workspaceId: 'wrk_live',
                kind: 'webhook.delivery_failed',
                title: 'Webhook delivery failed',
                message: 'gave up'
              })
            )
          )
          expect(enqueued).toEqual([])

          const candidates = yield* withFeed(
            [],
            Effect.flatMap(NotificationFeed, (feed) =>
              feed.listDigestCandidates({
                since: created.createdAt,
                until: '2999-01-01T00:00:00.000Z'
              })
            )
          )
          const pair = candidates.find(
            (candidate) => candidate.notification.id === created.id
          )
          expect(pair).toMatchObject({
            recipient: { userId: 'usr_owner', email: 'owner@live.test' },
            workspace: { slug: 'live-lab', name: 'Live Lab' }
          })
        })
    )

    it.effect('loads the email context for the recipient, and null once read', () =>
      Effect.gen(function* () {
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const created = yield* withFeed(
          enqueued,
          Effect.flatMap(NotificationFeed, (feed) =>
            feed.create({
              workspaceId: 'wrk_live',
              userId: 'usr_owner',
              kind: 'workspace_member.role_changed',
              title: 'Your role changed',
              message: 'You are now an admin.'
            })
          )
        )
        expect(enqueued).toHaveLength(1)

        const loaded = yield* withFeed(
          [],
          Effect.flatMap(NotificationFeed, (feed) =>
            feed.loadForEmail(created.id, 'usr_owner')
          )
        )
        expect(loaded).toMatchObject({
          notification: { id: created.id, kind: 'workspace_member.role_changed' },
          recipient: { userId: 'usr_owner', email: 'owner@live.test' },
          workspace: { slug: 'live-lab' }
        })

        // Another user is not a recipient of a targeted row.
        const other = yield* withFeed(
          [],
          Effect.flatMap(NotificationFeed, (feed) =>
            feed.loadForEmail(created.id, 'usr_outsider')
          )
        )
        expect(other).toBeNull()

        const db = yield* Database
        yield* db
          .update(notifications)
          .set({ readAt: '2026-07-03T10:00:00.000Z' })
          .where(eq(notifications.id, created.id))
        const afterRead = yield* withFeed(
          [],
          Effect.flatMap(NotificationFeed, (feed) =>
            feed.loadForEmail(created.id, 'usr_owner')
          )
        )
        expect(afterRead).toBeNull()
      })
    )
  })
})
