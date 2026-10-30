import { Schema } from 'effect'
import { type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { formatCurrency, formatNumber } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { loadPublicPricingServerFnResponse } from '@/http/contracts/billing'
import { purchaseIntent } from '@/lib/purchase-intent'
import { buttonClass, link } from '../shared/view'

export const Flags = loadPublicPricingServerFnResponse
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  interval: Schema.Literals(['month', 'year'])
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  ChangedInterval: { interval: Schema.Literals(['month', 'year']) }
})
export type Message = typeof Message.Type
export function init(flags: Flags): Update.Return<Model, Message> {
  return { model: { flags, interval: 'month' } }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  return { model: { ...model, interval: message.interval } }
}
type Plan = Flags['plans'][number]
export function priceLabel(plan: Plan, interval: Model['interval']): string {
  if (plan.price === null) {
    return m.shell_plan_custom()
  }
  const price =
    interval === 'year' && plan.purchase === 'self_serve'
      ? (plan.annualProviderPrice ??
        (plan.providerPrice === null ? plan.annualPrice : undefined))
      : (plan.providerPrice ?? plan.price)
  if (price === undefined) {
    return m.billing_pricing_unavailable()
  }
  const amount = formatCurrency(price.amount, price.currency, getLocale())
  if (price.amount === 0) {
    return amount
  }
  if (price.interval === 'year') {
    return plan.pricing === 'per_seat'
      ? m.shell_plan_annual_seat_price({ amount })
      : m.shell_plan_year_price({ amount })
  }
  return plan.pricing === 'per_seat'
    ? m.shell_plan_seat_price({ amount })
    : m.shell_plan_month_price({ amount })
}
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const { plans, pricingUnavailable, stripeConfigured } = model.flags
  const hasAnnual = plans.some((plan) =>
    stripeConfigured
      ? plan.annualProviderPrice !== undefined
      : plan.annualPrice !== undefined
  )
  return h.main(
    [
      h.Id('main-content'),
      h.Tabindex(-1),
      h.Class('mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 outline-none')
    ],
    [
      h.h1([h.Class('text-3xl font-semibold')], [m.public_pricing_title()]),
      h.p([h.Class('mt-2 text-muted-foreground')], [m.public_pricing_description()]),
      h.section(
        [h.Class('mt-8 border border-border p-6')],
        [
          h.h2([h.Class('mb-4 text-lg font-semibold')], [m.plans_title()]),
          hasAnnual
            ? h.fieldset(
                [h.Class('mb-4 flex gap-2'), h.AriaLabel(m.billing_interval())],
                (['month', 'year'] as const).map((interval) =>
                  h.button(
                    [
                      h.Type('button'),
                      h.Class(buttonClass),
                      h.Attribute('aria-pressed', String(model.interval === interval)),
                      h.OnClick(Message.cases.ChangedInterval.make({ interval }))
                    ],
                    [interval === 'month' ? m.billing_monthly() : m.billing_annual()]
                  )
                )
              )
            : null,
          pricingUnavailable
            ? h.p(
                [
                  h.Class(
                    'mb-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground'
                  )
                ],
                [m.billing_pricing_unavailable()]
              )
            : null,
          h.div(
            [h.Class('grid gap-4 md:grid-cols-3')],
            plans.map((plan) => {
              const descriptions = {
                shell_plan_starter_description: m.shell_plan_starter_description(),
                shell_plan_team_description: m.shell_plan_team_description(),
                shell_plan_enterprise_description: m.shell_plan_enterprise_description()
              }
              const limits = [
                {
                  label: m.seats(),
                  limit: plan.pricing === 'per_seat' ? null : plan.limits.seats,
                  unlimited:
                    plan.pricing === 'per_seat' ? m.shell_plan_billed_member() : null
                },
                {
                  label: m.nav_api_tokens(),
                  limit: plan.limits.apiTokens,
                  unlimited: null
                },
                {
                  label: m.nav_webhook_endpoints(),
                  limit: plan.limits.webhookEndpoints,
                  unlimited: null
                }
              ]
              return h.div(
                [
                  h.Class(
                    'grid h-full content-start gap-3 rounded-none border border-border bg-muted p-4 [grid-template-rows:auto_auto_auto_1fr_auto]'
                  )
                ],
                [
                  h.h3([h.Class('font-semibold')], [plan.name]),
                  h.p(
                    [h.Class('text-2xl font-semibold')],
                    [priceLabel(plan, model.interval)]
                  ),
                  stripeConfigured
                    ? null
                    : h.p(
                        [h.Class('text-xs text-muted-foreground')],
                        [m.billing_example_price()]
                      ),
                  h.p(
                    [h.Class('text-sm text-muted-foreground')],
                    [descriptions[plan.descriptionKey]]
                  ),
                  h.ul(
                    [h.Class('grid gap-1 text-sm text-muted-foreground')],
                    limits.map(({ label, limit, unlimited }) =>
                      h.li(
                        [],
                        [
                          limit === null
                            ? (unlimited ??
                              m.shell_plan_unlimited_label({
                                label: label.toLocaleLowerCase(getLocale())
                              }))
                            : m.shell_plan_limit_label({
                                label,
                                limit: formatNumber(limit, getLocale())
                              })
                        ]
                      )
                    )
                  ),
                  plan.purchase === 'self_serve' && purchaseIntent(plan.id)
                    ? link(
                        h,
                        `/purchase?plan=${encodeURIComponent(plan.id)}`,
                        m.purchase_plan({ name: plan.name }),
                        buttonClass
                      )
                    : null
                ]
              )
            })
          )
        ]
      ),
      h.div(
        [
          h.Class(
            'mt-6 flex flex-wrap items-center justify-between gap-4 border border-border p-6'
          )
        ],
        [
          h.p(
            [h.Class('max-w-2xl text-sm text-muted-foreground')],
            [m.public_pricing_cta_note()]
          ),
          link(h, '/workspaces', m.public_pricing_cta(), buttonClass)
        ]
      )
    ]
  )
}
