import { type HtmlBuilder, type Html } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { link } from '../shared/view'

export type Controller = { readonly name: string; readonly email: string } | null
export function legalView<M>(
  page: 'privacy' | 'terms',
  controller: Controller,
  h: HtmlBuilder<M>
): Html {
  const content =
    page === 'terms'
      ? [
          h.p([], [m.public_legal_terms_intro()]),
          h.p([], [m.public_legal_terms_replace()])
        ]
      : [
          h.p([], [m.public_legal_privacy_intro()]),
          h.h2([], [m.public_legal_privacy_controller_title()]),
          controller
            ? h.p(
                [],
                [
                  m.public_legal_privacy_controller({ name: controller.name }),
                  ' ',
                  link(h, `mailto:${controller.email}`, controller.email)
                ]
              )
            : h.p([], [m.public_legal_privacy_controller_unconfigured()]),
          h.h2([], [m.public_legal_privacy_collects_title()]),
          h.p([], [m.public_legal_privacy_collects()]),
          h.h2([], [m.public_legal_privacy_stores_title()]),
          h.p([], [m.public_legal_privacy_stores()]),
          h.h2([], [m.public_legal_privacy_local_title()]),
          h.p([], [m.public_legal_privacy_local()]),
          h.p([], [m.public_legal_privacy_storage_recovery()]),
          h.h2([], [m.public_legal_privacy_ship_title()]),
          h.p([], [m.public_legal_privacy_ship()]),
          h.p(
            [],
            [
              link(
                h,
                'https://www.cloudflare.com/privacypolicy/',
                m.public_legal_privacy_cloudflare()
              ),
              ' · ',
              link(
                h,
                'https://www.cloudflare.com/cloudflare-customer-dpa/',
                m.public_legal_privacy_dpa()
              ),
              ' · ',
              link(h, 'https://www.datatilsynet.no/', 'Datatilsynet')
            ]
          )
        ]
  return h.main(
    [
      h.Id('main-content'),
      h.Tabindex(-1),
      h.Class('mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 outline-none')
    ],
    [
      h.h1(
        [h.Class('text-3xl font-semibold')],
        [
          page === 'privacy'
            ? m.public_legal_privacy_title()
            : m.public_legal_terms_title()
        ]
      ),
      h.div([h.Class('prose prose-lg mt-6 max-w-none')], content)
    ]
  )
}
