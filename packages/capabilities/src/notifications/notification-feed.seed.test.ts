import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { CapabilityUnavailable } from '../errors.ts'
import { SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { seedMembers, seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import {
  type NotificationEmailQueueBinding,
  type NotificationEmailQueueMessage
} from './notification-email-queue.ts'
import { enqueueInstantEmails } from './notification-fan-out.ts'
import { SeedNotificationFeed } from './notification-feed.seed.ts'
import {
  inDigestWindow,
  NotificationFeed,
  type SeedNotification
} from './notification-feed.ts'
import {
  SeedNotificationPreferences,
  type NotificationPreferencesInterface
} from './notification-preferences.ts'

const fixture = { workspace: seedWorkspaceRecord, members: seedMembers }

function capturingQueue(enqueued: Array<NotificationEmailQueueMessage>) {
  const queue: NotificationEmailQueueBinding = {
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
  return queue
}

const seeded: ReadonlyArray<SeedNotification> = [
  {
    id: 'not_old_unread',
    kind: 'announcement',
    title: 'old',
    message: 'm',
    createdAt: '2026-05-01T00:00:00.000Z',
    read: false
  },
  {
    id: 'not_targeted',
    kind: 'workspace_member.role_changed',
    title: 'for dev',
    message: 'm',
    createdAt: '2026-05-16T09:00:00.000Z',
    read: false,
    userId: 'usr_dev'
  },
  {
    id: 'not_read',
    kind: 'announcement',
    title: 'read',
    message: 'm',
    createdAt: '2026-05-16T09:30:00.000Z',
    read: true
  },
  {
    id: 'not_stranger',
    kind: 'announcement',
    title: 'for nobody in the roster',
    message: 'm',
    createdAt: '2026-05-16T09:40:00.000Z',
    read: false,
    userId: 'usr_not_a_member'
  }
]

function feedFor(
  enqueued: Array<NotificationEmailQueueMessage>,
  preferences: ReadonlyArray<{
    readonly userId: string
    readonly kind: SeedNotification['kind']
    readonly channel: 'off' | 'instant' | 'digest'
  }> = []
) {
  const prefs = SeedNotificationPreferences(preferences).pipe(
    Layer.provide(SeedAuditEventLog([]))
  )
  return Layer.mergeAll(
    prefs,
    SeedNotificationFeed(seeded, fixture, {
      emailQueue: capturingQueue(enqueued)
    }).pipe(Layer.provide(prefs))
  )
}

describe('inDigestWindow', () => {
  it('is inclusive at since and exclusive at until', () => {
    const window = {
      since: '2026-09-02T08:00:00.000Z',
      until: '2026-09-03T08:00:00.000Z'
    }
    expect(inDigestWindow('2026-09-02T08:00:00.000Z', window)).toBe(true)
    expect(inDigestWindow('2026-09-03T07:59:59.999Z', window)).toBe(true)
    expect(inDigestWindow('2026-09-03T08:00:00.000Z', window)).toBe(false)
    expect(inDigestWindow('2026-09-02T07:59:59.999Z', window)).toBe(false)
  })
})

describe('seed notification feed: create and fan-out', () => {
  const broadcastEnqueued: Array<NotificationEmailQueueMessage> = []
  it.effect('a broadcast of an instant kind enqueues one message per member', () =>
    Effect.gen(function* () {
      const enqueued = broadcastEnqueued
      const feed = yield* NotificationFeed
      const created = yield* feed.create({
        workspaceId: seedWorkspaceRecord.id,
        kind: 'api_token.created',
        title: 'token',
        message: 'm'
      })
      expect(created.read).toBe(false)
      expect(enqueued.map((message) => message.recipientUserId).toSorted()).toEqual(
        seedMembers.map((member) => member.id).toSorted()
      )
      expect(enqueued.every((message) => message.notificationId === created.id)).toBe(
        true
      )
      // The row is in the workspace-scoped read (last: TestClock sits at epoch 0).
      const list = yield* feed.list
      expect(list.map((row) => row.id)).toContain(created.id)
    }).pipe(
      Effect.provide(
        Layer.merge(
          feedFor(broadcastEnqueued),
          testWorkspaceContext(seedWorkspaceRecord, {
            userId: 'usr_demo',
            role: 'owner',
            systemRole: 'admin'
          })
        )
      )
    )
  )

  it.effect(
    'honours each member’s channel: off and digest members get no instant message',
    () =>
      Effect.gen(function* () {
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const layer = feedFor(enqueued, [
          { userId: 'usr_demo', kind: 'api_token.created', channel: 'digest' },
          { userId: 'usr_ops', kind: 'api_token.created', channel: 'off' }
        ])
        yield* Effect.flatMap(NotificationFeed, (feed) =>
          feed.create({
            workspaceId: seedWorkspaceRecord.id,
            kind: 'api_token.created',
            title: 'token',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        expect(enqueued.map((message) => message.recipientUserId).toSorted()).toEqual([
          'usr_dev',
          'usr_martin'
        ])
      })
  )

  it.effect(
    'a digest-default kind enqueues nothing; a foreign workspace reaches nobody',
    () =>
      Effect.gen(function* () {
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const layer = feedFor(enqueued)
        yield* Effect.flatMap(NotificationFeed, (feed) =>
          feed.create({
            workspaceId: seedWorkspaceRecord.id,
            kind: 'webhook.delivery_failed',
            title: 'gave up',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        yield* Effect.flatMap(NotificationFeed, (feed) =>
          feed.create({
            workspaceId: 'wrk_elsewhere',
            userId: 'usr_demo',
            kind: 'api_token.created',
            title: 'token',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        expect(enqueued).toEqual([])
      })
  )

  it.effect(
    'a targeted row enqueues for its user only, and for nobody outside the roster',
    () =>
      Effect.gen(function* () {
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const layer = feedFor(enqueued)
        yield* Effect.flatMap(NotificationFeed, (feed) =>
          feed.create({
            workspaceId: seedWorkspaceRecord.id,
            userId: 'usr_dev',
            kind: 'workspace_member.role_changed',
            title: 'role',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        yield* Effect.flatMap(NotificationFeed, (feed) =>
          feed.create({
            workspaceId: seedWorkspaceRecord.id,
            userId: 'usr_not_a_member',
            kind: 'workspace_member.role_changed',
            title: 'role',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        expect(enqueued.map((message) => message.recipientUserId)).toEqual(['usr_dev'])
      })
  )
})

describe('seed notification feed: email and digest reads', () => {
  it.effect(
    'loadForEmail resolves the recipient, and null for read, unknown, or non-recipient',
    () =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        const loaded = yield* feed.loadForEmail('not_targeted', 'usr_dev')
        expect(loaded).toMatchObject({
          notification: { id: 'not_targeted', kind: 'workspace_member.role_changed' },
          recipient: { userId: 'usr_dev', email: 'engineer@example.com' },
          workspace: { slug: 'starter-lab', name: 'Starter Lab' }
        })
        expect(yield* feed.loadForEmail('not_targeted', 'usr_demo')).toBeNull()
        expect(yield* feed.loadForEmail('not_read', 'usr_demo')).toBeNull()
        expect(yield* feed.loadForEmail('not_missing', 'usr_demo')).toBeNull()
        expect(yield* feed.loadForEmail('not_stranger', 'usr_not_a_member')).toBeNull()
      }).pipe(Effect.provide(feedFor([])))
  )

  it.effect(
    'listDigestCandidates fans broadcasts to members and keeps only unread rows in the window',
    () =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        const candidates = yield* feed.listDigestCandidates({
          since: '2026-05-16T00:00:00.000Z',
          until: '2026-05-17T00:00:00.000Z'
        })
        // `not_old_unread` is before the window, `not_read` is read, and
        // `not_stranger` targets nobody in the roster — only the targeted row
        // for usr_dev is left.
        expect(candidates.map((candidate) => candidate.notification.id)).toEqual([
          'not_targeted'
        ])
        expect(candidates[0]?.recipient.userId).toBe('usr_dev')

        const wide = yield* feed.listDigestCandidates({
          since: '2026-04-01T00:00:00.000Z',
          until: '2026-05-17T00:00:00.000Z'
        })
        const broadcastRecipients = wide
          .filter((candidate) => candidate.notification.id === 'not_old_unread')
          .map((candidate) => candidate.recipient.userId)
          .toSorted()
        expect(broadcastRecipients).toEqual(
          seedMembers.map((member) => member.id).toSorted()
        )
      }).pipe(Effect.provide(feedFor([])))
  )
})

describe('enqueueInstantEmails', () => {
  const recipients = [
    { userId: 'usr_a', email: 'a@example.com', name: 'A' },
    { userId: 'usr_b', email: 'b@example.com', name: 'B' }
  ]
  const instantForAll: NotificationPreferencesInterface = {
    list: () => Effect.die('unused'),
    resolve: () => Effect.succeed('instant'),
    set: () => Effect.die('unused')
  }

  it.effect('does nothing without a queue binding or without recipients', () =>
    Effect.gen(function* () {
      const enqueued: Array<NotificationEmailQueueMessage> = []
      yield* enqueueInstantEmails(undefined, instantForAll, {
        notificationId: 'not_1',
        kind: 'api_token.created',
        recipients,
        traceparent: undefined
      })
      yield* enqueueInstantEmails(capturingQueue(enqueued), instantForAll, {
        notificationId: 'not_1',
        kind: 'api_token.created',
        recipients: [],
        traceparent: undefined
      })
      expect(enqueued).toEqual([])
    })
  )

  it.effect('stamps the traceparent and swallows a queue rejection', () =>
    Effect.gen(function* () {
      const enqueued: Array<NotificationEmailQueueMessage> = []
      yield* enqueueInstantEmails(capturingQueue(enqueued), instantForAll, {
        notificationId: 'not_1',
        kind: 'api_token.created',
        recipients,
        traceparent: '00-abc-def-01'
      })
      expect(enqueued).toEqual([
        {
          notificationId: 'not_1',
          recipientUserId: 'usr_a',
          traceparent: '00-abc-def-01'
        },
        {
          notificationId: 'not_1',
          recipientUserId: 'usr_b',
          traceparent: '00-abc-def-01'
        }
      ])

      const rejecting: NotificationEmailQueueBinding = {
        send: () => Promise.reject(new Error('queue down')),
        sendBatch: () => Promise.reject(new Error('queue down'))
      }
      // Best-effort: the producer never sees the failure.
      yield* enqueueInstantEmails(rejecting, instantForAll, {
        notificationId: 'not_1',
        kind: 'api_token.created',
        recipients,
        traceparent: undefined
      })
    })
  )

  it.effect('skips a recipient whose preference store is unreadable', () =>
    Effect.gen(function* () {
      const enqueued: Array<NotificationEmailQueueMessage> = []
      const flaky: NotificationPreferencesInterface = {
        ...instantForAll,
        resolve: (userId) => {
          if (userId === 'usr_a') {
            return Effect.fail(
              new CapabilityUnavailable({
                capability: 'notification-preferences',
                reason: 'unreadable'
              })
            )
          }
          return Effect.succeed('instant')
        }
      }
      yield* enqueueInstantEmails(capturingQueue(enqueued), flaky, {
        notificationId: 'not_1',
        kind: 'api_token.created',
        recipients,
        traceparent: undefined
      })
      expect(enqueued.map((message) => message.recipientUserId)).toEqual(['usr_b'])
    })
  )
})
