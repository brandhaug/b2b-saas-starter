import { describe, expect, it } from '@effect/vitest'
import { Effect, Logger } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { withRequestScope } from '@b2b-saas-starter/logger'
import { diagnosticAnnotations } from '@b2b-saas-starter/logger/sanitization'
import { publishWebhookEventForWorkspaceWith } from '../developer-platform/webhook-publisher.ts'
import { enqueueInstantEmails } from '../notifications/notification-fan-out.ts'
import { type NotificationPreferencesInterface } from '../notifications/notification-preferences.ts'

function capture() {
  const records: Array<ReturnType<typeof diagnosticAnnotations>> = []
  const layer = Logger.layer([
    Logger.map(Logger.formatStructured, (record) => {
      records.push(diagnosticAnnotations(record.annotations))
    })
  ])
  return { records, layer }
}

const preferences: NotificationPreferencesInterface = {
  list: () => Effect.succeed([]),
  resolve: () => Effect.succeed('instant'),
  set: (input) => Effect.succeed({ ...input, isDefault: false })
}
const notification = {
  notificationId: 'not_test',
  kind: 'webhook.delivery_failed',
  recipients: [{ userId: 'usr_test', email: 'member@example.test', name: 'Member' }],
  traceparent: undefined
} satisfies Parameters<typeof enqueueInstantEmails>[2]

describe('best-effort publication evidence', () => {
  it.effect(
    'retains a failed webhook publication on the successful request event',
    () => {
      const { records, layer } = capture()
      return Effect.gen(function* () {
        yield* withRequestScope(
          { service: 'web', event: 'token.revoke' },
          publishWebhookEventForWorkspaceWith(
            {
              publish: () => Effect.void,
              publishForWorkspace: () =>
                Effect.fail(
                  new CapabilityUnavailable({
                    capability: 'webhook-publisher',
                    reason: 'private-provider-diagnostic'
                  })
                ),
              enqueue: () => Effect.void
            },
            'wrk_test',
            { eventType: 'api_token.revoked', payload: { tokenId: 'tok_test' } }
          )
        )
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({ status: 'ok', webhookPublish: 'failed' })
        expect(records[0]).not.toHaveProperty('webhookPublishReason')
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect(
    'retains failed instant email enqueue evidence without failing the request',
    () => {
      const { records, layer } = capture()
      return Effect.gen(function* () {
        yield* withRequestScope(
          { service: 'web', event: 'notification.create' },
          enqueueInstantEmails(
            {
              send: () => Promise.resolve(),
              sendBatch: () => Promise.reject(new Error('private-provider-diagnostic'))
            },
            preferences,
            notification
          )
        )
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
          status: 'ok',
          notificationEmailEnqueue: 'failed',
          notificationEmailRecipients: 1
        })
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('retains the successful instant email enqueue count', () => {
    const { records, layer } = capture()
    return Effect.gen(function* () {
      yield* withRequestScope(
        { service: 'web', event: 'notification.create' },
        enqueueInstantEmails(
          { send: () => Promise.resolve(), sendBatch: () => Promise.resolve() },
          preferences,
          notification
        )
      )
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ status: 'ok', notificationEmailEnqueued: 1 })
      expect(records[0]).not.toHaveProperty('notificationEmailEnqueue')
    }).pipe(Effect.provide(layer))
  })
})
