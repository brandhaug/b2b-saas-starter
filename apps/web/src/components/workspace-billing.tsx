import { Check, Minus } from 'lucide-react'
import { useState } from 'react'
import { Cause, Effect, Exit, Option } from 'effect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import { causeMessage } from '@/lib/cause-message'
import { startCheckoutServerFn } from '@/lib/server/billing'

const CHECKOUT_DISABLED =
  'Checkout is not available right now: billing is not configured for this deployment.'
const CHECKOUT_FAILED = 'Something went wrong starting checkout.'

/** The server function the Upgrade button calls; a test supplies its own. */
export type StartCheckout = (input: {
  readonly data: { readonly workspaceSlug: string; readonly planId: string }
}) => Promise<{ url: string }>

export type BillingPlan = {
  readonly id: string
  readonly name: string
  readonly price: string
  readonly description: string
  readonly limits: {
    readonly apiTokens: number | null
    readonly webhookEndpoints: number | null
  }
}

/**
 * One sentence out of a rejected checkout call. The capability-unavailable
 * case gets deployment guidance (its own message is the raw reason code);
 * everything else, including the plan-limit error, already carries copy a
 * human can read and passes through `causeMessage` untouched.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- `unknown` is the input: a rejected promise's value has no boundary schema, and probing it realm-safe needs one typeof
function checkoutErrorText(thrown: unknown): string {
  if (
    typeof thrown === 'object' &&
    thrown !== null &&
    'name' in thrown &&
    thrown.name === CAPABILITY_UNAVAILABLE_ERROR_NAME
  ) {
    return CHECKOUT_DISABLED
  }
  return causeMessage(thrown, CHECKOUT_FAILED)
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/**
 * The workspace billing page. Props-only so tests render it without the
 * router. Degradation is honest: when Stripe is not configured the upgrade
 * buttons explain themselves instead of failing on click.
 */
export function WorkspaceBillingPage({
  workspaceSlug,
  currentPlanId,
  plans,
  stripeConfigured,
  canManageBilling,
  startCheckout = startCheckoutServerFn
}: {
  readonly workspaceSlug: string
  readonly currentPlanId: string
  readonly plans: readonly BillingPlan[]
  readonly stripeConfigured: boolean
  /** Whether the viewer may change the plan (`organization:update`). */
  readonly canManageBilling: boolean
  readonly startCheckout?: StartCheckout
}) {
  const [error, setError] = useState<string | null>(null)
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)

  async function upgrade(planId: string) {
    setError(null)
    setPendingPlan(planId)
    // The server function rejects when the capability fails. `Effect.tryPromise`
    // moves that rejection into the error channel as a display message, so the
    // failure path is a value instead of a try/catch.
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => startCheckout({ data: { workspaceSlug, planId } }),
        catch: (thrown) => checkoutErrorText(thrown)
      })
    )
    setPendingPlan(null)
    if (Exit.isFailure(exit)) {
      setError(
        Option.getOrElse(Cause.findErrorOption(exit.cause), () => CHECKOUT_FAILED)
      )
      return
    }
    window.location.assign(exit.value.url)
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Badge>{currentPlanId}</Badge>
          <p className="text-sm text-muted-foreground">
            Entitlements follow the workspace's plan: Starter caps API tokens at 2 and
            webhook endpoints at 1; paid plans do not cap them.
          </p>
        </CardContent>
      </Card>
      {stripeConfigured ? null : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Billing is an optional provider and Stripe is not configured on this
          deployment. Set <code>STRIPE_SECRET_KEY</code>,{' '}
          <code>STRIPE_WEBHOOK_SECRET</code>, and the per-plan price ids to activate
          checkout. Everything else keeps working.
        </p>
      )}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {plan.name}
                {plan.id === currentPlanId ? (
                  <Badge variant="secondary">Current</Badge>
                ) : null}
              </CardTitle>
              <p className="text-2xl font-semibold">{plan.price}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>{plan.description}</p>
              <ul className="mt-2 grid gap-1">
                <EntitlementRow label="API tokens" limit={plan.limits.apiTokens} />
                <EntitlementRow
                  label="Webhook endpoints"
                  limit={plan.limits.webhookEndpoints}
                />
              </ul>
              {renderPlanAction({
                planId: plan.id,
                currentPlanId,
                canManageBilling,
                stripeConfigured,
                pending: pendingPlan !== null,
                pendingForPlan: pendingPlan === plan.id,
                onUpgrade: () => void upgrade(plan.id)
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

/**
 * The one decision under each plan card. Extracted so the JSX stays flat:
 * only the self-serve Team plan renders an upgrade button; Starter downgrades
 * ride the provider subscription flow and Enterprise is sold, not self-served.
 */
function renderPlanAction(input: {
  planId: string
  currentPlanId: string
  canManageBilling: boolean
  stripeConfigured: boolean
  pending: boolean
  pendingForPlan: boolean
  onUpgrade: () => void
}) {
  if (!input.canManageBilling || input.planId === input.currentPlanId) {
    return null
  }
  if (input.planId === 'team' && input.stripeConfigured) {
    return (
      <Button
        className="mt-2 w-fit"
        variant="outline"
        disabled={input.pending}
        onClick={input.onUpgrade}
      >
        {input.pendingForPlan ? 'Redirecting…' : 'Upgrade to Team'}
      </Button>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      {input.planId === 'starter'
        ? 'Downgrades are handled by the provider subscription flow.'
        : 'Contact sales to move to Enterprise.'}
    </p>
  )
}

function EntitlementRow({ label, limit }: { label: string; limit: number | null }) {
  if (limit === null) {
    return (
      <li className="flex items-center gap-2">
        <Check className="size-4 text-primary" />
        Unlimited {label.toLowerCase()}
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2">
      <Minus className="size-4 text-muted-foreground" />
      {label}: up to {limit}
    </li>
  )
}
