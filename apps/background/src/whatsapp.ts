import { Context, Effect, Layer, Schema } from 'effect'
import type { BookingWhatsAppTemplateRequest } from '@b2b-saas-starter/capabilities/booking'

export class WhatsAppSendError extends Schema.TaggedErrorClass<WhatsAppSendError>()(
  'WhatsAppSendError',
  { message: Schema.String }
) {}

export type WhatsAppDeliveryResult = {
  readonly mode: 'log'
  readonly providerMessageId: string
}

export type WhatsAppDispatcherShape = {
  readonly send: (
    message: BookingWhatsAppTemplateRequest
  ) => Effect.Effect<WhatsAppDeliveryResult, WhatsAppSendError>
}

export class WhatsAppDispatcher extends Context.Service<
  WhatsAppDispatcher,
  WhatsAppDispatcherShape
>()('@b2b-saas-starter/background/WhatsAppDispatcher') {}

export const LogWhatsAppDispatcherLayer: Layer.Layer<WhatsAppDispatcher> =
  Layer.succeed(WhatsAppDispatcher)({
    send: (message) =>
      Effect.gen(function* () {
        yield* Effect.log('whatsapp.mock.message', {
          mode: 'log',
          idempotencyKey: message.idempotencyKey,
          recipient: 'recipient-redacted',
          template: message.template,
          language: message.language,
          message: `Programarea la ${message.parameters.merchant} este confirmată pentru ${message.parameters.startsAt} (${message.parameters.timeZone}). Confirmare: [link-redacted]`
        })
        return {
          mode: 'log' as const,
          providerMessageId: `mock:${message.idempotencyKey}`
        }
      })
  })
