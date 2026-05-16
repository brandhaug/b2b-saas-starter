import { createFileRoute, Link } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/pricing')({
  component: PricingPage
})

const plans = [
  {
    name: 'Starter',
    price: '$0',
    description: 'Local development and reference implementation review.'
  },
  {
    name: 'Team',
    price: '$49',
    description: 'The shape most B2B SaaS products adapt first.'
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'SAML, procurement, custom compliance, and support patterns.'
  }
] as const

function PricingPage() {
  return (
    <PublicLayout>
      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <Badge variant="secondary">Billing-ready surface</Badge>
        <h1 className="mt-4 text-3xl font-semibold">Pricing page pattern</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Plans for teams adopting the starter. Checkout activates once a billing
          provider is connected.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.name}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <p className="text-3xl font-semibold">{plan.price}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{plan.description}</p>
                <button
                  type="button"
                  disabled
                  className="h-9 rounded-md border border-border text-sm text-muted-foreground"
                >
                  Get started
                </button>
                <p className="text-xs text-muted-foreground">
                  Available once a billing provider is configured.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Link
          to="/faq"
          className="mt-8 inline-flex text-sm text-primary underline underline-offset-4"
        >
          Read billing FAQ
        </Link>
      </main>
    </PublicLayout>
  )
}
