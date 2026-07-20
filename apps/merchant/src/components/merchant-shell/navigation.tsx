import { Link } from '@tanstack/react-router'
import { catalogDestinations } from '@/lib/catalog-workflow.ts'

export type MerchantShellSection =
  | { readonly kind: 'operations' }
  | { readonly kind: 'catalog'; readonly presentation: 'solo' | 'team' }

export type MerchantDestination = {
  readonly label: string
  readonly to:
    | '/appointments'
    | '/customers'
    | '/services'
    | '/providers'
    | '/availability'
}

const operationsDestinations: readonly MerchantDestination[] = [
  { label: 'Appointments', to: '/appointments' },
  { label: 'Customers', to: '/customers' },
  { label: 'Services', to: '/services' },
  { label: 'Providers', to: '/providers' },
  { label: 'Availability', to: '/availability' }
]

export function merchantDestinations(
  section: MerchantShellSection
): readonly MerchantDestination[] {
  return section.kind === 'operations'
    ? operationsDestinations
    : catalogDestinations(section.presentation)
}

export function MerchantNavigation({
  destinations,
  presentation
}: {
  readonly destinations: readonly MerchantDestination[]
  readonly presentation: 'desktop' | 'mobile'
}) {
  return destinations.map((destination) => (
    <Link
      key={destination.to}
      to={destination.to}
      activeProps={{
        className:
          presentation === 'desktop'
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'bg-accent text-accent-foreground'
      }}
      inactiveProps={{
        className:
          presentation === 'desktop'
            ? 'text-sidebar-foreground hover:bg-sidebar-accent'
            : 'text-muted-foreground'
      }}
      className={
        presentation === 'desktop'
          ? 'rounded-md px-3 py-2 text-sm font-medium'
          : 'grid min-h-12 min-w-0 place-items-center rounded-md px-2 text-center text-xs font-medium'
      }
    >
      {destination.label}
    </Link>
  ))
}
