import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type HtmlBuilder, type Html } from 'foldkit/html'
import { loadWorkspaceBillingServerFnResponse } from '@/http/contracts/billing'
import { continuePurchaseServerFn } from '@/lib/server/purchase'
import { viewerCan } from '@/lib/permissions'
import { formatCurrency } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { m } from '@b2b-saas-starter/i18n/messages'
import { call } from '../server-call'
import { link } from '../shared/view'
import { button, feedback, panel, text } from './ui'

export const Flags = Schema.Struct({
  workspaceSlug: Schema.String,
  data: loadWorkspaceBillingServerFnResponse
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  error: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Continue: {},
  Failed: { error: Schema.String },
  Completed: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('PurchaseCheckout.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})
const Continue = Command.define('PurchaseCheckout.Continue', {
  args: { workspaceSlug: Schema.String },
  messages: [Message.cases.Completed, Message.cases.Failed],
  execute: ({ workspaceSlug }) =>
    call(
      () => continuePurchaseServerFn({ data: { planId: 'team', workspaceSlug } }),
      m.checkout_failed()
    ).pipe(
      Effect.map(({ url }) => {
        window.location.assign(url)
        return Message.cases.Completed.make({})
      }),
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: { flags, ready: false, pending: false, error: null },
    commands: [Ready()]
  }
}
function planFor(data: typeof loadWorkspaceBillingServerFnResponse.Type) {
  return data.plans.find((plan) => plan.id === 'team' && plan.purchase === 'self_serve')
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Continue': {
      if (
        !model.ready ||
        model.pending ||
        !model.flags.data.stripeConfigured ||
        !planFor(model.flags.data) ||
        !viewerCan(model.flags.data.viewer, { organization: ['update'] })
      ) {
        return { model }
      }
      return {
        model: { ...model, pending: true, error: null },
        commands: [Continue({ workspaceSlug: model.flags.workspaceSlug })]
      }
    }
    case 'Failed': {
      return { model: { ...model, pending: false, error: message.error } }
    }
    case 'Completed': {
      return { model }
    }
  }
}
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const data = model.flags.data
  const plan = planFor(data)
  const price = plan?.providerPrice ?? plan?.price
  let priceLabel = m.shell_plan_custom()
  if (price) {
    const amount = formatCurrency(price.amount, price.currency, getLocale())
    priceLabel =
      plan?.pricing === 'per_seat'
        ? m.shell_plan_seat_price({ amount })
        : m.shell_plan_month_price({ amount })
  }
  return panel(h, m.purchase_plan({ name: plan?.name ?? 'Team' }), '', [
    ...(plan ? [h.p([h.Class('text-lg font-medium')], [priceLabel])] : []),
    ...(data.stripeConfigured ? [] : [text(h, m.billing_example_price())]),
    text(
      h,
      m.purchase_confirmation({
        workspace: data.workspaceName,
        count: data.seatUsage.used
      })
    ),
    text(h, m.purchase_portal_note()),
    ...(viewerCan(data.viewer, { organization: ['update'] })
      ? [
          button(
            h,
            m.purchase_checkout(),
            { _tag: 'Continue' },
            !model.ready || model.pending || !data.stripeConfigured || !plan
          )
        ]
      : [text(h, m.purchase_refused())]),
    ...(data.stripeConfigured ? [] : [text(h, m.billing_not_configured())]),
    ...(data.pricingUnavailable ? [text(h, m.billing_pricing_unavailable())] : []),
    feedback(h, model.error),
    h.div(
      [h.Class('flex flex-wrap gap-4')],
      [
        link(h, '/purchase?plan=team', m.purchase_change_workspace()),
        link(
          h,
          `/workspaces/${encodeURIComponent(model.flags.workspaceSlug)}/billing`,
          m.manage_billing()
        ),
        link(h, '/pricing', m.purchase_cancel())
      ]
    )
  ])
}
