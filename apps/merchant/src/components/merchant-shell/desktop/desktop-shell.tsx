import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AnimationEvent, ReactNode } from 'react'
import { BeeSoloLogo } from '@/components/beesolo-logo.tsx'
import { useMobileCalendarDate } from '@/features/appointments/mobile/use-mobile-calendar-date.ts'
import {
  hasMerchantOverlayNavigationOrigin,
  merchantOverlayNavigationState
} from '@/lib/merchant-home-route.ts'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { MerchantHomeAtmosphere } from '../home-atmosphere.tsx'
import { DesktopDateHeader } from './desktop-date-header.tsx'
import { DesktopHomeActions } from './desktop-home-actions.tsx'

export function DesktopShell({
  layout,
  section,
  destinations,
  title,
  description,
  headerDate,
  headerTimezone,
  children
}: {
  readonly layout: 'home' | 'modal'
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly headerDate?: string | undefined
  readonly headerTimezone?: string | undefined
  readonly children: ReactNode
}) {
  if (layout === 'home')
    return (
      <DesktopStage>
        <DesktopHomeCard
          destinations={destinations}
          headerDate={headerDate}
          headerTimezone={headerTimezone}
        >
          {children}
        </DesktopHomeCard>
      </DesktopStage>
    )

  return (
    <DesktopRouteModal section={section} title={title} description={description}>
      {children}
    </DesktopRouteModal>
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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasNavigatedRef = useRef(false)
  const [modalState, setModalState] = useState<'entering' | 'open' | 'closing'>(
    'entering'
  )
  const location = useLocation()
  const router = useRouter()
  const appointmentDate = appointmentDateFromSearch(location.search)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const navigateHome = () => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    if (hasMerchantOverlayNavigationOrigin(location.state)) {
      router.history.back()
      return
    }
    void router.navigate({
      to: '/appointments',
      search: { date: appointmentDate }
    })
  }

  const closeModal = () => {
    if (modalState === 'closing') return
    setModalState('closing')
    closeTimerRef.current = setTimeout(navigateHome, 170)
  }

  const handleAnimationEnd = (event: AnimationEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return
    if (
      modalState === 'entering' &&
      event.animationName === 'merchant-desktop-modal-enter'
    ) {
      setModalState('open')
    }
    if (
      modalState === 'closing' &&
      event.animationName === 'merchant-desktop-modal-exit'
    ) {
      navigateHome()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="merchant-desktop-modal-title"
      data-desktop-modal-state={modalState}
      className="merchant-desktop-modal"
      onAnimationEnd={handleAnimationEnd}
      onCancel={(event) => {
        event.preventDefault()
        closeModal()
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
        <button
          type="button"
          aria-label={`Close ${title}`}
          className="grid size-8 place-items-center justify-self-end rounded-full bg-muted text-muted-foreground hover:text-foreground"
          onClick={closeModal}
        >
          <X aria-hidden className="size-4" strokeWidth={2.5} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 py-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
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
      {children}
    </main>
  )
}

function DesktopHomeCard({
  destinations,
  headerDate,
  headerTimezone,
  interactive = true,
  children
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly headerDate?: string | undefined
  readonly headerTimezone?: string | undefined
  readonly interactive?: boolean
  readonly children: ReactNode
}) {
  const location = useLocation()
  const appointmentDate = headerDate ?? appointmentDateFromSearch(location.search)
  const timezone = headerTimezone ?? 'UTC'
  const currentDate = useMobileCalendarDate(timezone)

  return (
    <section
      aria-label="Merchant desktop home"
      className="merchant-desktop-home-card relative z-10 flex h-full w-full max-w-md md:h-[750px] flex-col overflow-hidden md:rounded-3xl text-foreground shadow-alyn"
    >
      <MerchantHomeAtmosphere />
      <header className="relative z-10 grid h-20 shrink-0 grid-cols-[2.75rem_1fr_2.75rem] items-center px-4">
        <span className="grid size-11 place-items-center">
          <MerchantLogo />
        </span>
        <div className="min-w-0 justify-self-stretch px-2">
          {appointmentDate ? (
            <DesktopDateHeader date={appointmentDate} currentDate={currentDate} />
          ) : null}
        </div>
        {interactive ? (
          <Link
            to="/settings"
            search={appointmentDate ? { date: appointmentDate } : {}}
            state={(previous) =>
              merchantOverlayNavigationState(previous, appointmentDate)
            }
            viewTransition={false}
            aria-label="Open Settings"
            className="grid size-11 place-items-center rounded-full text-muted-foreground transition-transform hover:text-foreground active:scale-[0.98]"
          >
            <span className="grid size-9 place-items-center rounded-full bg-muted">
              <UserRound aria-hidden className="size-5" />
            </span>
          </Link>
        ) : (
          <span className="grid size-11 place-items-center rounded-full text-muted-foreground">
            <span className="grid size-9 place-items-center rounded-full bg-muted">
              <UserRound aria-hidden className="size-5" />
            </span>
          </span>
        )}
      </header>
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <div>{children}</div>
      </div>
      <div className="relative z-10 shrink-0 px-4 pt-3 pb-4">
        <DesktopHomeActions
          destinations={destinations}
          appointmentDate={appointmentDate}
          interactive={interactive}
        />
      </div>
    </section>
  )
}

function MerchantLogo() {
  return <BeeSoloLogo iconOnly />
}

function appointmentDateFromSearch(search: unknown) {
  return typeof search === 'object' &&
    search !== null &&
    'date' in search &&
    typeof search.date === 'string'
    ? search.date
    : undefined
}
