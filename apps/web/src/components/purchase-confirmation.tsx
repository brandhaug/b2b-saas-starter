import { PlanPrice } from './workspace-billing'
import { Link } from '@tanstack/react-router'
import { type PurchaseIntent } from '@/lib/purchase-intent'
import { continuePurchaseServerFn } from '@/lib/server/purchase'
import { type WorkspaceBillingPayload } from '@/lib/server/billing'
import { useServerAction } from '@/hooks/use-server-action'
import { viewerCan } from '@/lib/permissions'
import { Panel } from './page/panel'
import { ActionFeedback } from './page/action-feedback'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'
import { m } from '@b2b-saas-starter/i18n/messages'

export function PurchaseConfirmation({
  intent,
  workspaceSlug,
  data
}: {
  readonly intent: PurchaseIntent
  readonly workspaceSlug: string
  readonly data: WorkspaceBillingPayload
}) {
  const checkout = useServerAction(
    () => continuePurchaseServerFn({ data: { ...intent, workspaceSlug } }),
    {
      failureMessage: m.checkout_failed(),
      invalidate: false,
      onSuccess: ({ url }) => window.location.assign(url)
    }
  )
  const plan = data.plans.find(
    (candidate) => candidate.id === intent.planId && candidate.purchase === 'self_serve'
  )
  const permitted = viewerCan(data.viewer, { organization: ['update'] })
  return (
    <Panel title={m.purchase_plan({ name: plan?.name ?? 'Team' })}>
      <div className="grid gap-4">
        {plan ? (
          <p className="text-lg font-medium">
            <PlanPrice plan={plan} />
          </p>
        ) : null}
        {data.stripeConfigured ? null : (
          <p className="text-xs text-muted-foreground">{m.billing_example_price()}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {m.purchase_confirmation({
            workspace: data.workspaceName,
            count: data.seatUsage.used
          })}
        </p>
        <p className="text-sm text-muted-foreground">{m.purchase_portal_note()}</p>
        {permitted ? (
          <Button
            disabled={checkout.pending || !data.stripeConfigured || plan === undefined}
            onClick={() => checkout.run(undefined)}
          >
            {checkout.pending ? <Spinner data-icon="inline-start" /> : null}
            {m.purchase_checkout()}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{m.purchase_refused()}</p>
        )}
        {data.stripeConfigured ? null : (
          <p className="text-sm text-muted-foreground">{m.billing_not_configured()}</p>
        )}
        {data.pricingUnavailable ? (
          <p className="text-sm text-muted-foreground">
            {m.billing_pricing_unavailable()}
          </p>
        ) : null}
        <ActionFeedback error={checkout.error} />
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            to="/purchase"
            search={{ plan: intent.planId }}
            className="underline underline-offset-4"
          >
            {m.purchase_change_workspace()}
          </Link>
          <Link
            to="/workspaces/$workspaceSlug/billing"
            params={{ workspaceSlug }}
            search={{}}
            className="underline underline-offset-4"
          >
            {m.manage_billing()}
          </Link>
          <Link to="/pricing" className="underline underline-offset-4">
            {m.purchase_cancel()}
          </Link>
        </div>
      </div>
    </Panel>
  )
}
