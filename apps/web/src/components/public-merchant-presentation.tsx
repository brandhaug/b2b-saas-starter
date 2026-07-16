import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Maximize2,
  Scissors,
  Users,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const maraGallery = [
  {
    alt: 'Barber at work in Mara Booking Studio',
    src: '/images/merchant/mara-hero.png'
  },
  {
    alt: 'Precision haircut detail',
    src: '/images/merchant/mara-haircut.png'
  },
  {
    alt: 'Client with a fresh cut',
    src: '/images/merchant/mara-client.png'
  }
] as const

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
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null)
  const [locationOpen, setLocationOpen] = useState(false)

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
              <StudioStatusCard />
              <StudioTeamCard teamMembers={page.teamMembers} />
            </section>

            <section aria-label="Studio gallery" className="grid grid-cols-2 gap-4">
              <button
                aria-label="Open studio gallery"
                className="group relative h-60 overflow-hidden rounded-3xl bg-card"
                onClick={() => setGalleryIndex(2)}
                type="button"
              >
                <img
                  alt=""
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                  src="/images/merchant/mara-client.png"
                />
              </button>

              {page.location ? (
                <StudioMapCard
                  location={page.location}
                  onOpen={() => setLocationOpen(true)}
                />
              ) : null}
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

        {galleryIndex !== null ? (
          <StudioGallery
            index={galleryIndex}
            onClose={() => setGalleryIndex(null)}
            onNavigate={setGalleryIndex}
          />
        ) : null}

        {locationOpen && page.location ? (
          <StudioLocationMap
            location={page.location}
            onClose={() => setLocationOpen(false)}
          />
        ) : null}
      </div>
    </main>
  )
}

function StudioStatusCard() {
  return (
    <article className="flex h-60 flex-col justify-between rounded-3xl bg-card/90 p-5 backdrop-blur-md">
      <div className="relative">
        <p className="text-pretty text-[18px] leading-[22px] font-bold tracking-[0.5px] text-card-foreground">
          Open for appointments
        </p>
        <span
          aria-hidden="true"
          className="absolute top-1 right-0 size-3 rounded-full bg-success"
        />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">Booking</p>
        <p className="mt-1 text-lg font-semibold text-card-foreground">
          By appointment
        </p>
      </div>
    </article>
  )
}

function StudioTeamCard({
  teamMembers
}: {
  readonly teamMembers: PublicBookingPage['teamMembers']
}) {
  return (
    <article className="flex h-60 flex-col justify-between rounded-3xl bg-card p-5">
      <div className="flex items-center justify-between">
        <Users aria-hidden="true" className="size-8 text-primary" strokeWidth={2.5} />
        <div className="flex -space-x-3" aria-label="Mara Booking Studio team">
          {teamMembers.slice(0, 3).map((member) => (
            <span
              aria-label={member.displayName}
              className="grid size-10 place-items-center rounded-full border-2 border-card bg-muted text-xs font-semibold text-foreground"
              key={member.id}
              title={member.displayName}
            >
              {initials(member.displayName)}
            </span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-pretty text-xl leading-6 font-bold tracking-[0.5px] text-card-foreground">
          Studio team
        </p>
        <p className="mt-3 text-sm leading-5 text-muted-foreground">
          Pick a favorite or take the next available chair
        </p>
      </div>
    </article>
  )
}

const initials = (displayName: string) =>
  displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

type PublicLocation = NonNullable<PublicBookingPage['location']>

const openStreetMapUrl = (location: PublicLocation) => {
  const longitudeOffset = 0.006
  const latitudeOffset = 0.0054
  const bbox = [
    location.longitude - longitudeOffset,
    location.latitude - latitudeOffset,
    location.longitude + longitudeOffset,
    location.latitude + latitudeOffset
  ]
    .map((coordinate) => coordinate.toFixed(4))
    .join(',')
  const params = new URLSearchParams({
    bbox,
    layer: 'mapnik',
    marker: `${location.latitude},${location.longitude}`
  })
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`
}

function StudioMapCard({
  location,
  onOpen
}: {
  readonly location: PublicLocation
  readonly onOpen: () => void
}) {
  return (
    <article className="group relative h-60 overflow-hidden rounded-3xl bg-card shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <iframe
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full border-0 grayscale invert-[0.88] contrast-125"
        loading="lazy"
        src={openStreetMapUrl(location)}
        tabIndex={-1}
        title="Map preview"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Location</p>
          <p className="mt-1 line-clamp-2 text-pretty text-sm font-semibold text-foreground">
            {location.label}
          </p>
        </div>
        <button
          aria-label="Open location map"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background/70 text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onOpen}
          type="button"
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </button>
      </div>
    </article>
  )
}

function useNativeModal() {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')

    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  return dialogRef
}

function StudioGallery({
  index,
  onClose,
  onNavigate
}: {
  readonly index: number
  readonly onClose: () => void
  readonly onNavigate: (index: number) => void
}) {
  const current = maraGallery[index] ?? maraGallery[0]
  const previous = (index - 1 + maraGallery.length) % maraGallery.length
  const next = (index + 1) % maraGallery.length
  const dialogRef = useNativeModal()

  return (
    <dialog
      aria-label="Studio gallery"
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none flex-col border-0 bg-background/95 p-0 text-foreground backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onNavigate(previous)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onNavigate(next)
        }
      }}
      ref={dialogRef}
    >
      <div className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <span className="text-sm font-medium text-muted-foreground">
          {index + 1} / {maraGallery.length}
        </span>
        <button
          aria-label="Close gallery"
          className="flex size-11 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-muted"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-6" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 py-6">
        <img
          alt={current.alt}
          className="max-h-full w-full max-w-[480px] rounded-3xl object-contain"
          src={current.src}
        />
        <button
          aria-label="Previous image"
          className="absolute left-6 flex size-11 items-center justify-center rounded-full bg-card/90 text-foreground"
          onClick={() => onNavigate(previous)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-6" />
        </button>
        <button
          aria-label="Next image"
          className="absolute right-6 flex size-11 items-center justify-center rounded-full bg-card/90 text-foreground"
          onClick={() => onNavigate(next)}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="size-6" />
        </button>
      </div>

      <div className="flex justify-center gap-3 px-4 pb-8">
        {maraGallery.map((image, imageIndex) => (
          <button
            aria-current={imageIndex === index}
            aria-label={`View image ${imageIndex + 1}`}
            className="relative size-16 shrink-0 overflow-hidden rounded-2xl opacity-60 aria-current:opacity-100 aria-current:ring-2 aria-current:ring-primary"
            key={image.src}
            onClick={() => onNavigate(imageIndex)}
            type="button"
          >
            <img alt="" className="size-full object-cover" src={image.src} />
          </button>
        ))}
      </div>
    </dialog>
  )
}

function StudioLocationMap({
  location,
  onClose
}: {
  readonly location: PublicLocation
  readonly onClose: () => void
}) {
  const dialogRef = useNativeModal()

  return (
    <dialog
      aria-label="Studio location"
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-background p-0 text-foreground"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      ref={dialogRef}
    >
      <iframe
        className="absolute inset-0 size-full border-0 grayscale invert-[0.88] contrast-125"
        src={openStreetMapUrl(location)}
        title={`Map of ${location.label}`}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <div className="flex min-h-12 items-center gap-3 rounded-full bg-background/85 px-4 text-foreground shadow-lg backdrop-blur-md">
          <MapPin aria-hidden="true" className="size-5 text-primary" />
          <span className="text-sm font-semibold">{location.label}</span>
        </div>
        <button
          aria-label="Close location map"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-background/85 text-foreground shadow-lg backdrop-blur-md"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-6" />
        </button>
      </div>
    </dialog>
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
