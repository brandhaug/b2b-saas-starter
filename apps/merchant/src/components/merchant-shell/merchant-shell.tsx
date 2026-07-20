import type { ReactNode } from 'react'
import { DesktopShell } from './desktop/desktop-shell.tsx'
import { MerchantPresentationBoundary } from './merchant-presentation.tsx'
import { merchantDestinations, type MerchantShellSection } from './navigation.tsx'
import { MobileShell } from './mobile/mobile-shell.tsx'

export function MerchantShell({
  section,
  title,
  description,
  layout = 'sheet',
  children
}: {
  readonly section: MerchantShellSection
  readonly title: string
  readonly description: string
  readonly layout?: 'home' | 'sheet' | 'task'
  readonly children: ReactNode
}) {
  const destinations = merchantDestinations()

  return (
    <MerchantPresentationBoundary
      desktop={
        <DesktopShell
          layout={layout === 'home' ? 'home' : 'modal'}
          section={section}
          destinations={destinations}
          title={title}
          description={description}
        >
          {children}
        </DesktopShell>
      }
      mobile={
        layout === 'home' ? (
          <MobileShell layout="home" section={section} destinations={destinations}>
            {children}
          </MobileShell>
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
