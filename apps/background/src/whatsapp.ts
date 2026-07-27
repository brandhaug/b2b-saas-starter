import { Context, Effect, Layer, Schema } from 'effect'

export type WhatsAppTemplateMessage = {
  readonly idempotencyKey: string
  readonly to: string
  readonly template: 'appointment_confirmation'
  readonly language: 'ro'
  readonly parameters: {
    readonly merchant: string
    readonly startsAt: string
    readonly timeZone: string
    readonly confirmationUrl: string
  }
}

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
    message: WhatsAppTemplateMessage
  ) => Effect.Effect<WhatsAppDeliveryResult, WhatsAppSendError>
}

export class WhatsAppDispatcher extends Context.Service<
  WhatsAppDispatcher,
  WhatsAppDispatcherShape
>()('@b2b-saas-starter/background/WhatsAppDispatcher') {}

const maskPhone = (phone: string) => {
  const visible = phone.slice(-3)
  return `${phone.slice(0, Math.min(3, phone.length))}${'*'.repeat(
    Math.max(0, phone.length - visible.length - Math.min(3, phone.length))
  )}${visible}`
}

export const LogWhatsAppDispatcherLayer: Layer.Layer<WhatsAppDispatcher> =
  Layer.succeed(WhatsAppDispatcher)({
    send: (message) =>
      Effect.gen(function* () {
        yield* Effect.log('whatsapp.mock.message', {
          mode: 'log',
          idempotencyKey: message.idempotencyKey,
          to: maskPhone(message.to),
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
