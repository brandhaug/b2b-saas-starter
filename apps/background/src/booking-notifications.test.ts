import { describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { BookingNotificationOutbox } from '@b2b-saas-starter/capabilities/booking'
import type { BookingNotificationWork } from '@b2b-saas-starter/capabilities/booking'
import { EmailDispatcher, EmailSendError } from '@b2b-saas-starter/email'
import {
  BOOKING_RETRY_DELAYS,
  classifyBookingResponse,
  processBookingOutbox,
  signBookingWebhook
} from './booking-notifications.ts'
import { WhatsAppDispatcher, WhatsAppSendError } from './whatsapp.ts'
import type { WhatsAppDispatcherShape } from './whatsapp.ts'

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
    const recordWhatsApp = vi.fn(() => Effect.void)
    const finish = vi.fn(() => Effect.void)
    const send = vi.fn(() =>
      Effect.succeed({
        mode: 'cloudflare-email' as const,
        to: 'mia@example.com',
        subject: 'Your appointment is confirmed'
      })
    )
    const sendWhatsApp = vi.fn<WhatsAppDispatcherShape['send']>(() =>
      Effect.succeed({
        mode: 'log' as const,
        providerMessageId: 'mock:nti_test'
      })
    )
    const work: BookingNotificationWork = {
      outboxId: 'out_test',
      appointmentId: 'apt_test',
      notificationIntentId: 'nti_test',
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
        customerDetails: {
          name: 'Mia',
          email: 'mia@example.com',
          phone: '+40722123456'
        },
        checkoutPath: 'pay_in_person' as const
      },
      confirmation: {
        routeId: 'cnf_test',
        tokenVersion: 1,
        signingKeyId: 'current',
        expiresAt: '2026-08-20T11:00:00.000Z'
      },
      emailStatus: 'pending' as const,
      emailAttemptCount: 0,
      emailNextAttemptAt: null,
      whatsappStatus: 'pending' as const
    }
    const claim = vi.fn(() => Effect.succeed(work))
    const store = Layer.succeed(BookingNotificationOutbox)({
      claim,
      recoverable: () => Effect.succeed([]),
      recordEmail,
      recordWhatsApp,
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
        emailProviderState: 'configured',
        whatsappProviderState: 'capture',
        confirmationKeyring: {
          currentKeyId: 'current',
          keys: { current: 'confirmation-key' }
        }
      }).pipe(
        Effect.provide(store),
        Effect.provide(Layer.succeed(EmailDispatcher)({ send })),
        Effect.provide(Layer.succeed(WhatsAppDispatcher)({ send: sendWhatsApp })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'nti_test' })
    )
    expect(recordEmail).toHaveBeenCalledWith('out_test', 'delivered', null, 1, null)
    expect(sendWhatsApp).toHaveBeenCalledOnce()
    expect(sendWhatsApp).toHaveBeenCalledWith({
      idempotencyKey: 'nti_test',
      to: '+40722123456',
      template: 'appointment_confirmation',
      language: 'ro',
      parameters: {
        merchant: 'mara',
        startsAt: '2026-07-20T10:00:00.000Z',
        timeZone: 'Europe/Bucharest',
        confirmationUrl: expect.stringMatching(
          /^https:\/\/example\.com\/mara\/booking\/confirmations\/cnf_test\?token=/
        )
      }
    })
    expect(recordWhatsApp).toHaveBeenCalledWith('out_test', 'captured')
    expect(finish).toHaveBeenCalledWith('out_test', 'completed', work.createdAt)

    send.mockClear()
    sendWhatsApp.mockClear()
    recordEmail.mockClear()
    recordWhatsApp.mockClear()
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailProviderState: 'needs_configuration',
        whatsappProviderState: 'needs_configuration',
        confirmationKeyring: { currentKeyId: 'current', keys: {} }
      }).pipe(
        Effect.provide(store),
        Effect.provide(Layer.succeed(EmailDispatcher)({ send })),
        Effect.provide(Layer.succeed(WhatsAppDispatcher)({ send: sendWhatsApp })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(send).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(recordWhatsApp).toHaveBeenCalledWith('out_test', 'needs_configuration')
    expect(recordEmail).toHaveBeenCalledWith(
      'out_test',
      'needs_configuration',
      'email_not_configured',
      0,
      null
    )

    sendWhatsApp.mockClear()
    recordWhatsApp.mockClear()
    claim.mockImplementationOnce(() =>
      Effect.succeed({ ...work, emailStatus: 'delivered' as const })
    )
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailProviderState: 'configured',
        whatsappProviderState: 'capture',
        confirmationKeyring: {
          currentKeyId: 'current',
          keys: { current: 'confirmation-key' }
        }
      }).pipe(
        Effect.provide(store),
        Effect.provide(Layer.succeed(EmailDispatcher)({ send })),
        Effect.provide(Layer.succeed(WhatsAppDispatcher)({ send: sendWhatsApp })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(send).not.toHaveBeenCalled()
    expect(sendWhatsApp).toHaveBeenCalledOnce()
    expect(recordWhatsApp).toHaveBeenCalledWith('out_test', 'captured')

    const scheduleRetry = vi.fn().mockResolvedValue(undefined)
    sendWhatsApp.mockImplementationOnce(() =>
      Effect.fail(new WhatsAppSendError({ message: 'mock logger unavailable' }))
    )
    recordEmail.mockClear()
    recordWhatsApp.mockClear()
    finish.mockClear()
    claim.mockImplementationOnce(() =>
      Effect.succeed({ ...work, emailStatus: 'pending' as const })
    )
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailProviderState: 'disabled',
        whatsappProviderState: 'capture',
        confirmationKeyring: {
          currentKeyId: 'current',
          keys: { current: 'confirmation-key' }
        },
        scheduleRetry
      }).pipe(
        Effect.provide(store),
        Effect.provide(Layer.succeed(EmailDispatcher)({ send })),
        Effect.provide(Layer.succeed(WhatsAppDispatcher)({ send: sendWhatsApp })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(recordEmail).toHaveBeenCalledWith('out_test', 'disabled', null, 0, null)
    expect(recordWhatsApp).not.toHaveBeenCalled()
    expect(scheduleRetry).toHaveBeenCalledWith('out_test', 30)
    expect(finish).toHaveBeenCalledWith('out_test', 'pending', null)

    recordEmail.mockClear()
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailProviderState: 'configured',
        whatsappProviderState: 'needs_configuration',
        confirmationKeyring: {
          currentKeyId: 'current',
          keys: { current: 'confirmation-key' }
        }
      }).pipe(
        Effect.provide(store),
        Effect.provide(
          Layer.succeed(EmailDispatcher)({
            send: () =>
              Effect.fail(
                new EmailSendError({
                  message: 'provider unavailable',
                  to: 'mia@example.com',
                  subject: 'Your appointment is confirmed'
                })
              )
          })
        ),
        Effect.provide(Layer.succeed(WhatsAppDispatcher)({ send: sendWhatsApp })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(recordEmail).toHaveBeenCalledWith(
      'out_test',
      'failed_retryable',
      'email_send_failed',
      1,
      '2026-07-11T10:00:30.000Z'
    )

    recordEmail.mockClear()
    await Effect.runPromise(
      processBookingOutbox({
        outboxId: work.outboxId,
        now: work.createdAt,
        publicOrigin: 'https://example.com',
        emailProviderState: 'configured',
        whatsappProviderState: 'needs_configuration',
        confirmationKeyring: {
          currentKeyId: 'current',
          keys: { current: 'confirmation-key' }
        }
      }).pipe(
        Effect.provide(
          Layer.succeed(BookingNotificationOutbox)({
            claim: () => Effect.succeed({ ...work, emailAttemptCount: 6 }),
            recoverable: () => Effect.succeed([]),
            recordEmail,
            recordWhatsApp,
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
        ),
        Effect.provide(
          Layer.succeed(EmailDispatcher)({
            send: () =>
              Effect.fail(
                new EmailSendError({
                  message: 'provider unavailable',
                  to: 'mia@example.com',
                  subject: 'Your appointment is confirmed'
                })
              )
          })
        ),
        Effect.provide(Layer.succeed(WhatsAppDispatcher)({ send: sendWhatsApp })),
        Effect.provide(FetchHttpClient.layer)
      )
    )
    expect(recordEmail).toHaveBeenCalledWith(
      'out_test',
      'failed_terminal',
      'email_retries_exhausted',
      7,
      null
    )
  })
})
