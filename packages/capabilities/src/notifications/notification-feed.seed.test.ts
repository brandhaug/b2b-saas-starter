import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { Effect, Layer, Logger } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { withRequestScope } from '@b2b-saas-starter/logger'
import { diagnosticAnnotations } from '@b2b-saas-starter/logger/sanitization'
import {
  AccountPreferencesService,
  SeedAccountPreferences
} from '../governance/account-preferences.ts'
import { SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { seedMembers, seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext, WorkspaceContext } from '../workspace-context.ts'
import {
  type NotificationEmailQueueBinding,
  type NotificationEmailQueueMessage
} from './notification-email-queue.ts'
import { enqueueInstantEmails } from './notification-fan-out.ts'
import { SeedNotificationFeed } from './notification-feed.seed.ts'
import {
  inDigestWindow,
  NotificationFeed,
  type NotifyWorkspaceOwnersInput,
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
    userId: UserId.make('usr_dev')
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
    userId: UserId.make('usr_not_a_member')
  }
]

function feedFor(
  enqueued: Array<NotificationEmailQueueMessage>,
  preferences: ReadonlyArray<{
    readonly userId: UserId
    readonly kind: SeedNotification['kind']
    readonly channel: 'off' | 'instant' | 'digest'
  }> = []
) {
  const audit = SeedAuditEventLog([])
  const prefs = SeedNotificationPreferences(preferences).pipe(Layer.provide(audit))
  const accountPreferences = SeedAccountPreferences([]).pipe(Layer.provide(audit))
  return Layer.mergeAll(
    prefs,
    accountPreferences,
    SeedNotificationFeed(seeded, fixture, {
      emailQueue: capturingQueue(enqueued)
    }).pipe(Layer.provide(Layer.merge(prefs, accountPreferences)))
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
            userId: UserId.make('usr_demo'),
            role: 'owner',
            systemRole: 'admin',
            banned: false
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
          {
            userId: UserId.make('usr_demo'),
            kind: 'api_token.created',
            channel: 'digest'
          },
          { userId: UserId.make('usr_ops'), kind: 'api_token.created', channel: 'off' }
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
            workspaceId: WorkspaceId.make('wrk_elsewhere'),
            userId: UserId.make('usr_demo'),
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
            userId: UserId.make('usr_dev'),
            kind: 'workspace_member.role_changed',
            title: 'role',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        yield* Effect.flatMap(NotificationFeed, (feed) =>
          feed.create({
            workspaceId: seedWorkspaceRecord.id,
            userId: UserId.make('usr_not_a_member'),
            kind: 'workspace_member.role_changed',
            title: 'role',
            message: 'm'
          })
        ).pipe(Effect.provide(layer))
        expect(enqueued.map((message) => message.recipientUserId)).toEqual(['usr_dev'])
      })
  )
})

describe('seed notification feed: notifyWorkspaceOwners', () => {
  it.effect(
    'records one owner-only row per owner, emailing each per their channel',
    () => {
      const enqueued: Array<NotificationEmailQueueMessage> = []
      // The demo owner takes webhook failures instantly; the other owner
      // stays on the kind's digest default.
      const layer = feedFor(enqueued, [
        {
          userId: UserId.make('usr_demo'),
          kind: 'webhook.delivery_failed',
          channel: 'instant'
        }
      ])
      const ladderNotice = {
        workspaceId: seedWorkspaceRecord.id,
        kind: 'webhook.delivery_failed',
        title: 'Webhook endpoint failing',
        message: 'https://example.com/hook has failed 5 deliveries in a row.'
      } satisfies NotifyWorkspaceOwnersInput
      return Effect.gen(function* () {
        const feed = yield* NotificationFeed
        yield* feed.notifyWorkspaceOwners(ladderNotice)
        // The fixture roster's owners are usr_demo and usr_martin; one row
        // each, and a row is visible only to its reader — the member and the
        // admin see none of them.
        function visibleTo(actor: {
          userId: UserId
          role: 'owner' | 'admin' | 'member'
          systemRole: 'admin' | 'user'
        }) {
          return feed.list.pipe(
            Effect.provideService(WorkspaceContext, {
              workspace: seedWorkspaceRecord,
              actor: { ...actor, banned: false },
              actorType: 'user'
            })
          )
        }
        function titled(rows: ReadonlyArray<{ title: string }>) {
          return rows.filter((row) => row.title === ladderNotice.title)
        }
        expect(
          titled(
            yield* visibleTo({
              userId: UserId.make('usr_demo'),
              role: 'owner',
              systemRole: 'admin'
            })
          )
        ).toHaveLength(1)
        expect(
          titled(
            yield* visibleTo({
              userId: UserId.make('usr_martin'),
              role: 'owner',
              systemRole: 'admin'
            })
          )
        ).toHaveLength(1)
        expect(
          titled(
            yield* visibleTo({
              userId: UserId.make('usr_dev'),
              role: 'member',
              systemRole: 'user'
            })
          )
        ).toHaveLength(0)
        expect(
          titled(
            yield* visibleTo({
              userId: UserId.make('usr_ops'),
              role: 'admin',
              systemRole: 'user'
            })
          )
        ).toHaveLength(0)
        // One enqueue per row, resolved per owner's channel: only the owner
        // who chose instant gets a message.
        expect(enqueued.map((message) => message.recipientUserId)).toEqual(['usr_demo'])
        // The fixture knows one workspace: any other id owns no rows.
        yield* feed.notifyWorkspaceOwners({
          ...ladderNotice,
          workspaceId: WorkspaceId.make('wrk_elsewhere')
        })
        expect(enqueued).toHaveLength(1)
        expect(
          titled(
            yield* visibleTo({
              userId: UserId.make('usr_demo'),
              role: 'owner',
              systemRole: 'admin'
            })
          )
        ).toHaveLength(1)
      }).pipe(Effect.provide(layer))
    }
  )
})

describe('seed notification feed: email and digest reads', () => {
  it.effect('reads current account preferences for digest recipients', () => {
    const audit = SeedAuditEventLog([])
    const accountPreferences = SeedAccountPreferences([
      { userId: UserId.make('usr_demo'), locale: null, timeZone: null }
    ]).pipe(Layer.provide(audit))
    const notificationPreferences = SeedNotificationPreferences([]).pipe(
      Layer.provide(audit)
    )
    const feed = SeedNotificationFeed([], fixture).pipe(
      Layer.provide(Layer.merge(accountPreferences, notificationPreferences))
    )
    const layer = Layer.mergeAll(
      audit,
      accountPreferences,
      notificationPreferences,
      feed
    )
    return Effect.gen(function* () {
      const service = yield* AccountPreferencesService
      const notifications = yield* NotificationFeed
      yield* notifications.create({
        workspaceId: seedWorkspaceRecord.id,
        userId: UserId.make('usr_demo'),
        kind: 'announcement',
        title: 'Notice',
        message: 'Message'
      })
      yield* service.set({
        userId: UserId.make('usr_demo'),
        locale: 'nb',
        timeZone: 'Europe/Oslo'
      })
      const candidates = yield* notifications.listDigestCandidates({
        since: '1970-01-01T00:00:00.000Z',
        until: '2999-01-01T00:00:00.000Z'
      })
      expect(candidates[0]?.recipient).toMatchObject({
        userId: UserId.make('usr_demo'),
        locale: 'nb',
        timeZone: 'Europe/Oslo'
      })
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'loadForEmail resolves the recipient, and null for read, unknown, or non-recipient',
    () =>
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        const loaded = yield* feed.loadForEmail('not_targeted', UserId.make('usr_dev'))
        expect(loaded).toMatchObject({
          notification: { id: 'not_targeted', kind: 'workspace_member.role_changed' },
          recipient: { userId: UserId.make('usr_dev'), email: 'engineer@example.com' },
          workspace: {
            id: WorkspaceId.make('wrk_starter'),
            slug: 'starter-lab',
            name: 'Starter Lab'
          }
        })
        expect(
          yield* feed.loadForEmail('not_targeted', UserId.make('usr_demo'))
        ).toBeNull()
        expect(yield* feed.loadForEmail('not_read', UserId.make('usr_demo'))).toBeNull()
        expect(
          yield* feed.loadForEmail('not_missing', UserId.make('usr_demo'))
        ).toBeNull()
        expect(
          yield* feed.loadForEmail('not_stranger', UserId.make('usr_not_a_member'))
        ).toBeNull()
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
    { userId: UserId.make('usr_a'), email: 'a@example.com', name: 'A' },
    { userId: UserId.make('usr_b'), email: 'b@example.com', name: 'B' }
  ]
  const instantForAll: NotificationPreferencesInterface = {
    list: () => Effect.die('unused'),
    resolve: () => Effect.die('unused'),
    resolveForUsers: (userIds) =>
      Effect.succeed(new Map(userIds.map((userId) => [userId, 'instant'] as const))),
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
          recipientUserId: UserId.make('usr_a'),
          traceparent: '00-abc-def-01'
        },
        {
          notificationId: 'not_1',
          recipientUserId: UserId.make('usr_b'),
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

  const crowd = Array.from({ length: 250 }, (_, index) => ({
    userId: UserId.make(`usr_${String(index).padStart(3, '0')}`),
    email: `member${index}@example.com`,
    name: `Member ${index}`
  }))

  it.effect(
    'sends at most 100 messages per batch and reads preferences per batch',
    () =>
      Effect.gen(function* () {
        const batches: Array<number> = []
        const preferenceReads: Array<number> = []
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const counting: NotificationPreferencesInterface = {
          ...instantForAll,
          resolveForUsers: (userIds, kind) => {
            preferenceReads.push(userIds.length)
            return instantForAll.resolveForUsers(userIds, kind)
          }
        }
        const queue: NotificationEmailQueueBinding = {
          send: () => Promise.reject(new Error('unused')),
          sendBatch: (messages) => {
            const bodies = Array.from(messages, (message) => message.body)
            if (bodies.length > 100) {
              return Promise.reject(new Error('batch over the Queues limit'))
            }
            batches.push(bodies.length)
            enqueued.push(...bodies)
            return Promise.resolve()
          }
        }
        yield* enqueueInstantEmails(queue, counting, {
          notificationId: 'not_1',
          kind: 'webhook.delivery_failed',
          recipients: crowd,
          traceparent: undefined
        })
        expect(batches).toEqual([100, 100, 50])
        expect(preferenceReads).toEqual([100, 100, 50])
        expect(enqueued.map((message) => message.recipientUserId)).toEqual(
          crowd.map((recipient) => recipient.userId)
        )
      })
  )

  it.effect(
    'a rejected batch or unreadable preference read drops only its own batch',
    () => {
      const records: Array<ReturnType<typeof diagnosticAnnotations>> = []
      const capture = Logger.layer([
        Logger.map(Logger.formatStructured, (record) => {
          records.push(diagnosticAnnotations(record.annotations))
        })
      ])
      return Effect.gen(function* () {
        const enqueued: Array<NotificationEmailQueueMessage> = []
        const flaky: NotificationPreferencesInterface = {
          ...instantForAll,
          resolveForUsers: (userIds, kind) => {
            if (userIds.includes(UserId.make('usr_100'))) {
              return Effect.fail(
                new CapabilityUnavailable({
                  capability: 'notification-preferences',
                  reason: 'unreadable'
                })
              )
            }
            return instantForAll.resolveForUsers(userIds, kind)
          }
        }
        const queue: NotificationEmailQueueBinding = {
          send: () => Promise.reject(new Error('unused')),
          sendBatch: (messages) => {
            const bodies = Array.from(messages, (message) => message.body)
            if (bodies.some((body) => body.recipientUserId === 'usr_000')) {
              return Promise.reject(new Error('queue down'))
            }
            enqueued.push(...bodies)
            return Promise.resolve()
          }
        }
        yield* withRequestScope(
          { service: 'web', event: 'notification.create' },
          enqueueInstantEmails(queue, flaky, {
            notificationId: 'not_1',
            kind: 'webhook.delivery_failed',
            recipients: crowd,
            traceparent: undefined
          })
        )
        expect(enqueued.map((message) => message.recipientUserId)).toEqual(
          crowd.slice(200).map((recipient) => recipient.userId)
        )
        // Totals across batches; concurrent batches leave whichever failure
        // reason annotated last.
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          status: 'ok',
          notificationEmailEnqueue: 'failed',
          notificationEmailRecipients: 200,
          notificationEmailEnqueued: 50
        })
        expect(records[0]).toHaveProperty(
          'notificationEmailEnqueueReason',
          expect.stringMatching(/^(preferences_unavailable|queue_rejected)$/)
        )
      }).pipe(Effect.provide(capture))
    }
  )
})
