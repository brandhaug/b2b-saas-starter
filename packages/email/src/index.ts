import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'
import { failureMessage } from '@b2b-saas-starter/failure'
import { render } from '@react-email/render'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { type ReactElement } from 'react'

const EmailDeliveryMode = Schema.Literals(['cloudflare-email', 'log'])
type EmailDeliveryMode = typeof EmailDeliveryMode.Type

export type EmailMessage = {
  /**
   * Optional: the dispatcher fills its `defaultFrom` (CLOUDFLARE_EMAIL_FROM)
   * in when absent, so callers never repeat that env var's job.
   */
  readonly from?: string | undefined
  readonly to: string
  readonly subject: string
  readonly element: ReactElement
}

export const EmailDeliveryResult = Schema.Struct({
  mode: EmailDeliveryMode,
  to: Schema.String,
  subject: Schema.String,
  /** The provider's acceptance ID. Log mode has no provider ID. */
  providerMessageId: Schema.optional(Schema.String)
})
export type EmailDeliveryResult = typeof EmailDeliveryResult.Type

export const EmailSendFailureKind = Schema.Literals([
  'permanent',
  'transient',
  'ambiguous',
  'suppressed'
])
export type EmailSendFailureKind = typeof EmailSendFailureKind.Type

export type SendEmailBuilderArgs = {
  readonly from: string
  readonly to: string | ReadonlyArray<string>
  readonly subject: string
  readonly text?: string
  readonly html?: string
}

/**
 * Structural subset of Cloudflare's `SendEmail` binding. The structured
 * Workers API returns an `EmailSendResult` containing the provider message ID;
 * the dispatcher preserves it for delivery-event correlation.
 * Worker envs declare this port rather than workers-types' `SendEmail`, so the
 * two shapes are never assigned across.
 */
export type SendEmailBinding = {
  readonly send: (message: SendEmailBuilderArgs) => Promise<SendEmailResult>
}

export type SendEmailResult = {
  readonly messageId: string
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
class EmailRenderError extends Schema.TaggedError<EmailRenderError>()(
  'EmailRenderError',
  { message: Schema.String }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class EmailSendError extends Schema.TaggedError<EmailSendError>()(
  'EmailSendError',
  {
    message: Schema.String,
    to: Schema.String,
    subject: Schema.String,
    /** Optional for compatibility with injected dispatcher implementations. */
    failureKind: Schema.optional(EmailSendFailureKind),
    /** Cloudflare's stable error code, when the provider supplied one. */
    providerCode: Schema.optional(Schema.String)
  }
) {}

type EmailDispatcherInterface = {
  readonly send: (
    message: EmailMessage
  ) => Effect.Effect<EmailDeliveryResult, EmailRenderError | EmailSendError>
}

export class EmailDispatcher extends Context.Service<
  EmailDispatcher,
  EmailDispatcherInterface
>()('@b2b-saas-starter/email/EmailDispatcher') {}

function renderMessage(
  message: EmailMessage
): Effect.Effect<{ readonly html: string; readonly text: string }, EmailRenderError> {
  return Effect.gen(function* () {
    const html = yield* Effect.tryPromise({
      try: () => render(message.element),
      catch: (cause) => new EmailRenderError({ message: failureMessage(cause) })
    })
    const text = yield* Effect.tryPromise({
      try: () => render(message.element, { plainText: true }),
      catch: (cause) => new EmailRenderError({ message: failureMessage(cause) })
    })
    return { html, text }
  })
}

const ProviderFailure = Schema.Struct({
  code: Schema.Literals([
    'E_RECIPIENT_SUPPRESSED',
    'E_VALIDATION_ERROR',
    'E_FIELD_MISSING',
    'E_TOO_MANY_RECIPIENTS',
    'E_TOO_MANY_ATTACHMENTS',
    'E_SENDER_NOT_VERIFIED',
    'E_RECIPIENT_NOT_ALLOWED',
    'E_SENDER_DOMAIN_NOT_AVAILABLE',
    'E_CONTENT_TOO_LARGE',
    'E_HEADER_NOT_ALLOWED',
    'E_HEADER_USE_API_FIELD',
    'E_HEADER_VALUE_INVALID',
    'E_HEADER_VALUE_TOO_LONG',
    'E_HEADER_NAME_INVALID',
    'E_HEADERS_TOO_LARGE',
    'E_HEADERS_TOO_MANY',
    'E_RATE_LIMIT_EXCEEDED',
    'E_DAILY_LIMIT_EXCEEDED',
    'E_DELIVERY_FAILED',
    'E_INTERNAL_SERVER_ERROR'
  ])
})
const decodeProviderFailure = Schema.decodeUnknownOption(ProviderFailure)

function classifyProviderFailure(
  code: typeof ProviderFailure.Type.code | undefined
): EmailSendFailureKind {
  switch (code) {
    case 'E_RECIPIENT_SUPPRESSED': {
      return 'suppressed'
    }
    case 'E_VALIDATION_ERROR':
    case 'E_FIELD_MISSING':
    case 'E_TOO_MANY_RECIPIENTS':
    case 'E_TOO_MANY_ATTACHMENTS':
    case 'E_SENDER_NOT_VERIFIED':
    case 'E_RECIPIENT_NOT_ALLOWED':
    case 'E_SENDER_DOMAIN_NOT_AVAILABLE':
    case 'E_CONTENT_TOO_LARGE':
    case 'E_HEADER_NOT_ALLOWED':
    case 'E_HEADER_USE_API_FIELD':
    case 'E_HEADER_VALUE_INVALID':
    case 'E_HEADER_VALUE_TOO_LONG':
    case 'E_HEADER_NAME_INVALID':
    case 'E_HEADERS_TOO_LARGE':
    case 'E_HEADERS_TOO_MANY': {
      return 'permanent'
    }
    case 'E_RATE_LIMIT_EXCEEDED':
    case 'E_DAILY_LIMIT_EXCEEDED':
    case 'E_DELIVERY_FAILED': {
      return 'transient'
    }
    case 'E_INTERNAL_SERVER_ERROR':
    case undefined: {
      // A rejected request may have reached the provider. Retrying an
      // unknown failure is therefore an explicitly ambiguous send.
      return 'ambiguous'
    }
  }
}

function sendFailure(cause: unknown, to: string, subject: string): EmailSendError {
  const code = decodeProviderFailure(cause).pipe(
    Option.map((failure) => failure.code),
    Option.getOrUndefined
  )
  const failureKind = classifyProviderFailure(code)
  return new EmailSendError({
    // Provider messages can contain recipient or payload details. Persist only
    // this stable, non-sensitive summary; callers can use providerCode for
    // diagnostics without retaining raw provider bodies.
    message: `email send failed: ${failureKind}`,
    to,
    subject,
    failureKind,
    providerCode: code
  })
}

export const LogEmailDispatcherLayer: Layer.Layer<EmailDispatcher> = Layer.succeed(
  EmailDispatcher
)({
  send: (message) =>
    Effect.gen(function* () {
      const rendered = yield* renderMessage(message)
      yield* Effect.log('email.dispatched', {
        mode: 'log',
        to: message.to,
        subject: message.subject,
        // The rendered plain text, body and all: log mode exists so flows that
        // email a link (magic link, password reset, verification) complete
        // without a provider — a log line that names the recipient but drops
        // the link leaves the flow unfinishable. Dev/test only; a configured
        // EMAIL binding never takes this branch.
        text: rendered.text
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
              message: 'email send failed: permanent',
              to: message.to,
              subject: message.subject,
              failureKind: 'permanent'
            })
          )
        }
        const result = yield* Effect.tryPromise({
          try: () =>
            binding.send({
              from,
              to: message.to,
              subject: message.subject,
              text,
              html
            }),
          catch: (cause) => sendFailure(cause, message.to, message.subject)
        })
        yield* Effect.log('email.dispatched', {
          mode: 'cloudflare-email',
          to: message.to,
          subject: message.subject,
          providerMessageId: result.messageId
        })
        return EmailDeliveryResult.make({
          mode: 'cloudflare-email',
          to: message.to,
          subject: message.subject,
          providerMessageId: result.messageId
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
export type EmailDispatcherEnv = ProviderEnvOf<'CLOUDFLARE_EMAIL_FROM'> & {
  readonly EMAIL?: SendEmailBinding | undefined
}

/**
 * Cloudflare Email is an Optional Provider Module: without its binding and a
 * sender address the starter still delivers, to the log, instead of failing.
 */
export function selectEmailDispatcherLayer(
  env: EmailDispatcherEnv
): Layer.Layer<EmailDispatcher> {
  if (env.EMAIL && hasValue(env.CLOUDFLARE_EMAIL_FROM)) {
    return makeCloudflareEmailDispatcherLayer(env.EMAIL, {
      defaultFrom: env.CLOUDFLARE_EMAIL_FROM
    })
  }
  return LogEmailDispatcherLayer
}
