import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { UserRound, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { DesktopHomeActions, DesktopHomePlaceholder } from './desktop-home-actions.tsx'

export function DesktopShell({
  layout,
  section,
  destinations,
  title,
  description,
  headerDate,
  children
}: {
  readonly layout: 'home' | 'modal'
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly headerDate?: string | undefined
  readonly children: ReactNode
}) {
  if (layout === 'home')
    return (
      <DesktopStage>
        <DesktopHomeCard destinations={destinations} headerDate={headerDate}>
          {children}
        </DesktopHomeCard>
      </DesktopStage>
    )

  return (
    <DesktopStage>
      <div aria-hidden="true" className="merchant-desktop-home-behind">
        <DesktopHomeCard
          destinations={destinations}
          headerDate={headerDate}
          interactive={false}
        >
          <DesktopHomePlaceholder />
        </DesktopHomeCard>
      </div>
      <DesktopRouteModal section={section} title={title} description={description}>
        {children}
      </DesktopRouteModal>
    </DesktopStage>
  )
}

function DesktopRouteModal({
  section,
  title,
  description,
  children
}: {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const location = useLocation()
  const router = useRouter()
  const appointmentDate = appointmentDateFromSearch(location.search)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="merchant-desktop-modal-title"
      className="merchant-desktop-modal"
      onCancel={(event) => {
        event.preventDefault()
        void router.navigate({ to: '/appointments', search: { date: appointmentDate } })
      }}
    >
      <header className="sticky top-0 z-20 grid grid-cols-[3rem_1fr_3rem] items-center border-b bg-background/92 px-4 py-3 backdrop-blur-xl">
        <span aria-hidden />
        <h1
          id="merchant-desktop-modal-title"
          className="truncate text-center text-base font-semibold"
        >
          {title}
        </h1>
        <Link
          to="/appointments"
          search={{ date: appointmentDate }}
          aria-label={`Close ${title}`}
          className="grid size-8 place-items-center justify-self-end rounded-full bg-muted text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" strokeWidth={2.5} />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {children}
      </div>
    </dialog>
  )
}

function DesktopStage({ children }: { readonly children: ReactNode }) {
  return (
    <main className="merchant-desktop-stage relative grid min-h-dvh place-items-center overflow-hidden p-6">
      <div aria-hidden className="merchant-desktop-orbit merchant-desktop-orbit-one" />
      <div aria-hidden className="merchant-desktop-orbit merchant-desktop-orbit-two" />
      {children}
    </main>
  )
}

function DesktopHomeCard({
  destinations,
  headerDate,
  interactive = true,
  children
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly headerDate?: string | undefined
  readonly interactive?: boolean
  readonly children: ReactNode
}) {
  const location = useLocation()
  const appointmentDate = headerDate ?? appointmentDateFromSearch(location.search)

  return (
    <section
      aria-label="Merchant desktop home"
      className="merchant-desktop-home-card relative z-10 flex h-[750px] w-[448px] flex-col overflow-hidden rounded-3xl border border-white/10 text-white shadow-2xl"
    >
      <header className="grid h-16 shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center px-5">
        <span className="grid size-11 place-items-center">
          <MerchantLogo />
        </span>
        <span className="justify-self-center text-sm font-medium text-white/45">
          {formatDesktopHeaderDate(appointmentDate)}
        </span>
        {interactive ? (
          <Link
            to="/settings"
            aria-label="Open Settings"
            className="grid size-11 place-items-center rounded-full text-white/70 transition-transform hover:text-white active:scale-[0.98]"
          >
            <span className="grid size-9 place-items-center rounded-full bg-white/8">
              <UserRound aria-hidden className="size-5" />
            </span>
          </Link>
        ) : (
          <span className="grid size-11 place-items-center rounded-full text-white/70">
            <span className="grid size-9 place-items-center rounded-full bg-white/8">
              <UserRound aria-hidden className="size-5" />
            </span>
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <div className="mt-5">{children}</div>
      </div>
      <div className="shrink-0 bg-gradient-to-t from-[#111720] via-[#111720]/98 to-transparent px-4 pt-3 pb-4">
        <DesktopHomeActions destinations={destinations} interactive={interactive} />
      </div>
    </section>
  )
}

function MerchantLogo() {
  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white">
      <svg
        aria-hidden="true"
        className="h-full w-full"
        fill="none"
        focusable="false"
        viewBox="0 0 126 126"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M0 0H126V126H0V0Z" fill="white" />
        <path
          d="M40.3 64.4L61.3 76.5V100.8L40.3 113L19.3 100.8V76.5L40.3 64.4Z"
          fill="black"
        />
        <path
          d="M84.7 13L105.7 25.2V49.5L84.7 61.6L63.7 49.5V25.2L84.7 13Z"
          fill="black"
        />
        <path
          d="M40.3 13L61.3 25.1V49.4L40.3 61.6L19.3 49.4V25.1L40.3 13Z"
          fill="black"
        />
        <path
          d="M84.7 64.4L105.7 76.6V100.9L84.7 113L63.7 100.9V76.6L84.7 64.4Z"
          fill="black"
        />
      </svg>
    </div>
  )
}

function appointmentDateFromSearch(search: unknown) {
  return typeof search === 'object' &&
    search !== null &&
    'date' in search &&
    typeof search.date === 'string'
    ? search.date
    : undefined
}

function formatDesktopHeaderDate(appointmentDate: string | undefined) {
  if (!appointmentDate) return ''

  const date = new Date(`${appointmentDate}T12:00:00.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== appointmentDate
  )
    return ''

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(date)
}
