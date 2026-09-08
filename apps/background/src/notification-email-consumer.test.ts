import {
  NotificationFeed,
  type NotificationEmailContext
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { NotificationEmailQueueMessage } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import {
  NotificationPreferences,
  SeedNotificationPreferences,
  type SeedNotificationPreference
} from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  WorkspaceSuspended,
  WorkspaceSuspensionService
} from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { SeedEmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery.seed'
import { EmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import {
  EmailDispatcher,
  type EmailDeliveryResult,
  EmailSendError,
  type EmailMessage
} from '@b2b-saas-starter/email'
import { render } from 'react-email'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'

import { processNotificationEmailMessage } from './notification-email-consumer.ts'
import { readDelivery } from './queue-consumer.ts'
import { appUrlFrom, openUrlFor, preferencesUrl } from './notification-links.ts'

const context: NotificationEmailContext = {
  notification: {
    id: 'not_1',
    kind: 'api_token.created',
    title: 'API token created',
    message: 'Ops Lead minted "MCP local client".',
    createdAt: '2026-09-02T10:00:00.000Z',
    read: false
  },
  recipient: { userId: 'usr_owner', email: 'owner@example.com', name: 'Owner' },
  workspace: { id: 'wrk_1', slug: 'starter-lab', name: 'Starter Lab' }
}

function stubFeed(
  found: NotificationEmailContext | null
): Layer.Layer<NotificationFeed> {
  return Layer.succeed(NotificationFeed)({
    list: Effect.die('unused'),
    listPage: () => Effect.die('unused'),
    unreadCount: Effect.die('unused'),
    markRead: () => Effect.die('unused'),
    notifyUser: () => Effect.die('unused'),
    prepareWorkspaceOwners: () => Effect.succeed({ writes: [], publish: Effect.void }),
    notifyWorkspaceOwners: () => Effect.die('unused'),
    create: () => Effect.die('unused'),
    loadForEmail: () => Effect.succeed(found),
    record: () => Effect.die('unused'),
    listDigestCandidates: () => Effect.die('unused')
  })
}

function stubDispatcher(
  sent: Array<EmailMessage>,
  fail = false,
  providerAccepted = false
): Layer.Layer<EmailDispatcher> {
  return Layer.succeed(EmailDispatcher)({
    send: (message) => {
      if (fail) {
        return Effect.fail(
          new EmailSendError({
            message: 'boom',
            to: message.to,
            subject: message.subject,
            failureKind: 'transient'
          })
        )
      }
      return Effect.sync(() => {
        sent.push(message)
        if (providerAccepted) {
          return {
            mode: 'cloudflare-email',
            to: message.to,
            subject: message.subject,
            providerMessageId: 'provider_notification_1'
          } satisfies EmailDeliveryResult
        }
        return {
          mode: 'log',
          to: message.to,
          subject: message.subject
        } satisfies EmailDeliveryResult
      })
    }
  })
}

const audit = SeedAuditEventLog([])

function run(
  found: NotificationEmailContext | null,
  body: unknown,
  options: {
    readonly channel?: 'off' | 'instant' | 'digest'
    readonly fail?: boolean
  } = {}
) {
  const sent: Array<EmailMessage> = []
  const stored: Array<SeedNotificationPreference> = []
  if (options.channel !== undefined) {
    stored.push({
      userId: 'usr_owner',
      kind: 'api_token.created',
      channel: options.channel
    })
  }
  const preferences = SeedNotificationPreferences(stored).pipe(Layer.provide(audit))
  const activeSuspension = Layer.succeed(WorkspaceSuspensionService)({
    list: Effect.succeed([]),
    get: () => Effect.die('unused'),
    requireAllowed: () => Effect.void,
    transition: () => Effect.die('unused')
  })
  return processNotificationEmailMessage(
    readDelivery(NotificationEmailQueueMessage, {
      id: 'q1',
      body,
      attempts: 1
    }),
    'https://app.test'
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        stubFeed(found),
        preferences,
        stubDispatcher(sent, options.fail),
        SeedEmailDelivery(),
        activeSuspension
      )
    ),
    Effect.map((outcome) => ({ outcome, sent }))
  )
}

const message = { notificationId: 'not_1', recipientUserId: 'usr_owner' }

describe('processNotificationEmailMessage', () => {
  it.effect('renders the kind template and sends it to the recipient', () =>
    Effect.gen(function* () {
      const { outcome, sent } = yield* run(context, message)
      expect(outcome).toBe('ack')
      expect(sent).toHaveLength(1)
      expect(sent[0]?.to).toBe('owner@example.com')
      expect(sent[0]?.subject).toBe(
        '[B2B SaaS Starter] API token created: API token created'
      )
      const html = yield* Effect.promise(() => render(sent[0]!.element))
      expect(html).toContain('Ops Lead minted')
      expect(html).toContain('https://app.test/workspaces/starter-lab/api-tokens')
      expect(html).toContain(
        'https://app.test/account/notifications?kind=api_token.created'
      )
    })
  )

  it.effect('acks without sending when the recipient moved the kind off instant', () =>
    Effect.gen(function* () {
      const digest = yield* run(context, message, { channel: 'digest' })
      const off = yield* run(context, message, { channel: 'off' })
      expect(digest).toEqual({ outcome: 'ack', sent: [] })
      expect(off).toEqual({ outcome: 'ack', sent: [] })
    })
  )

  it.effect('settles a queued business email when the workspace is suspended', () => {
    const sent: Array<EmailMessage> = []
    return Effect.gen(function* () {
      const outcome = yield* processNotificationEmailMessage(
        readDelivery(NotificationEmailQueueMessage, {
          id: 'q-suspended',
          body: message,
          attempts: 1
        }),
        'https://app.test'
      )
      const delivery = yield* EmailDelivery
      const record = yield* delivery.get('notification:not_1:usr_owner')
      expect(outcome).toBe('ack')
      expect(sent).toHaveLength(0)
      expect(record?.status).toBe('failed')
      expect(record?.reason).toBe('workspace_suspended')
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubFeed({
            ...context,
            notification: { ...context.notification, kind: 'announcement' }
          }),
          SeedNotificationPreferences([
            { userId: 'usr_owner', kind: 'announcement', channel: 'instant' }
          ]).pipe(Layer.provide(audit)),
          stubDispatcher(sent),
          SeedEmailDelivery(),
          Layer.succeed(WorkspaceSuspensionService)({
            list: Effect.succeed([]),
            get: () => Effect.die('unused'),
            requireAllowed: () =>
              Effect.fail(new WorkspaceSuspended({ workspaceId: 'wrk_1' })),
            transition: () => Effect.die('unused')
          })
        )
      )
    )
  })

  it.effect('acks without sending when the notification is gone or already read', () =>
    Effect.gen(function* () {
      const { outcome, sent } = yield* run(null, message)
      expect(outcome).toBe('ack')
      expect(sent).toHaveLength(0)
    })
  )

  it.effect('acks a malformed message as terminal', () =>
    Effect.gen(function* () {
      const { outcome, sent } = yield* run(context, { notificationId: 42 })
      expect(outcome).toBe('ack')
      expect(sent).toHaveLength(0)
    })
  )

  it.effect('surfaces a send failure so the queue retries', () =>
    Effect.gen(function* () {
      const result = yield* run(context, message, { fail: true })
      expect(result).toEqual({
        outcome: { retryAfterSeconds: 60 },
        sent: []
      })
    })
  )

  it.effect('retries when an active delivery lease skips the send', () => {
    const sent: Array<EmailMessage> = []
    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(context.notification.createdAt))
      const delivery = yield* EmailDelivery
      const claim = yield* delivery.claim({
        id: 'notification:not_1:usr_owner',
        purpose: 'notification',
        recipient: context.recipient.email,
        userId: context.recipient.userId,
        workspaceId: null,
        queuedAt: context.notification.createdAt
      })
      expect(claim).not.toBeNull()
      const outcome = yield* processNotificationEmailMessage(
        readDelivery(NotificationEmailQueueMessage, {
          id: 'q1',
          body: message,
          attempts: 1
        }),
        'https://app.test'
      )
      expect(outcome).toEqual({ retryAfterSeconds: 300 })
      expect(sent).toHaveLength(0)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubFeed(context),
          SeedNotificationPreferences([]).pipe(Layer.provide(audit)),
          stubDispatcher(sent),
          SeedEmailDelivery(),
          Layer.succeed(WorkspaceSuspensionService)({
            list: Effect.succeed([]),
            get: () => Effect.die('unused'),
            requireAllowed: () => Effect.void,
            transition: () => Effect.die('unused')
          })
        )
      )
    )
  })

  it.effect(
    'does not resend a provider-accepted notification on queue redelivery',
    () => {
      const sent: Array<EmailMessage> = []
      return Effect.gen(function* () {
        const first = yield* processNotificationEmailMessage(
          readDelivery(NotificationEmailQueueMessage, {
            id: 'q1',
            body: message,
            attempts: 1
          }),
          'https://app.test'
        )
        const second = yield* processNotificationEmailMessage(
          readDelivery(NotificationEmailQueueMessage, {
            id: 'q1',
            body: message,
            attempts: 2
          }),
          'https://app.test'
        )
        expect(first).toBe('ack')
        expect(second).toBe('ack')
        expect(sent).toHaveLength(1)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            stubFeed(context),
            SeedNotificationPreferences([]).pipe(Layer.provide(audit)),
            stubDispatcher(sent, false, true),
            SeedEmailDelivery(),
            Layer.succeed(WorkspaceSuspensionService)({
              list: Effect.succeed([]),
              get: () => Effect.die('unused'),
              requireAllowed: () => Effect.void,
              transition: () => Effect.die('unused')
            })
          )
        )
      )
    }
  )

  it.effect('rechecks preferences before retrying a transient failure', () =>
    Effect.gen(function* () {
      const sent: Array<EmailMessage> = []
      const preferences = yield* NotificationPreferences
      const first = yield* processNotificationEmailMessage(
        readDelivery(NotificationEmailQueueMessage, {
          id: 'q1',
          body: message,
          attempts: 1
        }),
        'https://app.test'
      )
      yield* preferences.set({
        userId: 'usr_owner',
        kind: 'api_token.created',
        channel: 'off'
      })
      const second = yield* processNotificationEmailMessage(
        readDelivery(NotificationEmailQueueMessage, {
          id: 'q1',
          body: message,
          attempts: 2
        }),
        'https://app.test'
      )
      expect(first).toEqual({ retryAfterSeconds: 60 })
      expect(second).toBe('ack')
      expect(sent).toHaveLength(0)
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          stubFeed(context),
          SeedNotificationPreferences([]).pipe(Layer.provide(audit)),
          stubDispatcher([], true),
          SeedEmailDelivery(),
          Layer.succeed(WorkspaceSuspensionService)({
            list: Effect.succeed([]),
            get: () => Effect.die('unused'),
            requireAllowed: () => Effect.void,
            transition: () => Effect.die('unused')
          })
        )
      )
    )
  )

  it.effect(
    'schedules transient notification retries until the 24-hour window expires',
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 8, 2, 10, 0, 0))
        const sent: Array<EmailMessage> = []
        let outcome = yield* processNotificationEmailMessage(
          readDelivery(NotificationEmailQueueMessage, {
            id: 'q1',
            body: message,
            attempts: 1
          }),
          'https://app.test'
        )
        let attempt = 1
        while (outcome !== 'ack' && outcome !== 'retry') {
          yield* TestClock.adjust(Duration.seconds(outcome.retryAfterSeconds))
          attempt += 1
          outcome = yield* processNotificationEmailMessage(
            readDelivery(NotificationEmailQueueMessage, {
              id: 'q1',
              body: message,
              attempts: attempt
            }),
            'https://app.test'
          )
        }
        expect(outcome).toBe('ack')
        expect(attempt).toBeGreaterThan(1)
        expect(attempt).toBeLessThan(300)
        expect(sent).toHaveLength(0)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            stubFeed(context),
            SeedNotificationPreferences([]).pipe(Layer.provide(audit)),
            stubDispatcher([], true),
            SeedEmailDelivery(),
            Layer.succeed(WorkspaceSuspensionService)({
              list: Effect.succeed([]),
              get: () => Effect.die('unused'),
              requireAllowed: () => Effect.void,
              transition: () => Effect.die('unused')
            })
          )
        )
      )
  )
})

describe('notification links', () => {
  it('falls back to the dev server and strips a trailing slash', () => {
    expect(appUrlFrom({})).toBe('http://localhost:3071')
    expect(appUrlFrom({ BETTER_AUTH_URL: null })).toBe('http://localhost:3071')
    expect(appUrlFrom({ BETTER_AUTH_URL: 'https://app.test/' })).toBe(
      'https://app.test'
    )
  })

  it('points each kind at the surface that owns it', () => {
    expect(openUrlFor('https://app.test', context)).toBe(
      'https://app.test/workspaces/starter-lab/api-tokens'
    )
    expect(
      openUrlFor('https://app.test', {
        ...context,
        notification: { ...context.notification, kind: 'webhook.delivery_failed' }
      })
    ).toBe('https://app.test/workspaces/starter-lab/webhooks')
    expect(openUrlFor('https://app.test', { ...context, workspace: null })).toBe(
      'https://app.test/account'
    )
    expect(preferencesUrl('https://app.test', 'announcement')).toBe(
      'https://app.test/account/notifications?kind=announcement'
    )
  })
})
