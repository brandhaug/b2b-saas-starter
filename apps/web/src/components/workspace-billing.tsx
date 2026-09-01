import { Check, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import { causeMessage } from '@/lib/cause-message'
import { useServerAction } from '@/hooks/use-server-action'
import { startCheckoutServerFn } from '@/lib/server/billing'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'

const CHECKOUT_DISABLED =
  'Checkout is not available right now: billing is not configured for this deployment.'
const CHECKOUT_FAILED = 'Something went wrong starting checkout.'

/** The server function the Upgrade button calls; a test supplies its own. */ export type StartCheckout =
  (input: {
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
  readonly plans: ReadonlyArray<BillingPlan>
  readonly stripeConfigured: boolean
  /** Whether the viewer may change the plan (`organization:update`). */
  readonly canManageBilling: boolean
  readonly startCheckout?: StartCheckout
}) {
  // The server function rejects when the capability fails; the hook folds that
  // rejection into a displayable message via `checkoutErrorText`. Checkout
  // leaves the app, so there is no loader to re-run.
  const upgrade = useServerAction(
    (planId: string) => startCheckout({ data: { workspaceSlug, planId } }),
    {
      failureMessage: CHECKOUT_FAILED,
      describeFailure: checkoutErrorText,
      invalidate: false,
      onSuccess: (session) => window.location.assign(session.url)
    }
  )

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Current plan</CardTitle>
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
      {upgrade.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{upgrade.error}</AlertDescription>
        </Alert>
      )}
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
              <PlanAction
                planId={plan.id}
                currentPlanId={currentPlanId}
                canManageBilling={canManageBilling}
                stripeConfigured={stripeConfigured}
                pendingPlan={upgrade.pendingInput ?? null}
                onUpgrade={() => upgrade.run(plan.id)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

/**
 * Which action goes under a plan card: the self-serve Team upgrade button, a
 * static hint for plans sold outside the product, or nothing. Each branch is
 * its own named component, so no boolean flags leak between variants.
 */
function PlanAction({
  planId,
  currentPlanId,
  canManageBilling,
  stripeConfigured,
  pendingPlan,
  onUpgrade
}: {
  readonly planId: string
  readonly currentPlanId: string
  readonly canManageBilling: boolean
  readonly stripeConfigured: boolean
  readonly pendingPlan: string | null
  readonly onUpgrade: () => void
}) {
  if (planId === currentPlanId || !canManageBilling) {
    return null
  }
  if (planId === 'team' && stripeConfigured) {
    return (
      <TeamUpgradeButton
        disabled={pendingPlan !== null}
        busy={pendingPlan === planId}
        onUpgrade={onUpgrade}
      />
    )
  }
  return <StaticPlanHint planId={planId} />
}

/**
 * The self-serve upgrade CTA. Only the Team plan is purchasable in-product;
 * this variant exists so the pending spinner and the disabled-during-any-
 * checkout behavior live beside the one button that has them.
 */
function TeamUpgradeButton({
  disabled,
  busy,
  onUpgrade
}: {
  /** Any checkout in flight disables every button, not just its own plan's. */
  readonly disabled: boolean
  readonly busy: boolean
  readonly onUpgrade: () => void
}) {
  return (
    <Button
      className="mt-2 w-fit"
      variant="outline"
      disabled={disabled}
      onClick={onUpgrade}
    >
      {busy ? <Spinner data-icon="inline-start" /> : null}
      Upgrade to Team
    </Button>
  )
}

/** The copy under plans that are not self-serve upgradable from here. */
function StaticPlanHint({ planId }: { readonly planId: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {planId === 'starter'
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
