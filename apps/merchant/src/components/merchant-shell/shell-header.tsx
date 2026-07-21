import { Link } from '@tanstack/react-router'
import { BeeSoloLogo } from '@/components/beesolo-logo.tsx'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'
import type { MerchantShellSection } from './navigation.tsx'

export function MerchantShellHeader({
  section,
  presentation
}: {
  readonly section: MerchantShellSection
  readonly presentation: MerchantPresentation
}) {
  return (
    <header className="border-b bg-card">
      <div
        className={
          presentation === 'desktop'
            ? 'mx-auto flex max-w-7xl items-center justify-between px-6 py-4'
            : 'flex items-center justify-between gap-3 px-4 py-3'
        }
      >
        {section.kind === 'merchant' ? (
          <Link
            to="/appointments"
            search={{ date: undefined }}
            className="rounded-md focus-visible:outline-none"
          >
            <BeeSoloLogo />
          </Link>
        ) : (
          <Link to="/" className="rounded-md focus-visible:outline-none">
            <BeeSoloLogo />
          </Link>
        )}
        {section.kind === 'catalog' ? (
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium capitalize text-secondary-foreground">
            {section.presentation}
          </span>
        ) : null}
      </div>
    </header>
  )
}
