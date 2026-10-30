import { Schema } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import * as Support from '../shared/support'
import { link } from '../shared/view'

export const Flags = Schema.Struct({
  email: Schema.NullOr(Schema.String),
  helpdeskUrl: Schema.NullOr(Schema.String),
  helpCenterUrl: Schema.NullOr(Schema.String),
  appVersion: Schema.NullOr(Schema.String)
})
export type Flags = typeof Flags.Type
export const Model = Support.Model
export type Model = Support.Model
export const Message = Support.Message
export type Message = Support.Message
export const update = Support.update
export function init(flags: Flags) {
  return Support.init({
    routeName: 'help',
    workspaceId: null,
    appVersion: flags.appVersion
  })
}
export function view(config: Flags, model: Model, h: HtmlBuilder<Message>): Html {
  const available = Boolean(config.helpdeskUrl || config.email)
  function external(href: string, label: string): Html {
    return h.a(
      [
        h.Href(href),
        h.Target('_blank'),
        h.Rel('noopener noreferrer'),
        h.Class('font-medium underline underline-offset-4')
      ],
      [label, h.span([h.Class('sr-only')], [m.common_opens_new_tab()])]
    )
  }
  return h.main(
    [
      h.Id('main-content'),
      h.Tabindex(-1),
      h.Class(
        'mx-auto grid w-full max-w-3xl flex-1 gap-10 px-4 py-12 sm:px-6 outline-none'
      )
    ],
    [
      h.section(
        [h.Class('max-w-2xl')],
        [
          h.h1([h.Class('text-3xl font-semibold tracking-tight')], [m.support_title()]),
          h.p(
            [h.Class('mt-4 text-lg text-muted-foreground')],
            [available ? m.support_description() : m.support_unavailable()]
          )
        ]
      ),
      available || config.helpCenterUrl
        ? h.div(
            [h.Class('grid gap-4 sm:grid-cols-2')],
            [
              available
                ? h.section(
                    [h.Class('grid gap-4 border border-border bg-card p-6')],
                    [
                      h.h2(
                        [h.Class('text-lg font-semibold')],
                        [m.support_contact_title()]
                      ),
                      h.p(
                        [h.Class('text-sm text-muted-foreground')],
                        [m.support_contact_description()]
                      ),
                      config.helpdeskUrl
                        ? external(config.helpdeskUrl, m.support_open_helpdesk())
                        : null,
                      config.email
                        ? link(
                            h,
                            `mailto:${encodeURIComponent(config.email)}`,
                            config.email,
                            'font-medium underline underline-offset-4'
                          )
                        : null
                    ]
                  )
                : null,
              config.helpCenterUrl
                ? h.section(
                    [h.Class('grid gap-4 border border-border bg-card p-6')],
                    [
                      h.h2(
                        [h.Class('text-lg font-semibold')],
                        [m.support_help_center_title()]
                      ),
                      external(config.helpCenterUrl, m.support_open_help_center())
                    ]
                  )
                : null
            ]
          )
        : null,
      h.section(
        [h.Class('grid gap-3 border-t border-border pt-8')],
        [
          h.h2([h.Class('text-xl font-semibold')], [m.support_details_title()]),
          h.p(
            [h.Class('text-sm text-muted-foreground')],
            [m.support_details_description()]
          ),
          Support.view(model, h)
        ]
      ),
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- Direct Node SSR smoke imports have no Vite ImportMeta.env object.
      import.meta.env?.DEV
        ? h.p(
            [h.Class('text-xs text-muted-foreground')],
            [m.support_development_hint()]
          )
        : null,
      h.p([h.Class('text-sm')], [link(h, '/', m.shell_home())])
    ]
  )
}
