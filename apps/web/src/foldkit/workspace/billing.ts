import { Effect } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import { formatCurrency, formatNumber } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import * as Api from '@/lib/server/billing'
import { viewerCan } from '@/lib/permissions'
import { formatTimestampOr } from '@/lib/format-date'
import { call } from '../server-call'
import { type Action, type Model, type Result } from './model'
import { action, button, checkbox, feedback, heading, link, panel, type H } from './ui'
import * as Checkout from './checkout'

export function execute(
  model: Model,
  operation: Extract<
    Action,
    { _tag: 'Checkout' | 'Portal' | 'Reconcile' | 'SelectResources' }
  >
) {
  const workspaceSlug = model.flags.slug
  return Effect.gen(function* () {
    switch (operation._tag) {
      case 'Checkout': {
        const result = yield* call(
          () =>
            Api.startCheckoutServerFn({
              data: {
                workspaceSlug,
                planId: operation.planId,
                interval: model.billing.interval
              }
            }),
          m.checkout_failed()
        )
        yield* Effect.sync(() => window.location.assign(result.url))
        break
      }
      case 'Portal': {
        const result = yield* call(
          () => Api.startPortalSessionServerFn({ data: { workspaceSlug } }),
          m.portal_failed(),
          { unavailable: m.portal_unavailable() }
        )
        yield* Effect.sync(() => window.location.assign(result.url))
        break
      }
      case 'Reconcile': {
        const result = yield* call(
          () => Api.reconcileCheckoutReturnServerFn({ data: { workspaceSlug } }),
          m.checkout_failed()
        )
        let notice = m.common_done()
        if (result.outcome === 'delayed') {
          notice = m.billing_sync_delayed()
        } else if (result.outcome === 'conflict') {
          notice = m.billing_sync_conflict()
        }
        return {
          _tag: 'Done',
          notice
        } satisfies Result
      }
      case 'SelectResources': {
        yield* call(
          () =>
            Api.selectBillingResourcesServerFn({
              data: {
                workspaceSlug,
                apiTokenIds: model.billing.tokenIds,
                webhookEndpointIds: model.billing.endpointIds
              }
            }),
          m.billing_save_selection_failed()
        )
        break
      }
      default: {
        break
      }
    }
    return { _tag: 'Done', notice: m.common_done() } satisfies Result
  })
}
export function view(model: Model, h: H) {
  if (model.page._tag !== 'billing') {
    return h.div([], [])
  }
  const data = model.page.data
  const canManage = viewerCan(data.viewer, { organization: ['update'] })
  const lifecycle = data.lifecycle
  const access = lifecycle.access
  const deadline = formatTimestampOr(access.endsAt, m.empty_value())
  let accessCopy = ''
  if (access.paid && access.reason === 'trialing') {
    accessCopy = m.billing_trial({ date: deadline })
  } else if (access.paid && access.reason === 'grace') {
    accessCopy = m.billing_payment_grace({ date: deadline })
  } else if (access.reason === 'unpaid') {
    accessCopy = m.billing_payment_unpaid()
  } else if (access.reason === 'incomplete') {
    accessCopy = m.billing_payment_incomplete()
  } else if (!access.paid && lifecycle.planId !== 'starter') {
    accessCopy = m.billing_access_restricted()
  }
  let synchronizationCopy = m.billing_sync_delayed()
  if (data.synchronization.status === 'pending') {
    synchronizationCopy = m.billing_sync_pending()
  } else if (data.synchronization.status === 'conflict') {
    synchronizationCopy = m.billing_sync_conflict()
  }
  const selectedTokens = new Set(model.billing.tokenIds)
  const selectedEndpoints = new Set(model.billing.endpointIds)
  const needsSelection =
    (data.resourceEntitlements.apiTokens.limit !== null &&
      data.resourceEntitlements.apiTokens.used >
        data.resourceEntitlements.apiTokens.limit) ||
    (data.resourceEntitlements.webhookEndpoints.limit !== null &&
      data.resourceEntitlements.webhookEndpoints.used >
        data.resourceEntitlements.webhookEndpoints.limit)
  const restricted = (!access.paid && lifecycle.planId !== 'starter') || needsSelection
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(h, m.nav_billing(), m.billing_description(), [
        button(h, m.refresh_newest(), { _tag: 'Perform', action: { _tag: 'Refresh' } })
      ]),
      ...(model.checkout === null
        ? []
        : [
            h.submodel({
              slotId: 'purchase-checkout',
              model: model.checkout,
              view: Checkout.view,
              toParentMessage: Checkout.message
            })
          ]),
      ...(model.pendingAction?._tag === 'Reconcile'
        ? [h.p([h.Role('status')], [m.billing_sync_pending()])]
        : []),
      panel(h, m.current_plan(), [
        h.h3(
          [h.Class('text-lg')],
          [
            data.plans.find((plan) => plan.id === data.currentPlanId)?.name ??
              data.currentPlanId
          ]
        ),
        h.p(
          [],
          [
            data.seatUsage.pricing === 'flat'
              ? m.shell_plan_seats({
                  count: data.seatUsage.included ?? 0,
                  formattedCount: String(data.seatUsage.included ?? 0)
                })
              : `${m.seats()}: ${data.seatUsage.used}`
          ]
        ),
        h.p([], [accessCopy]),
        ...(lifecycle.interval
          ? [
              h.p(
                [],
                [
                  lifecycle.interval === 'year'
                    ? m.billing_subscription_annual()
                    : m.billing_subscription_monthly()
                ]
              )
            ]
          : []),
        h.p([], [m.entitlements_follow_plan()]),
        ...(lifecycle.cancelAtPeriodEnd
          ? [
              h.output(
                [],
                [
                  m.billing_cancel_at_period_end({
                    date: formatTimestampOr(lifecycle.currentPeriodEnd, m.empty_value())
                  })
                ]
              )
            ]
          : []),
        h.p(
          [],
          [
            `${m.billing_period()}: ${formatTimestampOr(lifecycle.currentPeriodEnd, m.empty_value())}`
          ]
        ),
        ...(data.synchronization.status === 'current'
          ? []
          : [h.p([h.Role('status')], [synchronizationCopy])]),
        ...(canManage && data.stripeConfigured
          ? [
              button(
                h,
                m.manage_billing(),
                { _tag: 'Perform', action: { _tag: 'Portal' } },
                model.pending
              )
            ]
          : []),
        ...(!canManage && restricted
          ? [
              h.p([], [m.billing_access_restricted()]),
              h.p([], [m.billing_restricted_contact_admin()])
            ]
          : [])
      ]),
      ...(data.stripeConfigured
        ? []
        : [
            h.p(
              [h.Class('text-sm text-muted-foreground')],
              [
                m.billing_not_configured(),
                ' ',
                link(
                  h,
                  '/docs/getting-started/optional-providers',
                  m.billing_setup_guide()
                )
              ]
            )
          ]),
      panel(h, m.plans_title(), [
        h.div(
          [h.Class('flex gap-2')],
          (['month', 'year'] as const).map((value) =>
            h.button(
              [
                h.Type('button'),
                h.Attribute('aria-pressed', String(model.billing.interval === value)),
                h.OnClick({ _tag: 'Interval', value })
              ],
              [value === 'month' ? m.billing_monthly() : m.billing_annual()]
            )
          )
        ),
        ...(data.pricingUnavailable
          ? [h.p([], [m.billing_pricing_unavailable()])]
          : []),
        ...(canManage ? [h.p([], [m.billing_interval_portal()])] : []),
        h.div(
          [h.Class('grid gap-4 md:grid-cols-3')],
          data.plans.map((plan) => {
            let seats = m.shell_plan_seat_per_member()
            if (plan.pricing !== 'per_seat') {
              seats =
                plan.limits.seats === null
                  ? m.shell_plan_unlimited_seats()
                  : m.shell_plan_seats({
                      count: plan.limits.seats,
                      formattedCount: formatNumber(plan.limits.seats, getLocale())
                    })
            }
            const price =
              model.billing.interval === 'year'
                ? (plan.annualProviderPrice ??
                  (plan.providerPrice ? null : plan.annualPrice))
                : (plan.providerPrice ?? plan.price)
            const amount = price
              ? formatCurrency(price.amount, price.currency, getLocale())
              : ''
            let label = m.shell_plan_custom()
            if (price && plan.pricing === 'per_seat') {
              label =
                model.billing.interval === 'year'
                  ? m.shell_plan_annual_seat_price({ amount })
                  : m.shell_plan_seat_price({ amount })
            } else if (price) {
              label =
                model.billing.interval === 'year'
                  ? m.shell_plan_year_price({ amount })
                  : m.shell_plan_month_price({ amount })
            }
            let purchase = h.p([], [m.checkout_disabled()])
            if (
              plan.id === data.currentPlanId &&
              (plan.purchase !== 'self_serve' ||
                model.billing.interval === data.lifecycle.interval)
            ) {
              purchase = h.p([], [m.common_current()])
            } else if (
              canManage &&
              plan.purchase === 'self_serve' &&
              data.stripeConfigured &&
              price
            ) {
              purchase = button(
                h,
                m.shell_plan_upgrade({ name: plan.name }),
                { _tag: 'Perform', action: { _tag: 'Checkout', planId: plan.id } },
                model.pending
              )
            } else if (canManage && plan.purchase === 'downgrade') {
              purchase = action(h, model, m.shell_plan_downgrade(), { _tag: 'Portal' })
            } else if (plan.purchase === 'sales') {
              purchase = h.p([], [m.shell_plan_contact({ name: plan.name })])
            }
            return h.article(
              [h.Class('grid content-start gap-4 border p-4')],
              [
                h.h3([h.Class('text-lg font-semibold')], [plan.name]),
                h.p([], [m[plan.descriptionKey]()]),
                h.p([h.Class('text-lg tabular-nums')], [label]),
                ...(plan.pricing === 'per_seat'
                  ? [h.p([], [m.shell_plan_billed_member()])]
                  : []),
                ...(!data.stripeConfigured && price
                  ? [
                      h.p(
                        [h.Class('text-sm text-muted-foreground')],
                        [m.billing_example_price()]
                      )
                    ]
                  : []),
                h.p(
                  [],
                  [
                    m.shell_plan_entitlements({
                      name: plan.name,
                      seats,
                      tokens:
                        plan.limits.apiTokens === null
                          ? m.shell_plan_unlimited_tokens()
                          : m.shell_plan_tokens({
                              count: plan.limits.apiTokens,
                              formattedCount: formatNumber(
                                plan.limits.apiTokens,
                                getLocale()
                              )
                            }),
                      webhooks:
                        plan.limits.webhookEndpoints === null
                          ? m.shell_plan_unlimited_webhooks()
                          : m.shell_plan_webhooks({
                              count: plan.limits.webhookEndpoints,
                              formattedCount: formatNumber(
                                plan.limits.webhookEndpoints,
                                getLocale()
                              )
                            })
                    })
                  ]
                ),
                purchase
              ]
            )
          })
        )
      ]),
      ...(canManage && needsSelection
        ? [
            panel(h, m.billing_resource_selection_title(), [
              h.p([], [m.billing_resource_selection_description()]),
              ...data.apiTokens.map((token) =>
                checkbox(
                  h,
                  token.name,
                  selectedTokens.has(token.id),
                  { _tag: 'Resource', kind: 'token', id: token.id },
                  model.pending
                )
              ),
              ...data.webhookEndpoints.map((endpoint) =>
                checkbox(
                  h,
                  endpoint.url,
                  selectedEndpoints.has(endpoint.id),
                  { _tag: 'Resource', kind: 'endpoint', id: endpoint.id },
                  model.pending
                )
              ),
              action(h, model, m.billing_save_selection(), { _tag: 'SelectResources' })
            ])
          ]
        : []),
      feedback(h, model)
    ]
  )
}
