import { useEffect, useRef } from 'react'
import { useMatch, useRouter } from '@tanstack/react-router'
import {
  reconcileCheckoutReturnServerFn,
  type WorkspaceBillingPayload,
  type ReconcileCheckout
} from '@/lib/server/billing'
import { useServerAction } from '@/hooks/use-server-action'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WorkspaceShell } from '@/components/workspace-shell'
import { BillingPlans, type BillingPorts } from '@/components/workspace-billing'
import { ActionFeedback } from '@/components/page/action-feedback'
import { viewerCan } from '@/lib/permissions'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The billing page. Lives beside the route file (not in it) so the route
 * module stays a thin shell the router's code splitting can reduce to
 * `createFileRoute` + lazy segments — an exported page in a route file pins
 * its whole import graph into the route tree every page preloads.
 *
 * The route loader owns the payload; polling and successful mutations refresh
 * that same loader.
 */
export function WorkspaceBillingPage({
  workspaceSlug,
  data,
  systemRole,
  checkoutReturn,
  ports,
  reconcileCheckoutReturn = reconcileCheckoutReturnServerFn
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceBillingPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
  readonly checkoutReturn?: boolean
  /** Checkout, portal and selection transports. The preview refuses all three. */
  readonly ports?: BillingPorts
  readonly reconcileCheckoutReturn?: ReconcileCheckout
}) {
  const router = useRouter()
  // The invalidate filter names this route, not the nearest match, so the
  // demo renderer hosting this page does not re-run its own loader.
  const { routeId } = useMatch({
    from: '/workspaces/$workspaceSlug/billing',
    shouldThrow: false
  }) ?? {
    routeId: null
  }
  const reconciliationKey = useRef<string | null>(null)
  const { stripeConfigured, synchronization } = data
  const canManageBilling =
    data.viewer !== null && viewerCan(data.viewer, { organization: ['update'] })
  const reconcile = useServerAction(
    () => reconcileCheckoutReturn({ data: { workspaceSlug } }),
    {
      failureMessage: m.billing_sync_delayed()
    }
  )
  useEffect(() => {
    if (!checkoutReturn) {
      reconciliationKey.current = null
      return
    }
    if (
      !stripeConfigured ||
      !canManageBilling ||
      reconciliationKey.current === workspaceSlug
    ) {
      return
    }
    reconciliationKey.current = workspaceSlug
    reconcile.run(undefined)
  }, [canManageBilling, checkoutReturn, reconcile, stripeConfigured, workspaceSlug])
  useEffect(() => {
    if (!stripeConfigured || synchronization.status !== 'pending') {
      return
    }
    // Pending provider synchronization is the one state a refresh can resolve,
    // so the poll lives and dies with it. It refreshes this route's loader
    // only — a bare invalidate re-runs every loader in the match chain — and a
    // hidden tab waits, then catches up the moment it comes back.
    function refresh(): void {
      if (document.visibilityState !== 'visible') {
        return
      }
      void router.invalidate({ filter: (match) => match.routeId === routeId })
    }
    const timer = window.setInterval(refresh, 10_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, routeId, stripeConfigured, synchronization.status])
  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      unreadCount={data.unreadCount}
      viewer={data.viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.nav_billing()}
        description={m.billing_description()}
      />
      <BillingPlans
        workspaceSlug={workspaceSlug}
        currentPlanId={data.currentPlanId}
        plans={data.plans}
        pricingUnavailable={data.pricingUnavailable}
        stripeConfigured={data.stripeConfigured}
        synchronization={data.synchronization}
        lifecycle={data.lifecycle}
        resourceSelection={data.resourceSelection}
        apiTokens={data.apiTokens}
        webhookEndpoints={data.webhookEndpoints}
        resourceEntitlements={data.resourceEntitlements}
        canManageBilling={canManageBilling}
        {...ports}
      />
      {reconcile.pending ? (
        <output className="block text-sm text-muted-foreground">
          {m.billing_sync_pending()}
        </output>
      ) : null}
      <ActionFeedback error={reconcile.error} />
    </WorkspaceShell>
  )
}
