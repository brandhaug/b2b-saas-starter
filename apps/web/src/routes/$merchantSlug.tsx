import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { runCapabilities } from '@/lib/capabilities'
import { resolvePublicBookingPage } from '@/lib/public-booking-page'
import { RoutePending } from '@/components/route-pending'
import { MerchantPwaRegistration } from '@/components/merchant-pwa-registration'

const currencyFormatters = new Map<string, Intl.NumberFormat>()
const formatMoney = (priceMinor: number, currency: string): string => {
  let formatter = currencyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en', { style: 'currency', currency })
    currencyFormatters.set(currency, formatter)
  }
  return formatter.format(priceMinor / 100)
}

export const Route = createFileRoute('/$merchantSlug')({
  beforeLoad: ({ location, params }) => {
    if (location.pathname === `/${params.merchantSlug}`) {
      throw redirect({ href: `/${params.merchantSlug}/`, statusCode: 308 })
    }
  },
  loader: async ({ params }) => {
    const result = await runCapabilities(resolvePublicBookingPage(params.merchantSlug))
    if (result.kind !== 'published') throw notFound({ data: { reason: result.kind } })
    return result.page
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {}

    return {
      meta: [
        { title: `${loaderData.publicName} | Book online` },
        { name: 'application-name', content: loaderData.publicName },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover'
        },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: loaderData.publicName }
      ],
      links: [
        {
          rel: 'manifest',
          href: `/merchant-manifest.webmanifest?merchant=${encodeURIComponent(params.merchantSlug)}`
        },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },
  pendingComponent: RoutePending,
  component: PublicMerchantPage,
  notFoundComponent: ({ data }) =>
    data &&
    typeof data === 'object' &&
    'reason' in data &&
    data.reason === 'unpublished' ? (
      <UnavailableMerchantPage />
    ) : (
      <GenericNotFoundPage />
    )
})

function PublicMerchantPage() {
  const page = Route.useLoaderData()
  const { merchantSlug } = Route.useParams()
  return <PublishedMerchantPage page={page} merchantSlug={merchantSlug} />
}

export function UnavailableMerchantPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <meta name="robots" content="noindex" />
      <section className="max-w-md border border-border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">Bookings are currently unavailable</h1>
        <p className="mt-3 text-sm text-muted-foreground">Please check back later.</p>
      </section>
    </main>
  )
}

export function GenericNotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <h1 className="text-2xl font-semibold">404</h1>
    </main>
  )
}

export function PublishedMerchantPage({
  page,
  merchantSlug
}: {
  readonly page: import('@b2b-saas-starter/capabilities/scheduling').PublicBookingPage
  readonly merchantSlug: string
}) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <MerchantPwaRegistration scope={`/${merchantSlug}/`} />
      <section className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-sm font-medium text-primary">Public Booking Page</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight">
          {page.publicName}
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Choose a service and find a time that works for you.
        </p>
        <a
          href={page.bookingPath}
          className="mt-8 inline-flex h-11 items-center bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Book an appointment
        </a>
        <div className="mt-16 grid gap-4 sm:grid-cols-2">
          {page.services.map((service) => (
            <article key={service.id} className="border border-border bg-card p-5">
              <p className="text-xs text-muted-foreground">
                {service.category ?? 'Service'}
              </p>
              <h2 className="mt-2 text-xl font-semibold">{service.name}</h2>
              {service.description ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {service.description}
                </p>
              ) : null}
              <p className="mt-4 text-sm">
                {service.durationMinutes} min ·{' '}
                {formatMoney(service.priceMinor, service.currency)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
