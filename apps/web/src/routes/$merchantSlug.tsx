import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { runCapabilities } from '@/lib/capabilities'
import { resolvePublicBookingPage } from '@/lib/public-booking-page'
import { RoutePending } from '@/components/route-pending'
import { MerchantPwaRegistration } from '@/components/merchant-pwa-registration'
import { PublicMerchantPresentation } from '@/components/public-merchant-presentation'

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
        { name: 'theme-color', content: '#000000' },
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
    <>
      <MerchantPwaRegistration scope={`/${merchantSlug}/`} />
      <PublicMerchantPresentation page={page} />
    </>
  )
}
