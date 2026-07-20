import type { ReactNode } from 'react'
import { DesktopShell } from './desktop/desktop-shell.tsx'
import { MerchantPresentationBoundary } from './merchant-presentation.tsx'
import { merchantDestinations, type MerchantShellSection } from './navigation.tsx'
import { MobileShell } from './mobile/mobile-shell.tsx'

export function MerchantShell({
  section,
  title,
  description,
  mobileLayout = 'standard',
  children
}: {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly mobileLayout?: 'standard' | 'immersive'
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
        mobileLayout === 'immersive' ? (
          <MobileShell layout="immersive" section={section} destinations={destinations}>
            {children}
          </MobileShell>
        ) : (
          <MobileShell
            layout="standard"
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
