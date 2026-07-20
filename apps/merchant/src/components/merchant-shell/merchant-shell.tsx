import type { ReactNode } from 'react'
import { DesktopShell } from './desktop/desktop-shell.tsx'
import { MerchantPresentationBoundary } from './merchant-presentation.tsx'
import { merchantDestinations, type MerchantShellSection } from './navigation.tsx'
import { MobileShell } from './mobile/mobile-shell.tsx'

export function MerchantShell({
  section,
  title,
  description,
  mobileHeading = 'shell',
  children
}: {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly mobileHeading?: 'shell' | 'screen'
  readonly children: ReactNode
}) {
  const destinations = merchantDestinations()

  return (
    <MerchantPresentationBoundary
      desktop={
        <DesktopShell
          section={section}
          destinations={destinations}
          title={title}
          description={description}
        >
          {children}
        </DesktopShell>
      }
      mobile={
        <MobileShell
          section={section}
          destinations={destinations}
          title={title}
          description={description}
          heading={mobileHeading}
        >
          {children}
        </MobileShell>
      }
    />
  )
}
