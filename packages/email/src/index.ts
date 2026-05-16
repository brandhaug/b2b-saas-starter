import { render } from '@react-email/render'
import { Context, Effect, Layer, Schema } from 'effect'
import type { ReactElement } from 'react'

export * from './templates.tsx'

export const EmailDeliveryMode = Schema.Literals(['cloudflare-email', 'log'])
export type EmailDeliveryMode = typeof EmailDeliveryMode.Type

export type EmailMessage = {
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly element: ReactElement
}

export const EmailDeliveryResult = Schema.Struct({
  mode: EmailDeliveryMode,
  to: Schema.String,
  subject: Schema.String
})
export type EmailDeliveryResult = typeof EmailDeliveryResult.Type

export type SendEmailBuilderArgs = {
  readonly from: string
  readonly to: string | readonly string[]
  readonly subject: string
  readonly text?: string
  readonly html?: string
}

export type SendEmailBinding = {
  readonly send: (message: SendEmailBuilderArgs) => Promise<unknown>
}

export class EmailRenderError extends Schema.TaggedErrorClass<EmailRenderError>()(
  'EmailRenderError',
  { message: Schema.String }
) {}

export class EmailSendError extends Schema.TaggedErrorClass<EmailSendError>()(
  'EmailSendError',
  { message: Schema.String, to: Schema.String, subject: Schema.String }
) {}

export type EmailDispatcherShape = {
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailDeliveryResult, EmailRenderError | EmailSendError>
}

export class EmailDispatcher extends Context.Service<
  EmailDispatcher,
  EmailDispatcherShape
>()('@b2b-saas-starter/email/EmailDispatcher') {}

const renderMessage = (
  message: EmailMessage
): Effect.Effect<{ readonly html: string; readonly text: string }, EmailRenderError> =>
  Effect.tryPromise({
    try: async () => ({
      html: await render(message.element),
      text: await render(message.element, { plainText: true })
    }),
    catch: (cause) =>
      new EmailRenderError({
        message: cause instanceof Error ? cause.message : String(cause)
      })
  })

export const LogEmailDispatcherLayer: Layer.Layer<EmailDispatcher> = Layer.succeed(
  EmailDispatcher
)({
  send: (message) =>
    Effect.gen(function* () {
      yield* renderMessage(message)
      yield* Effect.log('email.dispatched', {
        mode: 'log',
        to: message.to,
        subject: message.subject
      })
      return {
        mode: 'log' as const,
        to: message.to,
        subject: message.subject
      }
    })
})

export const makeCloudflareEmailDispatcherLayer = (
  binding: SendEmailBinding,
  options?: { readonly defaultFrom?: string }
): Layer.Layer<EmailDispatcher> =>
  Layer.succeed(EmailDispatcher)({
    send: (message) =>
      Effect.gen(function* () {
        const { html, text } = yield* renderMessage(message)
        const from = message.from || options?.defaultFrom
        if (!from) {
          return yield* Effect.fail(
            new EmailSendError({
              message: 'missing sender address',
              to: message.to,
              subject: message.subject
            })
          )
        }
        yield* Effect.tryPromise({
          try: () =>
            binding.send({
              from,
              to: message.to,
              subject: message.subject,
              text,
              html
            }),
          catch: (cause) =>
            new EmailSendError({
              message: cause instanceof Error ? cause.message : String(cause),
              to: message.to,
              subject: message.subject
            })
        })
        yield* Effect.log('email.dispatched', {
          mode: 'cloudflare-email',
          to: message.to,
          subject: message.subject
        })
        return {
          mode: 'cloudflare-email' as const,
          to: message.to,
          subject: message.subject
        }
      })
  })

export const selectEmailDispatcherLayer = (env: {
  readonly EMAIL?: SendEmailBinding
  readonly EMAIL_FROM_ADDRESS?: string
}): Layer.Layer<EmailDispatcher> =>
  env.EMAIL && env.EMAIL_FROM_ADDRESS
    ? makeCloudflareEmailDispatcherLayer(env.EMAIL, {
        defaultFrom: env.EMAIL_FROM_ADDRESS
      })
    : LogEmailDispatcherLayer
