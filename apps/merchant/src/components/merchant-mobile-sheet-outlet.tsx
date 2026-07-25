import type { ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { merchantDestinations } from '@/components/merchant-shell/navigation.tsx'
import { MobileNavigationMenu } from '@/components/merchant-shell/mobile/mobile-navigation-menu.tsx'
import { MobileShell } from '@/components/merchant-shell/mobile/mobile-shell.tsx'
import {
  useMobileSheetStack,
  type MobileSheetDescriptor
} from '@/components/merchant-shell/mobile/mobile-sheet-stack.tsx'
import { useMerchantPresentation } from '@/components/merchant-shell/merchant-presentation.tsx'

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
    pathname === '/walk-ins'
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
  children
}: {
  readonly pathname: string
  readonly appointmentDate: string | undefined
  readonly overlayOpen: boolean
  readonly children: ReactNode
}) {
  const presentation = useMerchantPresentation()
  const router = useRouter()
  const stack = useMobileSheetStack()
  if (presentation !== 'mobile' || !stack) return <>{children}</>

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
