import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { createDb } from '@b2b-saas-starter/db/client'
import { operationsNotificationIntents } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LogEmailDispatcherLayer,
  makeCloudflareEmailDispatcherLayer
} from '@b2b-saas-starter/email'
import { makeOperationsNotificationOutboxLayer } from '@b2b-saas-starter/capabilities/operations'
import {
  processOperationsNotification,
  readCapturedOperationsNotifications,
  resetCapturedOperationsNotifications
} from './operations-notifications.ts'

const now = '2026-07-19T12:00:00.000Z'

describe('Operations impersonation notification delivery', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
  }, 30_000)

  afterAll(async () => testD1?.dispose())
  beforeEach(() => resetCapturedOperationsNotifications())

  const addIntent = async (id: string) => {
    await db.insert(operationsNotificationIntents).values({
      id,
      impersonationId: `imp_${id}`,
      eventType: 'impersonation-started',
      recipientEmail: 'target@merchant.test',
      merchantId: 'mer_notification',
      merchantName: 'Notification Merchant',
      occurredAt: now,
      supportReference: 'SUP-42',
      securityContact: 'security@example.test',
      payloadJson: JSON.stringify({
        merchant: 'Notification Merchant',
        timestamp: now,
        supportReference: 'SUP-42',
        securityContact: 'security@example.test'
      }),
      availableAt: now,
      createdAt: now,
      updatedAt: now
    })
  }

  it('renders sanitized content once and uses the intent as the provider idempotency key', async () => {
    await addIntent('opnti_delivery')
    const send = vi.fn().mockResolvedValue(undefined)
    const program = processOperationsNotification({
      intentId: 'opnti_delivery',
      now,
      providerState: 'configured'
    }).pipe(
      Effect.provide(makeOperationsNotificationOutboxLayer(db)),
      Effect.provide(
        makeCloudflareEmailDispatcherLayer(
          { send },
          { defaultFrom: 'security@example.test' }
        )
      )
    )

    await Effect.runPromise(program)
    await Effect.runPromise(program)

    expect(send).toHaveBeenCalledOnce()
    const message = send.mock.calls[0]?.[0]
    expect(message).toMatchObject({
      idempotencyKey: 'opnti_delivery',
      to: 'target@merchant.test',
      subject: 'Staff access to Notification Merchant has started'
    })
    expect(message.text).toContain('Notification Merchant')
    expect(message.text).toContain(now)
    expect(message.text).toContain('SUP-42')
    expect(message.text).toContain('security@example.test')
    expect(message.text).not.toContain('Operator')
    expect(message.text).not.toContain('Investigate')
  })

  it('captures deterministically in local development without a provider', async () => {
    await addIntent('opnti_capture')

    await Effect.runPromise(
      processOperationsNotification({
        intentId: 'opnti_capture',
        now,
        providerState: 'capture'
      }).pipe(
        Effect.provide(makeOperationsNotificationOutboxLayer(db)),
        Effect.provide(LogEmailDispatcherLayer)
      )
    )

    expect(readCapturedOperationsNotifications()).toEqual([
      {
        idempotencyKey: 'opnti_capture',
        to: 'target@merchant.test',
        merchant: 'Notification Merchant',
        occurredAt: now,
        supportReference: 'SUP-42',
        securityContact: 'security@example.test'
      }
    ])
  })

  it('records provider failure for retry without failing the committed lifecycle', async () => {
    await addIntent('opnti_retry')
    const scheduleRetry = vi.fn().mockResolvedValue(undefined)

    await Effect.runPromise(
      processOperationsNotification({
        intentId: 'opnti_retry',
        now,
        providerState: 'configured',
        scheduleRetry
      }).pipe(
        Effect.provide(makeOperationsNotificationOutboxLayer(db)),
        Effect.provide(
          makeCloudflareEmailDispatcherLayer(
            { send: async () => Promise.reject(new Error('provider unavailable')) },
            { defaultFrom: 'security@example.test' }
          )
        )
      )
    )

    expect(scheduleRetry).toHaveBeenCalledWith('opnti_retry', 30)
  })
})
