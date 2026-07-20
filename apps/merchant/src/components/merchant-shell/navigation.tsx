import { Link } from '@tanstack/react-router'
import type { MerchantPresentation } from '@/lib/merchant-presentation.ts'

export type MerchantShellSection =
  | { readonly kind: 'merchant' }
  | { readonly kind: 'catalog'; readonly presentation: 'solo' | 'team' }

export type MerchantDestination = {
  readonly label: string
  readonly to:
    | '/appointments'
    | '/walk-ins'
    | '/customers'
    | '/services'
    | '/providers'
    | '/availability'
    | '/settings'
}

const merchantSectionDestinations: readonly MerchantDestination[] = [
  { label: 'Appointments', to: '/appointments' },
  { label: 'Walk-ins', to: '/walk-ins' },
  { label: 'Customers', to: '/customers' },
  { label: 'Services', to: '/services' },
  { label: 'Providers', to: '/providers' },
  { label: 'Availability', to: '/availability' },
  { label: 'Settings', to: '/settings' }
]

export function merchantDestinations(): readonly MerchantDestination[] {
  return merchantSectionDestinations
}

export function MerchantNavigation({
  destinations,
  presentation
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly presentation: MerchantPresentation
}) {
  const styles = navigationStyles[presentation]
  return destinations.map((destination) => (
    <Link
      key={destination.to}
      to={destination.to}
      activeProps={{
        className: styles.active
      }}
      inactiveProps={{
        className: styles.inactive
      }}
      className={styles.base}
    >
      {destination.label}
    </Link>
  ))
}

const navigationStyles: Record<
  MerchantPresentation,
  { readonly active: string; readonly inactive: string; readonly base: string }
> = {
  desktop: {
    active: 'bg-sidebar-accent text-sidebar-accent-foreground',
    inactive: 'text-sidebar-foreground hover:bg-sidebar-accent',
    base: 'rounded-md px-3 py-2 text-sm font-medium'
  },
  mobile: {
    active: 'bg-accent text-accent-foreground',
    inactive: 'text-muted-foreground',
    base: 'grid min-h-12 min-w-0 place-items-center rounded-md px-2 text-center text-xs font-medium'
  }
}
