import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { BookingNotificationOutbox } from '@b2b-saas-starter/capabilities'
import { EmailDispatcher } from '@b2b-saas-starter/email'
import {
  BOOKING_RETRY_DELAYS,
  classifyBookingResponse,
  processBookingOutbox,
  signBookingWebhook
} from './booking-notifications.ts'

describe('booking webhook contract', () => {
  it('matches a fixed HMAC-SHA256 raw-body signature vector', async () => {
    await expect(
      signBookingWebhook('whsec_test', 1_700_000_000, '{"id":"evt_test"}')
    ).resolves.toBe('14c4f43763339dcb1c15f41a1ff31a94f2f09f8de278f8b4392ca0d7cbcd257e')
  })

  it('defines exactly the six settled retry delays', () => {
    expect(BOOKING_RETRY_DELAYS).toEqual([30, 60, 90, 120, 150, 180])
  })

  it('classifies redirects as permanent and exhausts the seventh attempt', () => {
    expect(classifyBookingResponse(302, 1)).toEqual({
      status: 'failed_permanent',
      retryDelay: null
    })
    expect(classifyBookingResponse(500, 1)).toEqual({
      status: 'failed_retryable',
      retryDelay: 30
    })
    expect(classifyBookingResponse(429, 6)).toEqual({
      status: 'failed_retryable',
      retryDelay: 180
    })
    expect(classifyBookingResponse(null, 7)).toEqual({
      status: 'dead_lettered',
      retryDelay: null
    })
  })
})

describe('processBookingOutbox', () => {
  it('records email and durable completion independently of Appointment success', async () => {
    const recordEmail = vi.fn(() => Effect.void)
    const finish = vi.fn(() => Effect.void)
    const send = vi.fn(() =>
      Effect.succeed({
        mode: 'cloudflare-email' as const,
        to: 'mia@example.com',
        subject: 'Your appointment is confirmed'
      })
    )
    const work = {
      outboxId: 'out_test',
      appointmentId: 'apt_test',
      merchantId: 'mer_test',
      merchantSlug: 'mara',
      traceId: 'trace_test',
      createdAt: '2026-07-11T10:00:00.000Z',
      appointmentStatus: 'scheduled',
      appointmentUpdatedAt: '2026-07-11T10:00:00.000Z',
      snapshot: {
        startsAt: '2026-07-20T10:00:00.000Z',
        endsAt: '2026-07-20T11:00:00.000Z',
        providerPreference: { kind: 'any' as const },
        assignedProvider: { id: 'prv_test', displayName: 'Ava' },
        services: [
          {
            id: 'svc_test',
            role: 'primary' as const,
            name: 'Cut',
            durationMinutes: 60,
            priceMinor: 5000,
            currency: 'USD'
          }
        ],
        durationMinutes: 60,
        currency: 'USD',
        totalMinor: 5000,
        merchantTimezone: 'Europe/Bucharest',
        customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
        checkoutPath: 'pay_in_person' as const
      },
      confirmation: {
        routeId: 'cnf_test',
        tokenVersion: 1,
        signingKeyId: 'current',
        expiresAt: '2026-08-20T11:00:00.000Z'
      },
      emailStatus: 'pending' as const
    }
    const store = Layer.succeed(BookingNotificationOutbox)({
      claim: () => Effect.succeed(work),
      recoverable: () => Effect.succeed([]),
      recordEmail,
      ensureEvent: () =>
        Effect.succeed({
          id: 'evt_test',
          rawBody: '{"id":"evt_test"}',
          occurredAt: work.createdAt
        }),
      endpoints: () => Effect.succeed([]),
      attempts: () => Effect.succeed([]),
      recordAttempt: () => Effect.void,
      finish
    })
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailConfigured: true,
        confirmationKeyring: {
          currentKeyId: 'current',
          keys: { current: 'confirmation-key' }
        }
      }).pipe(
        Effect.provide(store),
        Effect.provide(Layer.succeed(EmailDispatcher)({ send })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(send).toHaveBeenCalledOnce()
    expect(recordEmail).toHaveBeenCalledWith('out_test', 'delivered', null)
    expect(finish).toHaveBeenCalledWith('out_test', 'completed', work.createdAt)

    send.mockClear()
    recordEmail.mockClear()
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailConfigured: false,
        confirmationKeyring: { currentKeyId: 'current', keys: {} }
      }).pipe(
        Effect.provide(store),
        Effect.provide(Layer.succeed(EmailDispatcher)({ send })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(send).not.toHaveBeenCalled()
    expect(recordEmail).toHaveBeenCalledWith(
      'out_test',
      'skipped',
      'email_not_configured'
    )
  })
})
