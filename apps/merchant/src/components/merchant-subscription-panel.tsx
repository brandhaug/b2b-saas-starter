import { Check, CreditCard, UserRound } from 'lucide-react'
import type { MerchantIdentity } from '@b2b-saas-starter/capabilities/merchant-catalog'

export type MerchantPlan = MerchantIdentity['plan']

export type MerchantSubscriptionView = {
  readonly access: 'trialing' | 'active' | 'grace' | 'restricted'
  readonly interval: 'monthly' | 'annual'
  readonly trialEndsAt?: string | undefined
  readonly currentPeriodEndsAt?: string | undefined
  readonly graceEndsAt?: string | undefined
  readonly cancelAtPeriodEnd?: boolean | undefined
  readonly providerCustomerRef?: string | undefined
  readonly providerSubscriptionRef?: string | undefined
  readonly billingConfigured: boolean
  readonly notices?:
    | ReadonlyArray<{ readonly kind: string; readonly effectiveAt: string }>
    | undefined
}

const SOLO_FEATURES = [
  'One active professional',
  'Services and availability',
  'Customers and appointments',
  'Public booking flow'
] as const

export function MerchantSubscriptionPanel({
  plan,
  subscription,
  onManageBilling,
  onToggleCancellation,
  onSwitchInterval
}: {
  readonly plan: MerchantPlan
  readonly subscription?: MerchantSubscriptionView
  readonly onManageBilling?: (() => Promise<void>) | undefined
  readonly onToggleCancellation?: (() => Promise<void>) | undefined
  readonly onSwitchInterval?: (() => Promise<void>) | undefined
}) {
  const accessLabel = subscription
    ? (
        {
          trialing: 'Trialing',
          active: 'Active',
          grace: 'Grace',
          restricted: 'Restricted'
        } as const
      )[subscription.access]
    : 'Current plan'
  return (
    <div
      data-merchant-subscription-panel="true"
      className="mx-auto flex w-full max-w-md flex-col gap-8"
    >
      {subscription?.notices?.length ? (
        <section aria-label="Billing notices" className="space-y-2">
          {subscription.notices.map((notice) => (
            <output
              key={`${notice.kind}:${notice.effectiveAt}`}
              className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm"
            >
              {notice.kind.replaceAll('-', ' ')}
            </output>
          ))}
        </section>
      ) : null}
      <section
        aria-label="Subscription status"
        className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-muted/30"
      >
        <div className="flex min-h-[4.375rem] items-center gap-3 px-4 py-3.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border">
            <UserRound aria-hidden className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 font-medium text-foreground">Solo</p>
            <p className="text-[0.8125rem] leading-5 text-muted-foreground">
              Merchant plan
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-xs leading-4 font-medium text-foreground">
            {accessLabel}
          </span>
        </div>
        <div className="flex min-h-[6.5rem] items-start gap-3 px-4 py-3.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border">
            <CreditCard aria-hidden className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 font-medium text-foreground">Billing</p>
            <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
              {subscription?.billingConfigured
                ? subscription.cancelAtPeriodEnd
                  ? `Cancellation scheduled for ${subscription.currentPeriodEndsAt ?? 'period end'}.`
                  : subscription.access === 'grace'
                    ? `Payment recovery is available until ${subscription.graceEndsAt ?? 'the grace deadline'}.`
                    : 'Manage invoices, payment method, or scheduled cancellation.'
                : 'Billing configuration is not connected yet. Your saved work remains available.'}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="merchant-subscription-plan" className="space-y-4 px-1">
        <h2 id="merchant-subscription-plan" className="text-lg font-semibold">
          Solo plan
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">
          The focused booking setup for an independent professional.
        </p>
        <div className="grid grid-cols-2 gap-3" aria-label="Solo billing intervals">
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-sm font-medium">€19 monthly</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Excluding applicable VAT
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-sm font-medium">€190 annually</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Excluding applicable VAT
            </p>
          </div>
        </div>
        <ul className="space-y-2" aria-label="Solo plan features">
          {SOLO_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2.5 text-sm">
              <Check aria-hidden className="size-4 text-muted-foreground" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={Boolean(subscription && !subscription.billingConfigured)}
          onClick={() => void onManageBilling?.()}
          className="h-10 w-full rounded-full bg-foreground px-4 text-sm font-medium text-background opacity-45"
        >
          {subscription
            ? subscription.access === 'restricted'
              ? 'Recover billing'
              : 'Manage billing'
            : 'Current plan'}
        </button>
        {subscription?.providerSubscriptionRef ? (
          <button
            type="button"
            disabled={!subscription.billingConfigured}
            className="h-10 w-full rounded-full border border-border px-4 text-sm font-medium"
            onClick={() => void onToggleCancellation?.()}
          >
            {subscription.cancelAtPeriodEnd
              ? 'Undo scheduled cancellation'
              : 'Cancel at period end'}
          </button>
        ) : null}
        {subscription?.access === 'active' ? (
          <button
            type="button"
            disabled={!subscription.billingConfigured}
            className="h-10 w-full rounded-full border border-border px-4 text-sm font-medium"
            onClick={() => void onSwitchInterval?.()}
          >
            Switch to {subscription.interval === 'monthly' ? 'annual' : 'monthly'} at
            renewal
          </button>
        ) : null}
      </section>
      <span className="sr-only">{plan}</span>
    </div>
  )
}
