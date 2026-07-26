import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { ChevronLeft, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { AnimationEvent, ReactNode } from 'react'
import { BeeSoloMark } from '@/components/beesolo-logo.tsx'
import { useMobileCalendarDate } from '@/features/appointments/mobile/use-mobile-calendar-date.ts'
import {
  hasMerchantOverlayNavigationOrigin,
  merchantOverlayNavigationState
} from '@/lib/merchant-home-route.ts'
import type { MerchantViewer } from '@/lib/merchant-viewer.ts'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { MerchantHomeAtmosphere } from '../home-atmosphere.tsx'
import { DesktopDateHeader } from './desktop-date-header.tsx'
import { DesktopHomeActions } from './desktop-home-actions.tsx'
import { DesktopUserButton } from './desktop-user-button.tsx'

type DesktopSecondaryDialogDescriptor = {
  readonly content: ReactNode
  readonly id: string
  readonly title: string
}

type DesktopSecondaryDialogContextValue = {
  readonly openSecondaryDialog: (descriptor: DesktopSecondaryDialogDescriptor) => void
}

const DesktopSecondaryDialogContext =
  createContext<DesktopSecondaryDialogContextValue | null>(null)

export function useDesktopSecondaryDialog() {
  return useContext(DesktopSecondaryDialogContext)
}

export function DesktopShell({
  layout,
  destinations,
  title,
  headerDate,
  headerTimezone,
  viewer,
  children
}: {
  readonly layout: 'home' | 'modal'
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly title: string
  readonly description: string
  readonly headerDate?: string | undefined
  readonly headerTimezone?: string | undefined
  readonly viewer?: MerchantViewer | undefined
  readonly children: ReactNode
}) {
  if (layout === 'home')
    return (
      <DesktopStage>
        <DesktopHomeCard
          destinations={destinations}
          headerDate={headerDate}
          headerTimezone={headerTimezone}
          viewer={viewer}
        >
          {children}
        </DesktopHomeCard>
      </DesktopStage>
    )

  return <DesktopRouteModal title={title}>{children}</DesktopRouteModal>
}

function DesktopRouteModal({
  title,
  children
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const secondaryDialogRef = useRef<HTMLDialogElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const secondaryFrameRef = useRef<number | null>(null)
  const secondaryTimerRef = useRef<number | null>(null)
  const secondaryOriginRef = useRef<HTMLElement | null>(null)
  const hasNavigatedRef = useRef(false)
  const [modalState, setModalState] = useState<'entering' | 'open' | 'closing'>(
    'entering'
  )
  const [secondaryDialog, setSecondaryDialog] =
    useState<DesktopSecondaryDialogDescriptor | null>(null)
  const [secondaryState, setSecondaryState] = useState<
    'preparing' | 'entering' | 'open' | 'closing'
  >('open')
  const location = useLocation()
  const previousPathnameRef = useRef(location.pathname)
  const router = useRouter()
  const appointmentDate = appointmentDateFromSearch(location.search)

  const clearSecondaryLifecycle = useCallback(() => {
    if (secondaryFrameRef.current) {
      window.cancelAnimationFrame(secondaryFrameRef.current)
      secondaryFrameRef.current = null
    }
    if (secondaryTimerRef.current) {
      window.clearTimeout(secondaryTimerRef.current)
      secondaryTimerRef.current = null
    }
  }, [])

  const finishSecondaryAnimation = useCallback(
    (state: 'preparing' | 'entering' | 'open' | 'closing') => {
      if (state === 'entering') {
        clearSecondaryLifecycle()
        setSecondaryState('open')
        return
      }
      if (state !== 'closing') return
      clearSecondaryLifecycle()
      setSecondaryDialog(null)
      setSecondaryState('open')
    },
    [clearSecondaryLifecycle]
  )

  const openSecondaryDialog = useCallback(
    (descriptor: DesktopSecondaryDialogDescriptor) => {
      secondaryOriginRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null

      if (secondaryDialog && secondaryState !== 'closing') {
        setSecondaryDialog(descriptor)
        return
      }

      clearSecondaryLifecycle()
      setSecondaryState('preparing')
      setSecondaryDialog(descriptor)
    },
    [clearSecondaryLifecycle, secondaryDialog, secondaryState]
  )

  const closeSecondaryDialog = useCallback(() => {
    if (!secondaryDialog || secondaryState === 'closing') return
    clearSecondaryLifecycle()
    setSecondaryState('closing')
  }, [clearSecondaryLifecycle, secondaryDialog, secondaryState])

  const secondaryDialogContextValue = useMemo(
    () => ({ openSecondaryDialog }),
    [openSecondaryDialog]
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      clearSecondaryLifecycle()
    }
  }, [clearSecondaryLifecycle])

  useLayoutEffect(() => {
    if (previousPathnameRef.current === location.pathname) return
    previousPathnameRef.current = location.pathname
    clearSecondaryLifecycle()
    secondaryOriginRef.current = null
    setSecondaryDialog(null)
    setSecondaryState('open')
    dialogRef.current?.focus({ preventScroll: true })
  }, [clearSecondaryLifecycle, location.pathname])

  useEffect(() => {
    if (!secondaryDialog || secondaryState !== 'preparing') return
    secondaryFrameRef.current = window.requestAnimationFrame(() => {
      secondaryFrameRef.current = null
      setSecondaryState('entering')
    })
    return () => {
      if (!secondaryFrameRef.current) return
      window.cancelAnimationFrame(secondaryFrameRef.current)
      secondaryFrameRef.current = null
    }
  }, [secondaryDialog, secondaryState])

  useEffect(() => {
    if (secondaryState !== 'entering' && secondaryState !== 'closing') return
    secondaryTimerRef.current = window.setTimeout(
      () => finishSecondaryAnimation(secondaryState),
      secondaryState === 'closing' ? 180 : 500
    )
    return () => {
      if (!secondaryTimerRef.current) return
      window.clearTimeout(secondaryTimerRef.current)
      secondaryTimerRef.current = null
    }
  }, [finishSecondaryAnimation, secondaryState])

  useLayoutEffect(() => {
    if (secondaryDialog && secondaryState === 'open') {
      secondaryDialogRef.current?.focus({ preventScroll: true })
      return
    }
    if (secondaryDialog) return
    const origin = secondaryOriginRef.current
    secondaryOriginRef.current = null
    if (origin?.isConnected) origin.focus({ preventScroll: true })
  }, [secondaryDialog, secondaryState])

  const navigateHome = useCallback(() => {
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
  }, [appointmentDate, location.state, router])

  const closeModal = useCallback(() => {
    if (modalState === 'closing') return
    setModalState('closing')
    closeTimerRef.current = setTimeout(navigateHome, 200)
  }, [modalState, navigateHome])

  const dismissTopDialog = useEffectEvent(() => {
    if (secondaryDialog) {
      closeSecondaryDialog()
      return
    }
    closeModal()
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleBackdropClick = (event: globalThis.MouseEvent) => {
      if (event.target !== dialog) return
      const { bottom, left, right, top } = dialog.getBoundingClientRect()
      const clickedOutsideDialog =
        event.clientX < left ||
        event.clientX > right ||
        event.clientY < top ||
        event.clientY > bottom
      if (!clickedOutsideDialog) return
      dismissTopDialog()
    }
    dialog.addEventListener('click', handleBackdropClick)
    return () => dialog.removeEventListener('click', handleBackdropClick)
  }, [])

  const shouldAnimatePrimaryRoute =
    modalState === 'open' && previousPathnameRef.current !== location.pathname

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
    <DesktopSecondaryDialogContext.Provider value={secondaryDialogContextValue}>
      <dialog
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="merchant-desktop-modal-title"
        data-desktop-modal-state={modalState}
        data-desktop-secondary-open={
          secondaryDialog && secondaryState !== 'closing' ? 'true' : undefined
        }
        className="merchant-desktop-modal"
        onAnimationEnd={handleAnimationEnd}
        onCancel={(event) => {
          event.preventDefault()
          closeModal()
        }}
      >
        <header className="mt-4 mb-1 grid h-12 shrink-0 grid-cols-[2.5rem_1fr_2.5rem] items-center px-6">
          <span aria-hidden />
          <h1
            id="merchant-desktop-modal-title"
            className="truncate text-center text-sm leading-5 font-medium"
          >
            {title}
          </h1>
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="grid size-8 place-items-center justify-self-end rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={closeModal}
          >
            <X aria-hidden className="size-5" strokeWidth={1.6} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 pt-2 pb-8">
          <div
            key={location.pathname}
            data-desktop-primary-route-motion={
              shouldAnimatePrimaryRoute ? 'true' : undefined
            }
          >
            {children}
          </div>
        </div>

        {secondaryDialog ? (
          <dialog
            ref={secondaryDialogRef}
            open
            aria-labelledby="merchant-desktop-secondary-title"
            tabIndex={-1}
            data-desktop-secondary-dialog={secondaryDialog.id}
            data-desktop-secondary-state={secondaryState}
            inert={secondaryState === 'open' ? undefined : true}
            className="merchant-desktop-sidecar"
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              finishSecondaryAnimation(secondaryState)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              closeSecondaryDialog()
            }}
          >
            <header className="mt-4 mb-1 grid h-12 shrink-0 grid-cols-[2.5rem_1fr_2.5rem] items-center px-6">
              <button
                type="button"
                aria-label="Back to Settings"
                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-transform active:scale-[0.98]"
                onClick={closeSecondaryDialog}
              >
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.8} />
              </button>
              <h2
                id="merchant-desktop-secondary-title"
                className="truncate text-center text-sm leading-5 font-medium"
              >
                {secondaryDialog.title}
              </h2>
              <span aria-hidden />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 pt-4 pb-8">
              <div key={secondaryDialog.id}>{secondaryDialog.content}</div>
            </div>
          </dialog>
        ) : null}
      </dialog>
    </DesktopSecondaryDialogContext.Provider>
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
  viewer,
  interactive = true,
  children
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly headerDate?: string | undefined
  readonly headerTimezone?: string | undefined
  readonly viewer?: MerchantViewer | undefined
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
        <MerchantLogo appointmentDate={appointmentDate} />
        <div className="min-w-0 justify-self-stretch px-2">
          {appointmentDate ? (
            <DesktopDateHeader date={appointmentDate} currentDate={currentDate} />
          ) : null}
        </div>
        <DesktopUserButton
          appointmentDate={appointmentDate}
          interactive={interactive}
          viewer={viewer}
        />
      </header>
      <div
        data-desktop-home-content="true"
        className="relative z-10 min-h-0 flex-1 overflow-hidden px-5 pb-4"
      >
        {children}
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

function MerchantLogo({
  appointmentDate
}: {
  readonly appointmentDate: string | undefined
}) {
  return (
    <Link
      to="/about"
      search={appointmentDate ? { date: appointmentDate } : {}}
      state={(previous) => merchantOverlayNavigationState(previous, appointmentDate)}
      viewTransition={false}
      aria-label="About BeeSolo"
      className="merchant-logo-enter grid size-11 place-items-center rounded-xl text-muted-foreground transition-transform active:scale-[0.98]"
    >
      <BeeSoloMark className="size-6" />
    </Link>
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
