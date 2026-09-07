import { createFileRoute } from '@tanstack/react-router'
import { loadPublicPricingServerFn } from '@/lib/server/billing'
import { PublicLayout } from '@/components/public-layout'
import { PublicBillingPlans } from '@/components/workspace-billing'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * Public pricing only renders the shared offer list. Workspace lifecycle,
 * recovery, and resource controls belong to an authenticated workspace.
 */
export const Route = createFileRoute('/pricing')({
  loader: () => loadPublicPricingServerFn(),
  component: PricingPage
})

function PricingPage() {
  const { plans, pricingUnavailable, stripeConfigured } = Route.useLoaderData()
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">{m.plans_title()}</h1>
        <p className="mt-2 text-muted-foreground">{m.billing_description()}</p>
        <div className="mt-8">
          <PublicBillingPlans
            plans={plans}
            pricingUnavailable={pricingUnavailable}
            stripeConfigured={stripeConfigured}
          />
        </div>
      </main>
    </PublicLayout>
  )
}
