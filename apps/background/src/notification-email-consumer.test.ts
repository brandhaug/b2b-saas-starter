import {
  NotificationFeed,
  type NotificationEmailContext
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import {
  SeedNotificationPreferences,
  type SeedNotificationPreference
} from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  EmailDispatcher,
  EmailSendError,
  type EmailMessage
} from '@b2b-saas-starter/email'
import { render } from '@react-email/render'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import {
  processNotificationEmailMessage,
  readNotificationEmailDelivery
} from './notification-email-consumer.ts'
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
  workspace: { slug: 'starter-lab', name: 'Starter Lab' }
}

function stubFeed(
  found: NotificationEmailContext | null
): Layer.Layer<NotificationFeed> {
  return Layer.succeed(NotificationFeed)({
    list: Effect.die('unused'),
    unreadCount: Effect.die('unused'),
    markRead: () => Effect.die('unused'),
    notifyUser: () => Effect.die('unused'),
    create: () => Effect.die('unused'),
    loadForEmail: () => Effect.succeed(found),
    listDigestCandidates: () => Effect.die('unused')
  })
}

function stubDispatcher(
  sent: Array<EmailMessage>,
  fail = false
): Layer.Layer<EmailDispatcher> {
  return Layer.succeed(EmailDispatcher)({
    send: (message) => {
      if (fail) {
        return Effect.fail(
          new EmailSendError({
            message: 'boom',
            to: message.to,
            subject: message.subject
          })
        )
      }
      return Effect.sync(() => {
        sent.push(message)
        return { mode: 'log', to: message.to, subject: message.subject }
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
  return Effect.scoped(
    processNotificationEmailMessage(
      readNotificationEmailDelivery({ id: 'q1', body, attempts: 1 }),
      'https://app.test'
    ).pipe(
      Effect.provide(
        Layer.mergeAll(stubFeed(found), preferences, stubDispatcher(sent, options.fail))
      )
    )
  ).pipe(Effect.map((outcome) => ({ outcome, sent })))
}

const message = { notificationId: 'not_1', recipientUserId: 'usr_owner' }

describe('processNotificationEmailMessage', () => {
  it('renders the kind template and sends it to the recipient', () =>
    Effect.runPromise(
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
    ))

  it('acks without sending when the recipient moved the kind off instant', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const digest = yield* run(context, message, { channel: 'digest' })
        const off = yield* run(context, message, { channel: 'off' })
        expect(digest).toEqual({ outcome: 'ack', sent: [] })
        expect(off).toEqual({ outcome: 'ack', sent: [] })
      })
    ))

  it('acks without sending when the notification is gone or already read', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { outcome, sent } = yield* run(null, message)
        expect(outcome).toBe('ack')
        expect(sent).toHaveLength(0)
      })
    ))

  it('acks a malformed message as terminal', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { outcome, sent } = yield* run(context, { notificationId: 42 })
        expect(outcome).toBe('ack')
        expect(sent).toHaveLength(0)
      })
    ))

  it('surfaces a send failure so the queue retries', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const error = yield* Effect.flip(run(context, message, { fail: true }))
        expect(error._tag).toBe('EmailSendError')
      })
    ))
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
