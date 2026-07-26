import type { ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { DesktopShell } from '@/components/merchant-shell/desktop/desktop-shell.tsx'
import { merchantDestinations } from '@/components/merchant-shell/navigation.tsx'
import { MobileNavigationMenu } from '@/components/merchant-shell/mobile/mobile-navigation-menu.tsx'
import { MobileShell } from '@/components/merchant-shell/mobile/mobile-shell.tsx'
import {
  useMobileSheetStack,
  type MobileSheetDescriptor
} from '@/components/merchant-shell/mobile/mobile-sheet-stack.tsx'
import { useMerchantPresentation } from '@/components/merchant-shell/merchant-presentation.tsx'
import type { MerchantViewer } from '@/lib/merchant-viewer.ts'

function fallbackMobileSheetDescriptor(pathname: string): MobileSheetDescriptor {
  if (/^\/appointments\/[^/]+$/.test(pathname)) {
    return {
      section: { kind: 'merchant' },
      title: 'Appointment detail',
      description: 'Appointment details',
      layout: 'task'
    }
  }
  const title =
    pathname === '/about'
      ? 'About'
      : pathname === '/walk-ins'
        ? 'Walk-in queue'
        : pathname === '/customers'
          ? 'Customers'
          : pathname === '/services'
            ? 'Services'
            : pathname === '/providers'
              ? 'Providers'
              : pathname === '/availability'
                ? 'Availability'
                : 'Settings'
  return {
    section:
      pathname === '/services' ||
      pathname === '/providers' ||
      pathname === '/availability'
        ? { kind: 'catalog', presentation: 'team' }
        : { kind: 'merchant' },
    title,
    description: '',
    layout: 'sheet'
  }
}

export function MerchantMobileSheetOutlet({
  pathname,
  appointmentDate,
  overlayOpen,
  viewer,
  children
}: {
  readonly pathname: string
  readonly appointmentDate: string | undefined
  readonly overlayOpen: boolean
  readonly viewer?: MerchantViewer | undefined
  readonly children: ReactNode
}) {
  const presentation = useMerchantPresentation()
  const router = useRouter()
  const stack = useMobileSheetStack()

  if (presentation === 'desktop') {
    if (!overlayOpen) return <>{children}</>
    const fallback = fallbackMobileSheetDescriptor(pathname)
    const descriptor =
      stack?.descriptor?.title === fallback.title ? stack.descriptor : fallback

    return (
      <DesktopShell
        layout="modal"
        section={descriptor.section}
        destinations={merchantDestinations()}
        title={descriptor.title}
        description={descriptor.description}
        viewer={viewer}
      >
        {children}
      </DesktopShell>
    )
  }

  if (!stack) return <>{children}</>

  const active = stack.menuOpen || overlayOpen
  const descriptor = overlayOpen
    ? (stack.descriptor ?? fallbackMobileSheetDescriptor(pathname))
    : {
        section: { kind: 'merchant' } as const,
        title: 'Settings',
        description: 'Choose an area to manage.',
        layout: 'sheet' as const
      }
  const destinations = merchantDestinations().filter(
    (destination) => destination.to !== '/appointments'
  )
  const dismissNestedSheet = () => {
    stack.closeMenu()
    void router.navigate({
      to: '/appointments',
      search: { date: appointmentDate },
      replace: true,
      viewTransition: false
    })
  }

  return (
    <>
      {overlayOpen ? null : children}
      {active ? (
        <MobileShell
          layout={descriptor.layout}
          section={descriptor.section}
          destinations={merchantDestinations()}
          title={descriptor.title}
          description={descriptor.description}
          onRequestBack={
            overlayOpen && stack.menuOpen ? () => router.history.back() : undefined
          }
          onRequestClose={
            overlayOpen && stack.menuOpen
              ? dismissNestedSheet
              : overlayOpen
                ? undefined
                : stack.closeMenu
          }
        >
          {overlayOpen ? (
            children
          ) : (
            <MobileNavigationMenu
              destinations={destinations}
              appointmentDate={appointmentDate}
            />
          )}
        </MobileShell>
      ) : null}
    </>
  )
}
