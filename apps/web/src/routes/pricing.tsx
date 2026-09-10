import { createFileRoute, Link } from '@tanstack/react-router'
import { loadPublicPricingServerFn } from '@/lib/server/billing'
import { pageTitle } from '@/components/page/page-title'
import { PublicLayout } from '@/components/public-layout'
import { Button } from '@/components/ui/button'
import { PublicBillingPlans } from '@/components/workspace-billing'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * Public pricing only renders the shared offer list (ADR 0023). Workspace
 * lifecycle, recovery, and resource controls belong to an authenticated
 * workspace, so the page carries one way in rather than a fake buy button
 * per plan.
 */
export const Route = createFileRoute('/pricing')({
  loader: () => loadPublicPricingServerFn(),
  component: PricingPage,
  head: () => ({
    meta: [
      { title: pageTitle(m.public_meta_pricing()) },
      { name: 'description', content: m.public_pricing_description() },
      { property: 'og:title', content: pageTitle(m.public_meta_pricing()) },
      { property: 'og:description', content: m.public_pricing_description() }
    ]
  })
})

function PricingPage() {
  const { plans, pricingUnavailable, stripeConfigured } = Route.useLoaderData()
  return (
    <PublicLayout>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 outline-none"
      >
        {/* Distinct from the plan list's own "Plans" heading below. */}
        <h1 className="text-3xl font-semibold">{m.public_pricing_title()}</h1>
        <p className="mt-2 text-muted-foreground">{m.public_pricing_description()}</p>
        <div className="mt-8">
          <PublicBillingPlans
            plans={plans}
            pricingUnavailable={pricingUnavailable}
            stripeConfigured={stripeConfigured}
          />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border border-border p-6">
          <p className="max-w-2xl text-sm text-muted-foreground">
            {m.public_pricing_cta_note()}
          </p>
          <Button nativeButton={false} render={<Link to="/workspaces" />}>
            {m.public_pricing_cta()}
          </Button>
        </div>
      </main>
    </PublicLayout>
  )
}
