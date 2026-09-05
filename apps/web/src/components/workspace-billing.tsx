import { Check, Minus, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type Plan } from '@b2b-saas-starter/capabilities/billing/plan-catalog'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import { causeMessage } from '@/lib/cause-message'
import { useServerAction } from '@/hooks/use-server-action'
import { startCheckoutServerFn, startPortalSessionServerFn } from '@/lib/server/billing'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { Panel } from '@/components/page/panel'
import { Spinner } from '@/components/ui/spinner'
const CHECKOUT_DISABLED =
  'Checkout is not available right now: billing is not configured for this deployment.'
const CHECKOUT_FAILED = 'Something went wrong starting checkout.'
const PORTAL_FAILED = 'Something went wrong opening the billing portal.'
const PORTAL_UNAVAILABLE =
  'The billing portal is not available for this workspace yet. It opens after the first subscription. Start an upgrade first, then manage invoices and payment methods there.'

/** The server function the Upgrade button calls; a test supplies its own. */ export type StartCheckout =
  (input: {
    readonly data: { readonly workspaceSlug: string; readonly planId: string }
  }) => Promise<{ url: string }>

/** The server function the Manage-billing button calls; a test supplies its own. */
export type StartPortalSession = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<{ url: string }>

/**
 * The catalog record as the page renders it. It is the capability's own `Plan`
 * — including `purchase`, which is what decides a card's action, so no
 * component branches on a plan id.
 */
export type BillingPlan = Plan

/**
 * One sentence out of a rejected portal call. The capability-unavailable case
 * (an unbilled workspace, or a deployment whose Stripe settings just went
 * away) gets its own guidance; everything else passes through `causeMessage`.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- `unknown` is the input: a rejected promise's value has no boundary schema, and probing it realm-safe needs one typeof
function portalErrorText(thrown: unknown): string {
  if (
    typeof thrown === 'object' &&
    thrown !== null &&
    'name' in thrown &&
    thrown.name === CAPABILITY_UNAVAILABLE_ERROR_NAME
  ) {
    return PORTAL_UNAVAILABLE
  }
  return causeMessage(thrown, PORTAL_FAILED)
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

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
 * The current plan and the catalog of plans beside it, with whatever action
 * each plan's `purchase` mode allows. Props-only so tests render it without
 * the router. Degradation is honest: when Stripe is not configured the upgrade
 * buttons explain themselves instead of failing on click.
 */
export function BillingPlans({
  workspaceSlug,
  currentPlanId,
  plans,
  stripeConfigured,
  canManageBilling,
  startCheckout = startCheckoutServerFn,
  startPortalSession = startPortalSessionServerFn
}: {
  readonly workspaceSlug: string
  readonly currentPlanId: string
  readonly plans: ReadonlyArray<BillingPlan>
  readonly stripeConfigured: boolean
  /** Whether the viewer may change the plan (`organization:update`). */
  readonly canManageBilling: boolean
  readonly startCheckout?: StartCheckout
  readonly startPortalSession?: StartPortalSession
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

  // The portal is the same handoff shape: the server fn returns the hosted
  // URL, the browser leaves. The button renders only when Stripe is
  // configured — one definition, read off the capability's own `configured`.
  const portal = useServerAction<undefined, { url: string }>(
    () => startPortalSession({ data: { workspaceSlug } }),
    {
      failureMessage: PORTAL_FAILED,
      describeFailure: portalErrorText,
      invalidate: false,
      onSuccess: (session) => window.location.assign(session.url)
    }
  )

  const currentPlan = plans.find((plan) => plan.id === currentPlanId)

  return (
    <>
      <Panel
        title="Current plan"
        // The portal is the same handoff shape as checkout: the server fn
        // returns the hosted URL, the browser leaves. It renders only when
        // Stripe is configured — one definition, read off the capability's
        // own `configured` — and the workspace's customer must exist.
        actions={
          stripeConfigured && canManageBilling ? (
            <Button
              variant="secondary"
              disabled={portal.pending}
              onClick={() => portal.run(undefined)}
            >
              {portal.pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ExternalLink data-icon="inline-start" />
              )}
              Manage billing
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{currentPlan?.name ?? currentPlanId}</Badge>
          <p className="text-sm text-muted-foreground">
            Entitlements follow the workspace's plan
            {currentPlan === undefined ? '.' : `: ${entitlementSentence(currentPlan)}`}
          </p>
        </div>
      </Panel>
      <ActionFeedback error={portal.error} />
      {stripeConfigured ? null : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Billing is an optional provider and Stripe is not configured on this
          deployment. Set <Identifier>STRIPE_SECRET_KEY</Identifier>,{' '}
          <Identifier>STRIPE_WEBHOOK_SECRET</Identifier>, and the per-plan price ids to
          activate checkout. Everything else keeps working.
        </p>
      )}
      <ActionFeedback error={upgrade.error} />
      <Panel title="Plans">
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanTile
              key={plan.id}
              plan={plan}
              currentPlanId={currentPlanId}
              canManageBilling={canManageBilling}
              stripeConfigured={stripeConfigured}
              pendingPlan={upgrade.pendingInput ?? null}
              onUpgrade={() => upgrade.run(plan.id)}
            />
          ))}
        </div>
      </Panel>
    </>
  )
}

/**
 * One plan option inside the Plans panel: a muted lift on the panel surface,
 * not a nested card. The action follows the plan's `purchase` mode.
 */
function PlanTile({
  plan,
  currentPlanId,
  canManageBilling,
  stripeConfigured,
  pendingPlan,
  onUpgrade
}: {
  readonly plan: BillingPlan
  readonly currentPlanId: string
  readonly canManageBilling: boolean
  readonly stripeConfigured: boolean
  readonly pendingPlan: string | null
  readonly onUpgrade: () => void
}) {
  return (
    <div className="grid gap-2 rounded-none border border-border bg-muted p-4 content-start">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{plan.name}</h3>
        {plan.id === currentPlanId ? <Badge variant="neutral">Current</Badge> : null}
      </div>
      <p className="text-2xl font-semibold">{plan.price}</p>
      <p className="text-sm text-muted-foreground">{plan.description}</p>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        <EntitlementRow
          label="Seats"
          limit={plan.pricing === 'per_seat' ? null : plan.limits.seats}
          unlimitedLabel={
            plan.pricing === 'per_seat' ? 'Billed per member' : 'Unlimited seats'
          }
        />
        <EntitlementRow label="API tokens" limit={plan.limits.apiTokens} />
        <EntitlementRow
          label="Webhook endpoints"
          limit={plan.limits.webhookEndpoints}
        />
      </ul>
      <PlanAction
        plan={plan}
        currentPlanId={currentPlanId}
        canManageBilling={canManageBilling}
        stripeConfigured={stripeConfigured}
        pendingPlan={pendingPlan}
        onUpgrade={onUpgrade}
      />
    </div>
  )
}

/**
 * Which action goes under a plan card: the self-serve Team upgrade button, a
 * static hint for plans sold outside the product, or nothing. Each branch is
 * its own named component, so no boolean flags leak between variants.
 */
function PlanAction({
  plan,
  currentPlanId,
  canManageBilling,
  stripeConfigured,
  pendingPlan,
  onUpgrade
}: {
  readonly plan: BillingPlan
  readonly currentPlanId: string
  readonly canManageBilling: boolean
  readonly stripeConfigured: boolean
  readonly pendingPlan: string | null
  readonly onUpgrade: () => void
}) {
  if (plan.id === currentPlanId || !canManageBilling) {
    return null
  }
  if (plan.purchase === 'self_serve' && stripeConfigured) {
    return (
      <UpgradeButton
        planName={plan.name}
        disabled={pendingPlan !== null}
        busy={pendingPlan === plan.id}
        onUpgrade={onUpgrade}
      />
    )
  }
  return <StaticPlanHint plan={plan} />
}

/**
 * The self-serve upgrade CTA, rendered for whichever plans the catalog marks
 * `purchase: 'self_serve'`. Its own component so the pending spinner and the
 * disabled-during-any-checkout behavior live beside the one control that has
 * them.
 */
function UpgradeButton({
  planName,
  disabled,
  busy,
  onUpgrade
}: {
  readonly planName: string
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
      Upgrade to {planName}
    </Button>
  )
}

/** The copy under plans that are not self-serve upgradable from here. */
function StaticPlanHint({ plan }: { readonly plan: BillingPlan }) {
  return (
    <p className="text-xs text-muted-foreground">
      {plan.purchase === 'downgrade'
        ? 'Downgrades are handled by the provider subscription flow.'
        : `Contact sales to move to ${plan.name}.`}
    </p>
  )
}

/** The current plan's ceilings as one sentence, read off the plan itself. */
function entitlementSentence(plan: BillingPlan): string {
  const parts = [
    seatPhrase(plan),
    limitPhrase(plan.limits.apiTokens, 'API token'),
    limitPhrase(plan.limits.webhookEndpoints, 'webhook endpoint')
  ]
  return `${plan.name} allows ${parts.join(' and ')}.`
}

/** The seat half: included seats on a flat plan, per-member billing on per-seat. */
function seatPhrase(plan: BillingPlan): string {
  if (plan.pricing === 'per_seat') {
    return 'one seat per member'
  }
  if (plan.limits.seats === null) {
    return 'unlimited seats'
  }
  return `up to ${plan.limits.seats} seats`
}

function limitPhrase(limit: number | null, noun: string): string {
  if (limit === null) {
    return `unlimited ${noun}s`
  }
  return limit === 1 ? `1 ${noun}` : `up to ${limit} ${noun}s`
}

function EntitlementRow({
  label,
  limit,
  unlimitedLabel
}: {
  label: string
  limit: number | null
  /** What the unlimited row says; defaults to "Unlimited <label>". */
  unlimitedLabel?: string
}) {
  if (limit === null) {
    return (
      <li className="flex items-center gap-2">
        <Check className="size-4 text-primary" />
        {unlimitedLabel ?? `Unlimited ${label.toLowerCase()}`}
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
