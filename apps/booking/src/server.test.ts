import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@b2b-saas-starter/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@b2b-saas-starter/logger')>()),
  reportOperationalError: vi.fn(async () => undefined)
}))

vi.mock('cloudflare:workers', () => ({
  env: {
    DB: {} as D1Database,
    PUBLIC_SITE_ORIGIN: 'http://localhost:3071',
    CONFIRMATION_CURRENT_KEY_ID: 'test',
    CUSTOMER_DIRECTORY_FINGERPRINT_KEY: 'booking-server-test-directory-key',
    CONFIRMATION_SIGNING_KEYS: '{"test":"test-key"}',
    OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY: 'test-encryption-key',
    OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY: 'test-fingerprint-key',
    OPERATIONAL_MESSAGING_DESTINATION_KEY_VERSION: '1'
  }
}))

vi.mock('./lib/booking-session-http.ts', () => ({
  handleBookingSessionRequest: () => Effect.succeed(new Response('Booking App reached'))
}))

import { reportOperationalError } from '@b2b-saas-starter/logger'
import worker, {
  publishBookingWakeUp,
  reconcilePaymentAndResumeGiftCard,
  reconcilePaymentCallback,
  resolvePartyCancellationBookingPartyId
} from './server.ts'

describe('Booking Worker entry', () => {
  it('uses the local Worker environment when Vite omits the fetch env argument', async () => {
    const response = await worker.fetch(
      new Request('http://localhost:3073/adda/booking')
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('Booking App reached')
  })

  it('reports missing required Worker bindings without exposing values', async () => {
    const response = await worker.fetch(
      new Request('http://localhost:3073/adda/booking', {
        headers: { 'x-trace-id': 'trace-missing-booking-env' }
      }),
      { PUBLIC_SITE_ORIGIN: 'http://localhost:3071' } as never
    )

    expect(response.status).toBe(503)
    expect(reportOperationalError).toHaveBeenCalledWith({
      service: 'booking',
      event: 'booking.worker_unavailable',
      traceId: 'trace-missing-booking-env',
      pathname: '/adda/booking',
      failure: 'missing_worker_bindings',
      details: {
        missingBindings: [
          'DB',
          'CONFIRMATION_SIGNING_KEYS',
          'CONFIRMATION_CURRENT_KEY_ID',
          'CUSTOMER_DIRECTORY_FINGERPRINT_KEY'
        ]
      }
    })
  })

  it('keeps committed success visible when the queue wake-up fails', async () => {
    const committed = {
      outboxId: 'obx_committed',
      outboxIds: ['obx_committed'],
      notificationIntentIds: ['nti_committed'],
      appointmentId: 'apt_committed'
    }
    const queue = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) }
    await expect(publishBookingWakeUp(queue, committed)).resolves.toBe(committed)
    expect(queue.send).toHaveBeenNthCalledWith(1, {
      version: 1,
      kind: 'booking-outbox',
      outboxId: 'obx_committed'
    })
    expect(queue.send).toHaveBeenNthCalledWith(2, {
      version: 1,
      kind: 'notification-intent',
      intentId: 'nti_committed'
    })
  })

  it('requires party-purpose access before resolving whole-party cancellation', async () => {
    const rows = new Map([
      [
        'cnf_individual',
        {
          merchantId: 'mer_mara',
          purpose: 'appointment_confirmation',
          bookingPartyId: 'bpt_mara'
        }
      ],
      [
        'cnf_party',
        {
          merchantId: 'mer_mara',
          purpose: 'party_confirmation',
          bookingPartyId: 'bpt_mara'
        }
      ]
    ])
    const db = {
      prepare: (sql: string) => ({
        bind: (routeId: string, merchantId: string, purpose: 'party_confirmation') => ({
          first: async () => {
            const row = rows.get(routeId)
            return sql.includes('confirmation_access.purpose = ?') &&
              row?.merchantId === merchantId &&
              row.purpose === purpose
              ? { bookingPartyId: row.bookingPartyId }
              : null
          }
        })
      })
    } as unknown as D1Database

    await expect(
      resolvePartyCancellationBookingPartyId(db, 'mer_mara', 'cnf_individual')
    ).resolves.toBeNull()
    await expect(
      resolvePartyCancellationBookingPartyId(db, 'mer_mara', 'cnf_party')
    ).resolves.toBe('bpt_mara')
  })

  it('accepts only provider-verified callback facts for reconciliation', async () => {
    const reconcile = vi.fn(async () => undefined)
    const binding = {
      fetch: vi.fn(async () =>
        Response.json({
          paymentId: 'pay_callback',
          providerEventId: 'evt_callback',
          facts: [
            {
              kind: 'capture',
              amountMinor: 5000,
              currency: 'USD',
              providerReference: 'ch_callback',
              occurredAt: '2026-07-12T12:00:00.000Z'
            }
          ]
        })
      )
    }
    const response = await reconcilePaymentCallback(
      new Request('https://example.test/mara/booking/payment-callback/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'signed' },
        body: '{}'
      }),
      'stripe',
      binding,
      reconcile
    )
    expect(response.status).toBe(204)
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_callback',
        providerEventId: 'evt_callback'
      })
    )
  })

  it('continues captured Gift Card payments into retryable issuance', async () => {
    const resume = vi.fn(async () => undefined)
    const view = { payment: { id: 'pay_gift_async', status: 'captured' } }
    await expect(
      reconcilePaymentAndResumeGiftCard(async () => view, resume)
    ).resolves.toBe(view)
    expect(resume).toHaveBeenCalledWith('pay_gift_async')
  })

  it('continues terminal Gift Card payment facts into cancellation or refund', async () => {
    for (const status of ['cancelled', 'refunded']) {
      const resume = vi.fn(async () => undefined)
      await reconcilePaymentAndResumeGiftCard(
        async () => ({ payment: { id: `pay_${status}`, status } }),
        resume
      )
      expect(resume).toHaveBeenCalledWith(`pay_${status}`)
    }
  })
})
