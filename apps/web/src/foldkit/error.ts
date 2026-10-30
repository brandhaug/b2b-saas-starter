import { Schema } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { UiErrorPayload, uiErrorAdapter } from '@/lib/ui-error'
import { causeMessage } from '@/lib/cause-message'
import { safeRedirect } from '@/lib/utils'
import { buttonClass, link } from './shared/view'

export const Flags = Schema.Struct({
  status: Schema.Number,
  error: Schema.NullOr(UiErrorPayload),
  returnTo: Schema.optional(Schema.String),
  section: Schema.optional(Schema.Literals(['audit', 'api-tokens', 'webhooks']))
})
export type Flags = typeof Flags.Type
export function view<M>(flags: Flags, h: HtmlBuilder<M>, inApplication = false): Html {
  const notFound = flags.status === 404 || flags.error?.code === 'not_found'
  let description: string = m.shell_error_description()
  if (flags.error) {
    description = causeMessage(
      uiErrorAdapter.fromSerializable(flags.error),
      description
    )
  }
  if (notFound) {
    description = m.shell_not_found_description()
  }
  let title = notFound ? m.shell_not_found() : m.shell_error()
  const denied = flags.error?.code === 'forbidden'
  const strongAuthentication =
    !notFound && flags.error?.code === 'strong_authentication_required'
  if (strongAuthentication) {
    title = m.security_verify_title()
    description = m.security_authentication_required()
  }
  if (!notFound && flags.error?.code !== 'strong_authentication_required') {
    const copy = {
      audit: [
        m.audit_access_denied,
        m.audit_forbidden_description,
        m.audit_unavailable,
        m.audit_load_failed
      ],
      'api-tokens': [
        m.api_tokens_access_denied,
        m.api_tokens_forbidden_description,
        m.api_tokens_unavailable,
        m.api_tokens_load_failed
      ],
      webhooks: [
        m.webhooks_access_denied,
        m.webhooks_forbidden_description,
        m.webhooks_unavailable,
        m.webhooks_load_failed
      ]
    } as const
    if (flags.section) {
      const selected = copy[flags.section]
      title = selected[denied ? 0 : 2]()
      description = selected[denied ? 1 : 3]()
    }
  }
  const container = inApplication ? h.div : h.main
  return container(
    [
      ...(inApplication ? [] : [h.Id('main-content')]),
      h.Tabindex(-1),
      h.Class(
        `grid place-content-center gap-4 bg-background px-6 text-foreground outline-none ${inApplication ? 'py-12' : 'marketing min-h-dvh'}`
      )
    ],
    [
      h.h1([h.Class('text-3xl font-semibold')], [title]),
      h.p(
        [h.Class('max-w-xl text-sm text-muted-foreground'), h.Role('alert')],
        [description]
      ),
      h.div(
        [h.Class('flex flex-wrap gap-3')],
        [
          inApplication
            ? link(h, '/workspaces', m.back_to_workspaces(), buttonClass)
            : link(h, '/', m.shell_home(), buttonClass),
          link(h, '/help', m.public_meta_support()),
          strongAuthentication
            ? link(
                h,
                `/verify-authentication?redirect=${encodeURIComponent(safeRedirect(flags.returnTo))}`,
                m.security_verify_continue(),
                buttonClass
              )
            : null,
          strongAuthentication
            ? link(h, '/account', m.security_manage_factors())
            : null,
          flags.status === 401
            ? link(h, '/sign-in', m.form_sign_in(), buttonClass)
            : null,
          notFound || denied || strongAuthentication
            ? null
            : link(
                h,
                flags.returnTo ? safeRedirect(flags.returnTo) : '?',
                m.try_again(),
                buttonClass
              )
        ]
      )
    ]
  )
}
