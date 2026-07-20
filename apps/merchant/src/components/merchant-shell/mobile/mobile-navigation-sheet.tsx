import { Link } from '@tanstack/react-router'
import type { MerchantDestination } from '../navigation.tsx'

export function MobileNavigationSheet({
  destinations
}: {
  readonly destinations: readonly MerchantDestination[]
}) {
  return (
    <nav
      aria-label="Merchant navigation"
      className="absolute right-0 bottom-[calc(100%+1rem)] grid min-w-56 overflow-hidden rounded-3xl border bg-card p-2 shadow-2xl"
    >
      {destinations.map((destination) => (
        <Link
          key={destination.to}
          to={destination.to}
          className="rounded-2xl px-4 py-3 text-sm font-bold text-foreground hover:bg-muted"
          activeProps={{ className: 'bg-muted text-primary' }}
        >
          {destination.label}
        </Link>
      ))}
    </nav>
  )
}
