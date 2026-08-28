import { render } from '@react-email/render'
import { Context, Effect, Layer, Schema } from 'effect'
import { type ReactElement } from 'react'

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
  readonly to: string | ReadonlyArray<string>
  readonly subject: string
  readonly text?: string
  readonly html?: string
}

/**
 * Structural subset of Cloudflare's `SendEmail` binding. Resolving to `void`:
 * the real binding resolves an `EmailSendResult` that this package never reads —
 * a send either resolved or rejected, and `EmailSendError` carries the latter.
 * Worker envs declare this port rather than workers-types' `SendEmail`, so the
 * two shapes are never assigned across.
 */
export type SendEmailBinding = {
  readonly send: (message: SendEmailBuilderArgs) => Promise<void>
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class EmailRenderError extends Schema.TaggedError<EmailRenderError>()(
  'EmailRenderError',
  { message: Schema.String }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class EmailSendError extends Schema.TaggedError<EmailSendError>()(
  'EmailSendError',
  { message: Schema.String, to: Schema.String, subject: Schema.String }
) {}

export type EmailDispatcherInterface = {
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailDeliveryResult, EmailRenderError | EmailSendError>
}

export class EmailDispatcher extends Context.Service<
  EmailDispatcher,
  EmailDispatcherInterface
>()('@b2b-saas-starter/email/EmailDispatcher') {}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause)
}

function renderMessage(
  message: EmailMessage
): Effect.Effect<{ readonly html: string; readonly text: string }, EmailRenderError> {
  return Effect.gen(function* () {
    const html = yield* Effect.tryPromise({
      try: () => render(message.element),
      catch: (cause) => new EmailRenderError({ message: causeMessage(cause) })
    })
    const text = yield* Effect.tryPromise({
      try: () => render(message.element, { plainText: true }),
      catch: (cause) => new EmailRenderError({ message: causeMessage(cause) })
    })
    return { html, text }
  })
}

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
      return EmailDeliveryResult.make({
        mode: 'log',
        to: message.to,
        subject: message.subject
      })
    })
})

export function makeCloudflareEmailDispatcherLayer(
  binding: SendEmailBinding,
  options?: { readonly defaultFrom?: string }
): Layer.Layer<EmailDispatcher> {
  return Layer.succeed(EmailDispatcher)({
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
              message: causeMessage(cause),
              to: message.to,
              subject: message.subject
            })
        })
        yield* Effect.log('email.dispatched', {
          mode: 'cloudflare-email',
          to: message.to,
          subject: message.subject
        })
        return EmailDeliveryResult.make({
          mode: 'cloudflare-email',
          to: message.to,
          subject: message.subject
        })
      })
  })
}

/**
 * What the dispatcher selector reads off a worker env. Both keys accept an
 * explicit `undefined` so callers can pass their bindings straight through
 * rather than each hand-building a bag that omits the absent keys — the
 * selector's own check is what decides whether the provider goes live.
 */
export type EmailDispatcherEnv = {
  readonly EMAIL?: SendEmailBinding | undefined
  readonly EMAIL_FROM_ADDRESS?: string | undefined
}

/**
 * Cloudflare Email is an Optional Provider Module: without its binding and a
 * sender address the starter still delivers, to the log, instead of failing.
 */
export function selectEmailDispatcherLayer(
  env: EmailDispatcherEnv
): Layer.Layer<EmailDispatcher> {
  if (env.EMAIL && env.EMAIL_FROM_ADDRESS) {
    return makeCloudflareEmailDispatcherLayer(env.EMAIL, {
      defaultFrom: env.EMAIL_FROM_ADDRESS
    })
  }
  return LogEmailDispatcherLayer
}
