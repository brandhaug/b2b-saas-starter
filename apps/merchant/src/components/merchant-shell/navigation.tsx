export type MerchantShellSection =
  | { readonly kind: 'merchant' }
  | { readonly kind: 'catalog' }

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
  { label: 'Availability', to: '/availability' },
  { label: 'Settings', to: '/settings' }
]

export function merchantDestinations(): readonly MerchantDestination[] {
  return merchantSectionDestinations
}
