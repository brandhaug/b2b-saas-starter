import type { ReactNode } from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { DesktopShell } from '@/components/merchant-shell/desktop/desktop-shell.tsx'
import { merchantDestinations } from '@/components/merchant-shell/navigation.tsx'
import { MobileShell } from '@/components/merchant-shell/mobile/mobile-shell.tsx'
import {
  useMobileSheetStack,
  type MobileSheetDescriptor
} from '@/components/merchant-shell/mobile/mobile-sheet-stack.tsx'
import { useMerchantPresentation } from '@/components/merchant-shell/merchant-presentation.tsx'
import { returnsToMerchantSettings } from '@/lib/merchant-home-route.ts'
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
                : pathname === '/settings/subscription'
                  ? 'Subscription'
                  : pathname === '/settings/appearance'
                    ? 'Appearance'
                    : pathname === '/settings/advanced'
                      ? 'Advanced'
                      : 'Settings'
  return {
    section:
      pathname === '/services' ||
      pathname === '/providers' ||
      pathname === '/availability'
        ? { kind: 'catalog' }
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
  const location = useLocation()
  const router = useRouter()
  const stack = useMobileSheetStack()
  const nestedSettingsSheet = pathname.startsWith('/settings/')
  const hasSettingsParent =
    nestedSettingsSheet || returnsToMerchantSettings(location.state)

  if (presentation === 'desktop') {
    if (!overlayOpen) return <>{children}</>
    const fallback = fallbackMobileSheetDescriptor(pathname)
    const settingsFallback = fallbackMobileSheetDescriptor('/settings')
    const descriptor = nestedSettingsSheet
      ? stack?.descriptor?.title === settingsFallback.title
        ? stack.descriptor
        : settingsFallback
      : stack?.descriptor?.title === fallback.title
        ? stack.descriptor
        : fallback

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

  if (!overlayOpen) return <>{children}</>

  const descriptor = nestedSettingsSheet
    ? fallbackMobileSheetDescriptor(pathname)
    : (stack.descriptor ?? fallbackMobileSheetDescriptor(pathname))
  const navigateToSettings = () => {
    void router.navigate({
      to: '/settings',
      search: appointmentDate ? { date: appointmentDate } : {},
      replace: true,
      viewTransition: false
    })
  }
  const navigateToAppointments = () => {
    void router.navigate({
      to: '/appointments',
      search: appointmentDate ? { date: appointmentDate } : {},
      replace: true,
      viewTransition: false
    })
  }

  return (
    <MobileShell
      layout={descriptor.layout}
      section={descriptor.section}
      destinations={merchantDestinations()}
      title={descriptor.title}
      description={descriptor.description}
      onRequestBack={hasSettingsParent ? navigateToSettings : undefined}
      onRequestClose={hasSettingsParent ? navigateToSettings : navigateToAppointments}
    >
      {children}
    </MobileShell>
  )
}
