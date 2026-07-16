import { ArrowUpRight, CalendarDays, Clock3, Scissors, Sparkles } from 'lucide-react'
import type { PublicBookingPage } from '@b2b-saas-starter/capabilities/scheduling'

const currencyFormatters = new Map<string, Intl.NumberFormat>()

const formatMoney = (priceMinor: number, currency: string): string => {
  let formatter = currencyFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    })
    currencyFormatters.set(currency, formatter)
  }
  return formatter.format(priceMinor / 100)
}

const MARA_STUDIO_SLUG = 'mara-booking-studio'

export function PublicMerchantPresentation({
  page
}: {
  readonly page: PublicBookingPage
}) {
  if (page.merchantSlug !== MARA_STUDIO_SLUG) {
    return <DefaultMerchantPresentation page={page} />
  }

  return <MaraMerchantPresentation page={page} />
}

function MaraMerchantPresentation({ page }: { readonly page: PublicBookingPage }) {
  const categoryCount = new Set(
    page.services.flatMap((service) => (service.category ? [service.category] : []))
  ).size

  return (
    <main className="dark min-h-dvh bg-background text-foreground sm:px-5 sm:py-8">
      <div className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden bg-background sm:min-h-[calc(100dvh-4rem)] sm:rounded-[2.5rem] sm:shadow-2xl sm:shadow-black/50">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[62dvh] max-h-[670px]">
          <img
            alt="Barber at work in Mara Booking Studio"
            className="size-full object-cover object-center"
            fetchPriority="high"
            src="/images/merchant/mara-hero.png"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-background/45" />
        </div>

        <div className="relative flex min-h-dvh flex-col sm:min-h-[calc(100dvh-4rem)]">
          <header className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
            <div className="inline-flex min-h-11 items-center gap-2.5 rounded-full border border-border bg-background/25 px-4 backdrop-blur-md">
              <Scissors aria-hidden="true" className="size-4 text-primary" />
              <span className="max-w-56 truncate text-sm font-semibold tracking-tight">
                {page.publicName}
              </span>
            </div>
            <span className="size-2.5 rounded-full bg-success shadow-[0_0_0_5px_rgba(52,211,153,0.14)]" />
          </header>

          <div className="h-[27dvh] min-h-48 max-h-72" />

          <div className="px-6">
            <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {page.publicName}
            </p>
            <h1 className="max-w-[390px] text-balance text-[2.65rem] leading-[0.98] font-bold tracking-[-0.045em] text-foreground">
              Precision grooming, made personal
            </h1>
          </div>

          <div className="flex flex-col gap-4 px-4 pt-7 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
            <section aria-label="Studio overview" className="grid grid-cols-2 gap-4">
              <article className="flex h-60 flex-col justify-between rounded-3xl bg-card/90 p-5 backdrop-blur-md">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-pretty text-xl leading-6 font-bold tracking-tight">
                    Open for appointments
                  </p>
                  <span className="mt-1 size-3 shrink-0 rounded-full bg-success" />
                </div>
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    The studio
                  </p>
                  <p className="mt-1.5 text-lg leading-5 font-semibold">
                    {page.services.length} signature services
                  </p>
                </div>
              </article>

              <figure className="relative h-60 overflow-hidden rounded-3xl bg-card">
                <img
                  alt="Precision haircut detail"
                  className="size-full object-cover transition-transform duration-500 hover:scale-105"
                  loading="lazy"
                  src="/images/merchant/mara-haircut.png"
                />
                <figcaption className="sr-only">Precision haircut detail</figcaption>
              </figure>
            </section>

            <section
              className="overflow-hidden rounded-3xl bg-card"
              aria-labelledby="services-heading"
            >
              <div className="flex items-end justify-between gap-5 border-b border-border px-5 pt-5 pb-4">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    The menu
                  </p>
                  <h2
                    id="services-heading"
                    className="mt-1 text-2xl font-bold tracking-tight"
                  >
                    Services
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
                  {categoryCount} collections
                </div>
              </div>

              <div className="divide-y divide-border">
                {page.services.map((service) => (
                  <article
                    className="grid grid-cols-[1fr_auto] gap-4 px-5 py-4"
                    key={service.id}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-card-foreground">
                        {service.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                        {service.description ??
                          service.category ??
                          'Personal grooming service'}
                      </p>
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 aria-hidden="true" className="size-3.5" />
                        {service.durationMinutes} min
                      </p>
                    </div>
                    <p className="pt-0.5 text-sm font-semibold text-card-foreground">
                      {formatMoney(service.priceMinor, service.currency)}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section aria-label="Studio gallery" className="grid grid-cols-2 gap-4">
              <figure className="relative h-60 overflow-hidden rounded-3xl bg-card">
                <img
                  alt="Client with a fresh cut"
                  className="size-full object-cover transition-transform duration-500 hover:scale-105"
                  loading="lazy"
                  src="/images/merchant/mara-client.png"
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent px-4 pt-12 pb-4 text-sm font-semibold">
                  Made for you
                </figcaption>
              </figure>

              <article className="flex h-60 flex-col justify-between rounded-3xl bg-primary p-5 text-primary-foreground">
                <CalendarDays
                  aria-hidden="true"
                  className="size-8"
                  strokeWidth={2.25}
                />
                <div>
                  <p className="text-xl leading-6 font-bold tracking-tight">
                    Ready when you are
                  </p>
                  <p className="mt-2 text-sm leading-5 text-primary-foreground/80">
                    Pick a service, a specialist, and a time in the booking app.
                  </p>
                </div>
              </article>
            </section>

            <a
              className="mt-1 flex min-h-14 w-full items-center justify-between rounded-2xl bg-foreground px-5 text-sm font-semibold text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              href={page.bookingPath}
            >
              View booking times
              <ArrowUpRight aria-hidden="true" className="size-5" />
            </a>

            <footer className="flex justify-center pt-1 text-[13px] text-muted-foreground">
              <span>Powered by&nbsp;</span>
              <span className="font-semibold text-foreground">beesolo</span>
            </footer>
          </div>
        </div>
      </div>
    </main>
  )
}

function DefaultMerchantPresentation({ page }: { readonly page: PublicBookingPage }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
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
