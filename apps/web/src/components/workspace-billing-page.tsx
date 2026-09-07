import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { type WorkspaceBillingPayload } from '@/lib/server/billing'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { WorkspaceShell } from '@/components/workspace-shell'
import { BillingPlans } from '@/components/workspace-billing'
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
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceBillingPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const router = useRouter()
  const { stripeConfigured, synchronization } = data
  useEffect(() => {
    if (!stripeConfigured) {
      return
    }
    // Poll the same loader that mutations invalidate; there is no second cache.
    const interval = synchronization.status === 'pending' ? 10_000 : 30_000
    const timer = window.setInterval(() => void router.invalidate(), interval)
    return () => window.clearInterval(timer)
  }, [router, stripeConfigured, synchronization.status])
  const canManageBilling =
    data.viewer !== null && viewerCan(data.viewer, { organization: ['update'] })
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
      />
    </WorkspaceShell>
  )
}
