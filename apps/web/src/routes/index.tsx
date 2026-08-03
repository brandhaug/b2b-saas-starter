import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { PublicLayout } from '@/components/public-layout'

export const Route = createFileRoute('/')({
  component: HomePage,
  head: () => ({
    meta: [
      { title: 'Booking Product' },
      {
        name: 'description',
        content: 'Merchant-owned scheduling and a focused customer booking journey.'
      }
    ]
  })
})

function HomePage() {
  return (
    <PublicLayout>
      <main id="main-content">
        <section className="grid-paper border-b border-border">
          <div className="mx-auto max-w-5xl px-4 py-24 sm:px-6 lg:py-32">
            <p className="font-mono text-sm text-signal-ink">Booking Product</p>
            <h1 className="mt-5 max-w-3xl text-balance text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
              Scheduling that stays focused on the appointment.
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
              Merchants publish services, providers, and working hours. Customers choose
              what they need, reserve a time, and receive a secure confirmation.
            </p>
            <Link
              to="/$merchantSlug"
              params={{ merchantSlug: 'mara-booking-studio' }}
              className="mt-9 inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              View a public booking page
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </section>
      </main>
    </PublicLayout>
  )
}
