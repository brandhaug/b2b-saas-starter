import { Effect, Queue, Schema, Stream } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import { type HtmlBuilder, type Html } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import {
  sendVerificationEmailWithAuthClient,
  requestPasswordResetWithAuthClient
} from '@/components/auth/auth-client-ports'
import { call } from '../server-call'
import { copyForAuthCode } from '@/lib/auth-error-copy'
import { button, feedback, text } from './ui'

export const Flags = Schema.Struct({
  email: Schema.String,
  verified: Schema.Boolean,
  siteKey: Schema.NullOr(Schema.String),
  recovery: Schema.Boolean,
  callbackPath: Schema.String
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  token: Schema.NullOr(Schema.String),
  revision: Schema.Number,
  error: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Token: { value: Schema.NullOr(Schema.String) },
  Send: { recovery: Schema.Boolean },
  Sent: {},
  Failed: { error: Schema.String }
})
export type Message = typeof Message.Type
const Send = Command.define('AccountEmail.Send', {
  args: { model: Model, recovery: Schema.Boolean },
  messages: [Message.cases.Sent, Message.cases.Failed],
  execute: ({ model, recovery }) =>
    call(
      () =>
        recovery
          ? requestPasswordResetWithAuthClient({
              email: model.flags.email,
              turnstileToken: model.token ?? undefined
            })
          : sendVerificationEmailWithAuthClient({
              email: model.flags.email,
              callbackPath: model.flags.callbackPath,
              turnstileToken: model.token ?? undefined
            }),
      m.email_delivery_resend_failed()
    ).pipe(
      Effect.map((result) =>
        result.error
          ? Message.cases.Failed.make({
              error: copyForAuthCode(result.error) ?? m.email_delivery_resend_failed()
            })
          : Message.cases.Sent.make({})
      ),
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      ready: false,
      pending: false,
      token: null,
      revision: 0,
      error: null,
      notice: null
    }
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Token': {
      return { model: { ...model, token: message.value } }
    }
    case 'Send': {
      if (!model.ready || model.pending) {
        return { model }
      }
      if (model.flags.siteKey !== null && model.token === null) {
        return { model: { ...model, error: m.complete_bot_check() } }
      }
      return {
        model: { ...model, pending: true, notice: null, error: null },
        commands: [Send({ model, recovery: message.recovery })]
      }
    }
    case 'Sent': {
      return {
        model: {
          ...model,
          pending: false,
          token: null,
          revision: model.revision + 1,
          notice: m.email_delivery_resend_requested()
        }
      }
    }
    case 'Failed': {
      return {
        model: {
          ...model,
          pending: false,
          token: null,
          revision: model.revision + 1,
          error: message.error
        }
      }
    }
  }
}
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  if (!model.flags.recovery) {
    if (model.notice !== null) {
      return h.div(
        [
          h.Role('status'),
          h.Class('border border-border bg-muted/40 px-4 py-3 text-sm')
        ],
        [m.workspace_verification_sent({ email: model.flags.email })]
      )
    }
    return h.div(
      [
        h.Role('status'),
        h.Class(
          'flex flex-wrap items-center gap-3 border border-border bg-muted/40 px-4 py-3'
        )
      ],
      [
        text(h, m.workspace_email_unverified()),
        ...(model.flags.siteKey === null
          ? []
          : [h.div([h.Id('account-email-turnstile')], [])]),
        button(
          h,
          m.workspace_resend_verification(),
          { _tag: 'Send', recovery: false },
          !model.ready || model.pending
        ),
        feedback(h, model.error)
      ]
    )
  }
  return h.div(
    [h.Class('grid gap-3')],
    [
      ...(model.flags.verified
        ? []
        : [
            text(h, m.email_delivery_verification()),
            button(
              h,
              m.email_delivery_restart_verification(),
              { _tag: 'Send', recovery: false },
              !model.ready || model.pending
            )
          ]),
      button(
        h,
        m.email_delivery_restart_recovery(),
        { _tag: 'Send', recovery: true },
        !model.ready || model.pending
      ),
      ...(model.flags.siteKey === null
        ? []
        : [h.div([h.Id('account-email-turnstile')], [])]),
      feedback(h, model.error, model.notice)
    ]
  )
}
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  turnstile: entry(
    { siteKey: Schema.NullOr(Schema.String), revision: Schema.Number },
    {
      modelToDependencies: (model) => ({
        siteKey:
          model.ready &&
          (!model.flags.verified || model.flags.recovery) &&
          (model.flags.recovery || model.notice === null)
            ? model.flags.siteKey
            : null,
        revision: model.revision
      }),
      dependenciesToStream: ({ siteKey }) =>
        siteKey === null
          ? Stream.empty
          : Stream.callback<Message>((queue) =>
              Effect.gen(function* () {
                let active = true
                let widget: string | undefined
                function emit(value: string | null) {
                  if (active) {
                    Queue.offerUnsafe(queue, Message.cases.Token.make({ value }))
                  }
                }
                function mount() {
                  const container = document.getElementById('account-email-turnstile')
                  if (active && container && window.turnstile && siteKey !== null) {
                    widget = window.turnstile.render(container, {
                      sitekey: siteKey,
                      theme: 'dark',
                      callback: emit,
                      'expired-callback': () => emit(null),
                      'error-callback': () => emit(null)
                    })
                  }
                }
                const existing = document.getElementById('cf-turnstile-script')
                const script = existing ?? document.createElement('script')
                function failed() {
                  emit(null)
                }
                if (window.turnstile) {
                  mount()
                } else {
                  script.addEventListener('load', mount, { once: true })
                  script.addEventListener('error', failed, { once: true })
                  if (script instanceof HTMLScriptElement && !existing) {
                    script.id = 'cf-turnstile-script'
                    script.src =
                      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
                    script.async = true
                    // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare HTMLRewriter also declares head.append with a non-DOM signature.
                    document.head.appendChild(script)
                  }
                }
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    active = false
                    script.removeEventListener('load', mount)
                    script.removeEventListener('error', failed)
                    if (widget !== undefined) {
                      window.turnstile?.remove(widget)
                    }
                  })
                )
              })
            )
    }
  )
}))
