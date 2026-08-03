import type { ReactNode } from 'react'
import type { MerchantViewer } from '@/lib/merchant-viewer.ts'
import { DesktopShell } from './desktop/desktop-shell.tsx'
import { MerchantPresentationBoundary } from './merchant-presentation.tsx'
import { merchantDestinations, type MerchantShellSection } from './navigation.tsx'
import { MobileShell } from './mobile/mobile-shell.tsx'
import {
  useDesktopDialogRouteRegistration,
  useMobileSheetRouteRegistration
} from './mobile/mobile-sheet-stack.tsx'

export function MerchantShell({
  section,
  title,
  description,
  headerDate,
  headerTimezone,
  viewer,
  layout = 'sheet',
  children
}: {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly headerDate?: string | undefined
  readonly headerTimezone?: string | undefined
  readonly viewer?: MerchantViewer | undefined
  readonly layout?: 'home' | 'sheet' | 'task'
  readonly children: ReactNode
}) {
  const destinations = merchantDestinations()
  const managedMobileSheet = useMobileSheetRouteRegistration(
    layout === 'home'
      ? null
      : {
          section,
          title,
          description,
          layout: layout === 'task' ? 'task' : 'sheet'
        }
  )
  const managedDesktopDialog = useDesktopDialogRouteRegistration(
    layout === 'home'
      ? null
      : {
          section,
          title,
          description,
          layout: layout === 'task' ? 'task' : 'sheet'
        }
  )

  return (
    <MerchantPresentationBoundary
      desktop={
        layout !== 'home' && managedDesktopDialog ? (
          <>{children}</>
        ) : (
          <DesktopShell
            layout={layout === 'home' ? 'home' : 'modal'}
            section={section}
            destinations={destinations}
            title={title}
            description={description}
            headerDate={headerDate}
            headerTimezone={headerTimezone}
            viewer={viewer}
          >
            {children}
          </DesktopShell>
        )
      }
      mobile={
        layout === 'home' ? (
          <MobileShell
            layout="home"
            section={section}
            destinations={destinations}
            date={headerDate!}
            timezone={headerTimezone!}
          >
            {children}
          </MobileShell>
        ) : managedMobileSheet ? (
          <>{children}</>
        ) : (
          <MobileShell
            layout={layout}
            section={section}
            destinations={destinations}
            title={title}
            description={description}
          >
            {children}
          </MobileShell>
        )
      }
    />
  )
}
