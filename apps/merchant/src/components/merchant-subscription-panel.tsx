import { useState } from 'react'
import { Check, CreditCard, UserRound, UsersRound } from 'lucide-react'
import type { MerchantIdentity } from '@b2b-saas-starter/capabilities/merchant-catalog'

export type MerchantPlan = MerchantIdentity['plan']

const PLAN_DETAILS: Record<
  MerchantPlan,
  {
    readonly description: string
    readonly features: readonly string[]
    readonly label: string
  }
> = {
  solo: {
    label: 'Solo',
    description: 'The focused booking setup for an independent service provider.',
    features: [
      'One active provider',
      'Services and availability',
      'Customers and appointments',
      'Public booking flow'
    ]
  },
  team: {
    label: 'Team',
    description: 'Provider-aware scheduling for a growing service business.',
    features: [
      'Multiple providers',
      'Provider-specific services',
      'Provider availability',
      'Everything included in Solo'
    ]
  }
}

export function MerchantSubscriptionPanel({ plan }: { readonly plan: MerchantPlan }) {
  const [selection, setSelection] = useState<{
    readonly sourcePlan: MerchantPlan
    readonly selectedPlan: MerchantPlan
  }>({ sourcePlan: plan, selectedPlan: plan })
  const selectedPlan = selection.sourcePlan === plan ? selection.selectedPlan : plan
  const selected = PLAN_DETAILS[selectedPlan]
  const selectedIsCurrent = selectedPlan === plan
  const alternatePlan: MerchantPlan = selectedPlan === 'solo' ? 'team' : 'solo'

  return (
    <div
      data-merchant-subscription-panel="true"
      className="mx-auto flex w-full max-w-md flex-col gap-8"
    >
      <section
        aria-label="Subscription status"
        className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-muted/30"
      >
        <div className="flex min-h-[4.375rem] items-center gap-3 px-4 py-3.5">
          <PlanIcon plan={plan} />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 font-medium text-foreground">
              {PLAN_DETAILS[plan].label}
            </p>
            <p className="text-[0.8125rem] leading-5 text-muted-foreground">
              Merchant plan
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-xs leading-4 font-medium text-foreground">
            Current plan
          </span>
        </div>

        <div className="flex min-h-[6.5rem] items-start gap-3 px-4 py-3.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border">
            <CreditCard aria-hidden className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm leading-5 font-medium text-foreground">Billing</p>
              <span className="shrink-0 text-[0.8125rem] leading-5 font-medium text-muted-foreground">
                Needs configuration
              </span>
            </div>
            <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
              Plan changes will become available when a billing provider is connected.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="merchant-subscription-plans" className="space-y-4">
        <p
          id="merchant-subscription-plans"
          className="px-1 text-xs leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase"
        >
          Plans
        </p>

        <div
          aria-label="Compare merchant plans"
          className="grid h-[2.875rem] grid-cols-2 rounded-full border border-border bg-muted/50 p-1"
          role="group"
        >
          {(Object.keys(PLAN_DETAILS) as MerchantPlan[]).map((candidate) => {
            const active = candidate === selectedPlan
            return (
              <button
                key={candidate}
                type="button"
                aria-pressed={active}
                className={`h-9 rounded-full text-[0.8125rem] leading-5 font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.98] ${
                  active
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border/70'
                    : 'text-muted-foreground'
                }`}
                onClick={() =>
                  setSelection({ sourcePlan: plan, selectedPlan: candidate })
                }
              >
                {PLAN_DETAILS[candidate].label}
              </button>
            )
          })}
        </div>

        <div aria-live="polite" className="space-y-5 px-1 pt-1">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg leading-6 font-semibold text-foreground">
                {selected.label}
              </h2>
              {selectedIsCurrent ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] leading-4 font-medium text-muted-foreground">
                  Current
                </span>
              ) : null}
            </div>
            <p className="max-w-sm text-sm leading-5 text-muted-foreground">
              {selected.description}
            </p>
          </div>

          <ul className="space-y-2" aria-label={`${selected.label} features`}>
            {selected.features.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2.5 text-sm leading-5 text-foreground"
              >
                <Check
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
                <span>{feature}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled
            className="h-10 w-full rounded-full bg-foreground px-4 text-sm font-medium text-background opacity-45"
          >
            {selectedIsCurrent ? 'Current plan' : 'Billing not configured'}
          </button>
          <button
            type="button"
            className="mx-auto block text-[0.8125rem] leading-5 font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline active:opacity-70"
            onClick={() =>
              setSelection({ sourcePlan: plan, selectedPlan: alternatePlan })
            }
          >
            See {PLAN_DETAILS[alternatePlan].label} plan details
          </button>
          {!selectedIsCurrent ? (
            <p className="text-center text-[0.8125rem] leading-5 text-muted-foreground">
              Upgrades are unavailable until billing is configured.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function PlanIcon({ plan }: { readonly plan: MerchantPlan }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted-foreground shadow-sm ring-1 ring-border">
      {plan === 'team' ? (
        <UsersRound aria-hidden className="size-4" strokeWidth={1.8} />
      ) : (
        <UserRound aria-hidden className="size-4" strokeWidth={1.8} />
      )}
    </span>
  )
}
