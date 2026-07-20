import type { ReactNode } from 'react'
import { DesktopShell } from './desktop/desktop-shell.tsx'
import { MerchantPresentationBoundary } from './merchant-presentation.tsx'
import { merchantDestinations, type MerchantShellSection } from './navigation.tsx'
import { MobileShell } from './mobile/mobile-shell.tsx'

export function MerchantShell({
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
  const destinations = merchantDestinations()
  const shared = { section, destinations, title, description, children }

  return (
    <MerchantPresentationBoundary
      desktop={<DesktopShell {...shared} />}
      mobile={<MobileShell {...shared} />}
    />
  )
}
