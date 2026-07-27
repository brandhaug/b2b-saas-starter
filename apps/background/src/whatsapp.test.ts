import { Effect, Logger } from 'effect'
import { describe, expect, it } from 'vitest'
import { LogWhatsAppDispatcherLayer, WhatsAppDispatcher } from './whatsapp.ts'

describe('LogWhatsAppDispatcherLayer', () => {
  it('logs a useful mock message without exposing the destination or confirmation token', async () => {
    const entries: unknown[] = []
    const capture = Logger.make((options) => entries.push(options.message))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* WhatsAppDispatcher
        return yield* dispatcher.send({
          idempotencyKey: 'nti_test',
          to: '+40722123456',
          template: 'appointment_confirmation',
          language: 'ro',
          parameters: {
            merchant: 'mara',
            startsAt: '2026-07-20T10:00:00.000Z',
            timeZone: 'Europe/Bucharest',
            confirmationUrl:
              'https://example.com/mara/booking/confirmations/cnf_test?token=secret'
          }
        })
      }).pipe(
        Effect.provide(LogWhatsAppDispatcherLayer),
        Effect.provide(Logger.layer([capture]))
      )
    )

    expect(result).toEqual({ mode: 'log', providerMessageId: 'mock:nti_test' })
    const log = JSON.stringify(entries)
    expect(log).toContain('whatsapp.mock.message')
    expect(log).toContain('+40******456')
    expect(log).toContain('[link-redacted]')
    expect(log).not.toContain('+40722123456')
    expect(log).not.toContain('token=secret')
  })
})
