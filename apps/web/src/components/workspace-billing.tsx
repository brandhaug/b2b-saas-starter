import {
  type BillingLifecycle,
  type BillingSynchronizationStatus
} from '@b2b-saas-starter/billing/billing'
import { Check, Minus, ExternalLink } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  type Plan,
  type ResourceEntitlementSummary
} from '@b2b-saas-starter/billing/plan-catalog'
import { type ResourceSelectionInput } from '@b2b-saas-starter/billing/resource-entitlements'
import { CAPABILITY_UNAVAILABLE_ERROR_NAME } from '@/lib/capability-error'
import { causeMessage } from '@/lib/cause-message'
import { useServerAction } from '@/hooks/use-server-action'
import {
  startCheckoutServerFn,
  startPortalSessionServerFn,
  selectBillingResourcesServerFn
} from '@/lib/server/billing'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { Panel } from '@/components/page/panel'
import { Spinner } from '@/components/ui/spinner'
import { formatCurrency, formatDate, formatNumber } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { m } from '@b2b-saas-starter/i18n/messages'
function CHECKOUT_FAILED() {
  return m.checkout_failed()
}
function PORTAL_FAILED() {
  return m.portal_failed()
}
function PORTAL_UNAVAILABLE() {
  return m.portal_unavailable()
}

/** The server function the Upgrade button calls; a test supplies its own. */ export type StartCheckout =
  (input: {
    readonly data: { readonly workspaceSlug: string; readonly planId: string }
  }) => Promise<{ url: string }>

/** The server function the Manage-billing button calls; a test supplies its own. */
export type StartPortalSession = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<{ url: string }>

export type SelectBillingResources = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  }
}) => Promise<ResourceSelectionInput>

const EMPTY_RESOURCE_IDS: ReadonlyArray<string> = []
const EMPTY_RESOURCES: ReadonlyArray<{ readonly id: string; readonly name: string }> =
  []
const EMPTY_WEBHOOKS: ReadonlyArray<{ readonly id: string; readonly url: string }> = []

/**
 * The catalog record as the page renders it. It is the capability's own `Plan`
 * — including `purchase`, which is what decides a card's action, so no
 * component branches on a plan id.
 */
export type BillingPlan = Plan & { readonly providerPrice?: Plan['price'] }

/** Public pricing deliberately has no workspace, lifecycle, or recovery state. */
export function PublicBillingPlans({
  plans,
  pricingUnavailable,
  stripeConfigured
}: {
  readonly plans: ReadonlyArray<BillingPlan>
  readonly pricingUnavailable: boolean
  readonly stripeConfigured: boolean
}) {
  return (
    <Panel title={m.plans_title()}>
      {pricingUnavailable ? (
        <p className="mb-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {m.billing_pricing_unavailable()}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanTile
            key={plan.id}
            plan={plan}
            priceNote={stripeConfigured ? null : m.billing_example_price()}
          />
        ))}
      </div>
    </Panel>
  )
}

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
    return PORTAL_UNAVAILABLE()
  }
  return causeMessage(thrown, PORTAL_FAILED())
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

/** Checkout conflicts and provider outages share the translated availability response. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- rejected promises are untrusted input at the UI boundary
function checkoutErrorText(thrown: unknown): string {
  return causeMessage(thrown, CHECKOUT_FAILED())
}

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
  pricingUnavailable = false,
  synchronization,
  lifecycle,
  resourceSelection = null,
  apiTokens = EMPTY_RESOURCES,
  webhookEndpoints = EMPTY_WEBHOOKS,
  resourceEntitlements,
  canManageBilling,
  startCheckout = startCheckoutServerFn,
  startPortalSession = startPortalSessionServerFn,
  selectBillingResources = selectBillingResourcesServerFn
}: {
  readonly workspaceSlug: string
  readonly currentPlanId: string
  readonly plans: ReadonlyArray<BillingPlan>
  readonly stripeConfigured: boolean
  readonly pricingUnavailable?: boolean
  readonly synchronization: BillingSynchronizationStatus
  readonly lifecycle: BillingLifecycle
  readonly resourceSelection?: {
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  } | null
  readonly apiTokens?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly webhookEndpoints?: ReadonlyArray<{
    readonly id: string
    readonly url: string
  }>
  readonly resourceEntitlements: {
    readonly apiTokens: ResourceEntitlementSummary
    readonly webhookEndpoints: ResourceEntitlementSummary
  }
  /** Whether the viewer may change the plan (`organization:update`). */
  readonly canManageBilling: boolean
  readonly startCheckout?: StartCheckout
  readonly startPortalSession?: StartPortalSession
  readonly selectBillingResources?: SelectBillingResources
}) {
  // The server function rejects when the capability fails; the hook folds that
  // rejection into a displayable message via `checkoutErrorText`. Checkout
  // leaves the app, so there is no loader to re-run.
  const upgrade = useServerAction(
    (planId: string) => startCheckout({ data: { workspaceSlug, planId } }),
    {
      failureMessage: CHECKOUT_FAILED(),
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
      failureMessage: PORTAL_FAILED(),
      describeFailure: portalErrorText,
      invalidate: false,
      onSuccess: (session) => window.location.assign(session.url)
    }
  )

  const currentPlan = plans.find((plan) => plan.id === currentPlanId)

  return (
    <>
      <Panel
        title={m.current_plan()}
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
              {m.manage_billing()}
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{currentPlan?.name ?? currentPlanId}</Badge>
          <p className="text-sm text-muted-foreground">
            {m.entitlements_follow_plan()}
            {currentPlan === undefined ? '.' : `: ${entitlementSentence(currentPlan)}`}
          </p>
        </div>
      </Panel>
      <BillingSynchronization status={synchronization.status} />
      <BillingLifecycleStatus lifecycle={lifecycle} effectivePlanId={currentPlanId} />
      <BillingResourceAccess
        canManageBilling={canManageBilling}
        currentPlanId={currentPlanId}
        lifecycle={lifecycle}
        workspaceSlug={workspaceSlug}
        resourceSelection={resourceSelection}
        apiTokens={apiTokens}
        webhookEndpoints={webhookEndpoints}
        resourceEntitlements={resourceEntitlements}
        selectBillingResources={selectBillingResources}
      />
      <ActionFeedback error={portal.error} />
      {stripeConfigured ? null : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {m.billing_not_configured()} <Identifier>STRIPE_SECRET_KEY</Identifier>,{' '}
          <Identifier>STRIPE_WEBHOOK_SECRET</Identifier>{' '}
          {m.billing_configure_price_ids()}
        </p>
      )}
      <ActionFeedback error={upgrade.error} />
      <Panel title={m.plans_title()}>
        {pricingUnavailable ? (
          <p className="mb-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {m.billing_pricing_unavailable()}
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanTile
              key={plan.id}
              plan={plan}
              badge={
                plan.id === currentPlanId ? (
                  <Badge variant="neutral">{m.common_current()}</Badge>
                ) : null
              }
              priceNote={stripeConfigured ? null : m.billing_example_price()}
            >
              <PlanAction
                plan={plan}
                currentPlanId={currentPlanId}
                canManageBilling={canManageBilling}
                stripeConfigured={stripeConfigured}
                pendingPlan={upgrade.pendingInput ?? null}
                onUpgrade={() => upgrade.run(plan.id)}
              />
            </PlanTile>
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
  badge,
  priceNote,
  children
}: {
  readonly plan: BillingPlan
  readonly badge?: ReactNode
  readonly priceNote: ReactNode
  readonly children?: ReactNode
}) {
  return (
    <div className="grid gap-2 rounded-none border border-border bg-muted p-4 content-start">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{plan.name}</h3>
        {badge}
      </div>
      <p className="text-2xl font-semibold">{planPrice(plan)}</p>
      {priceNote ? <p className="text-xs text-muted-foreground">{priceNote}</p> : null}
      <p className="text-sm text-muted-foreground">{planDescription(plan)}</p>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        <EntitlementRow
          label={m.seats()}
          limit={plan.pricing === 'per_seat' ? null : plan.limits.seats}
          unlimitedLabel={
            plan.pricing === 'per_seat'
              ? m.shell_plan_billed_member()
              : m.shell_plan_unlimited_label({
                  label: m.seats().toLocaleLowerCase(getLocale())
                })
          }
        />
        <EntitlementRow label={m.nav_api_tokens()} limit={plan.limits.apiTokens} />
        <EntitlementRow
          label={m.nav_webhook_endpoints()}
          limit={plan.limits.webhookEndpoints}
        />
      </ul>
      {children}
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
  readonly currentPlanId: string | null
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
      {m.shell_plan_upgrade({ name: planName })}
    </Button>
  )
}

/** The copy under plans that are not self-serve upgradable from here. */
function StaticPlanHint({ plan }: { readonly plan: BillingPlan }) {
  return (
    <p className="text-xs text-muted-foreground">
      {plan.purchase === 'downgrade'
        ? m.shell_plan_downgrade()
        : m.shell_plan_contact({ name: plan.name })}
    </p>
  )
}

/** The current plan's ceilings as one sentence, read off the plan itself. */
function entitlementSentence(plan: BillingPlan): string {
  return m.shell_plan_entitlements({
    name: plan.name,
    seats: seatPhrase(plan),
    tokens:
      plan.limits.apiTokens === null
        ? m.shell_plan_unlimited_tokens()
        : m.shell_plan_tokens({
            count: plan.limits.apiTokens,
            formattedCount: formatNumber(plan.limits.apiTokens, getLocale())
          }),
    webhooks:
      plan.limits.webhookEndpoints === null
        ? m.shell_plan_unlimited_webhooks()
        : m.shell_plan_webhooks({
            count: plan.limits.webhookEndpoints,
            formattedCount: formatNumber(plan.limits.webhookEndpoints, getLocale())
          })
  })
}

function seatPhrase(plan: BillingPlan): string {
  if (plan.pricing === 'per_seat') {
    return m.shell_plan_seat_per_member()
  }
  if (plan.limits.seats === null) {
    return m.shell_plan_unlimited_seats()
  }
  return m.shell_plan_seats({
    count: plan.limits.seats,
    formattedCount: formatNumber(plan.limits.seats, getLocale())
  })
}

function planPrice(plan: BillingPlan): string {
  if (plan.price === null) {
    return m.shell_plan_custom()
  }
  const price = plan.providerPrice ?? plan.price
  const amount = formatCurrency(price.amount, price.currency, getLocale())
  if (price.amount === 0) {
    return amount
  }
  return plan.pricing === 'per_seat'
    ? m.shell_plan_seat_price({ amount })
    : m.shell_plan_month_price({ amount })
}

function BillingLifecycleStatus({
  lifecycle,
  effectivePlanId
}: {
  readonly lifecycle: BillingLifecycle
  readonly effectivePlanId: string
}) {
  if (lifecycle.status === 'unpaid') {
    return (
      <output className="block text-sm text-muted-foreground">
        {m.billing_payment_unpaid()}
      </output>
    )
  }
  if (lifecycle.status === 'incomplete') {
    return (
      <output className="block text-sm text-muted-foreground">
        {m.billing_payment_incomplete()}
      </output>
    )
  }
  if (effectivePlanId === 'starter' && lifecycle.planId !== 'starter') {
    return (
      <output className="block text-sm text-muted-foreground">
        {m.billing_access_restricted()}
      </output>
    )
  }
  if (lifecycle.cancelAtPeriodEnd && lifecycle.currentPeriodEnd) {
    return (
      <output className="block text-sm text-muted-foreground">
        {m.billing_cancel_at_period_end({
          date: formatBillingDate(lifecycle.currentPeriodEnd)
        })}
      </output>
    )
  }
  if (lifecycle.status === 'trialing' && lifecycle.trialEnd) {
    return (
      <output className="block text-sm text-muted-foreground">
        {m.billing_trial({ date: formatBillingDate(lifecycle.trialEnd) })}
      </output>
    )
  }
  if (lifecycle.status === 'past_due' && lifecycle.graceEndsAt) {
    return (
      <output className="block text-sm text-muted-foreground">
        {m.billing_payment_grace({ date: formatBillingDate(lifecycle.graceEndsAt) })}
      </output>
    )
  }

  return null
}

function formatBillingDate(value: string): string {
  return formatDate(value, getLocale(), { dateStyle: 'medium' }, 'UTC')
}

function toggleResource(
  id: string,
  limit: number,
  set: (update: (selected: ReadonlyArray<string>) => ReadonlyArray<string>) => void
): void {
  set((selected) => {
    if (selected.includes(id)) {
      return selected.filter((item) => item !== id)
    }
    return selected.length < limit ? [...selected, id] : selected
  })
}

function BillingResourceAccess({
  canManageBilling,
  currentPlanId,
  lifecycle,
  resourceEntitlements,
  ...props
}: {
  readonly canManageBilling: boolean
  readonly currentPlanId: string
  readonly lifecycle: BillingLifecycle
  readonly resourceEntitlements: {
    readonly apiTokens: ResourceEntitlementSummary
    readonly webhookEndpoints: ResourceEntitlementSummary
  }
  readonly workspaceSlug: string
  readonly resourceSelection: {
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  } | null
  readonly apiTokens: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly webhookEndpoints: ReadonlyArray<{
    readonly id: string
    readonly url: string
  }>
  readonly selectBillingResources: SelectBillingResources
}) {
  if (canManageBilling) {
    return (
      <DowngradeResourceSelector
        {...props}
        resourceEntitlements={resourceEntitlements}
      />
    )
  }
  // `currentPlanId` is Billing's deadline-aware effective entitlement. The
  // lifecycle plan is the subscribed plan, so a paid subscription that has
  // fallen back to Starter is restricted even when its raw status is active;
  // a valid paid trial is not restricted merely because it is trialing.
  if (
    (currentPlanId === 'starter' && lifecycle.planId !== 'starter') ||
    resourceEntitlements.apiTokens.used >
      resourceEntitlements.apiTokens.activeIds.length ||
    resourceEntitlements.webhookEndpoints.used >
      resourceEntitlements.webhookEndpoints.activeIds.length
  ) {
    return (
      <p className="text-sm text-muted-foreground">
        {m.billing_restricted_contact_admin()}
      </p>
    )
  }
  return null
}

function DowngradeResourceSelector({
  workspaceSlug,
  resourceSelection,
  apiTokens,
  webhookEndpoints,
  selectBillingResources,
  resourceEntitlements
}: {
  readonly workspaceSlug: string
  readonly resourceSelection: {
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  } | null
  readonly apiTokens: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly webhookEndpoints: ReadonlyArray<{
    readonly id: string
    readonly url: string
  }>
  readonly selectBillingResources: SelectBillingResources
  readonly resourceEntitlements: {
    readonly apiTokens: ResourceEntitlementSummary
    readonly webhookEndpoints: ResourceEntitlementSummary
  }
}) {
  const [tokenIds, setTokenIds] = useState<ReadonlyArray<string>>(() =>
    reconcileSelection(
      resourceSelection?.apiTokenIds ?? EMPTY_RESOURCE_IDS,
      apiTokens.map(({ id }) => id),
      2
    )
  )
  const [webhookIds, setWebhookIds] = useState<ReadonlyArray<string>>(() =>
    reconcileSelection(
      resourceSelection?.webhookEndpointIds ?? EMPTY_RESOURCE_IDS,
      webhookEndpoints.map(({ id }) => id),
      1
    )
  )
  const selection = useServerAction(
    (input: Parameters<SelectBillingResources>[0]) => selectBillingResources(input),
    {
      failureMessage: m.billing_save_selection_failed(),
      invalidate: true
    }
  )
  useEffect(() => {
    // The loader is the external source of truth after invalidation; reset the
    // local editable draft to its normalized projection.
    // oxlint-disable-next-line react-hooks/set-state-in-effect -- synchronizes the local draft with a successful loader invalidation
    setTokenIds(
      reconcileSelection(
        resourceSelection?.apiTokenIds ?? EMPTY_RESOURCE_IDS,
        apiTokens.map(({ id }) => id),
        2
      )
    )
    setWebhookIds(
      reconcileSelection(
        resourceSelection?.webhookEndpointIds ?? EMPTY_RESOURCE_IDS,
        webhookEndpoints.map(({ id }) => id),
        1
      )
    )
  }, [resourceSelection, apiTokens, webhookEndpoints])
  const overLimit = [
    resourceEntitlements.apiTokens,
    resourceEntitlements.webhookEndpoints
  ].some(({ used, limit }) => limit !== null && used > limit)
  if (!overLimit) {
    return null
  }
  function save(): void {
    selection.run({
      data: {
        workspaceSlug,
        apiTokenIds: [...tokenIds],
        webhookEndpointIds: [...webhookIds]
      }
    })
  }
  return (
    <Panel title={m.billing_resource_selection_title()}>
      <p className="mb-4 text-sm text-muted-foreground">
        {m.billing_resource_selection_description()}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <ResourceChoices
          label={m.nav_api_tokens()}
          items={apiTokens}
          selected={tokenIds}
          disabled={selection.pending}
          onToggle={(id) => toggleResource(id, 2, setTokenIds)}
        />
        <ResourceChoices
          label={m.nav_webhook_endpoints()}
          items={webhookEndpoints}
          selected={webhookIds}
          disabled={selection.pending}
          onToggle={(id) => toggleResource(id, 1, setWebhookIds)}
        />
      </div>
      <Button className="mt-4" disabled={selection.pending} onClick={save}>
        {selection.pending ? <Spinner data-icon="inline-start" /> : null}
        {m.billing_save_selection()}
      </Button>
      <ActionFeedback error={selection.error} />
    </Panel>
  )
}

function reconcileSelection(
  selected: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
  limit: number
): ReadonlyArray<string> {
  const availableIds = new Set(available)
  return selected.filter((id) => availableIds.has(id)).slice(0, limit)
}

function ResourceChoices({
  label,
  items,
  selected,
  disabled,
  onToggle
}: {
  readonly label: string
  readonly items: ReadonlyArray<{
    readonly id: string
    readonly name?: string
    readonly url?: string
  }>
  readonly selected: ReadonlyArray<string>
  readonly disabled: boolean
  readonly onToggle: (id: string) => void
}) {
  const selectedIds = new Set(selected)
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <Label key={item.id} htmlFor={`billing-resource-${item.id}`}>
            <Checkbox
              id={`billing-resource-${item.id}`}
              checked={selectedIds.has(item.id)}
              disabled={disabled}
              onCheckedChange={() => onToggle(item.id)}
            />
            <code>{item.name ?? item.url ?? item.id}</code>
          </Label>
        ))}
      </div>
    </fieldset>
  )
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
        {unlimitedLabel ??
          m.shell_plan_unlimited_label({ label: label.toLocaleLowerCase(getLocale()) })}
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2">
      <Minus className="size-4 text-muted-foreground" />
      {m.shell_plan_limit_label({ label, limit: formatNumber(limit, getLocale()) })}
    </li>
  )
}

function planDescription(plan: BillingPlan): string {
  switch (plan.descriptionKey) {
    case 'shell_plan_starter_description': {
      return m.shell_plan_starter_description()
    }
    case 'shell_plan_team_description': {
      return m.shell_plan_team_description()
    }
    case 'shell_plan_enterprise_description': {
      return m.shell_plan_enterprise_description()
    }
  }
}

function BillingSynchronization({
  status
}: {
  readonly status: BillingSynchronizationStatus['status']
}) {
  let message: string
  switch (status) {
    case 'current': {
      return null
    }
    case 'pending': {
      message = m.billing_sync_pending()
      break
    }
    case 'delayed': {
      message = m.billing_sync_delayed()
      break
    }
    case 'conflict': {
      message = m.billing_sync_conflict()
      break
    }
  }
  return <output className="block text-sm text-muted-foreground">{message}</output>
}
