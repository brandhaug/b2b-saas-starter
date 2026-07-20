import { MerchantNavigation, type MerchantDestination } from '../navigation.tsx'

export function MobileMoreMenu({
  destinations
}: {
  readonly destinations: readonly MerchantDestination[]
}) {
  return (
    <details className="group relative min-w-0">
      <summary className="grid min-h-12 list-none place-items-center rounded-md px-2 text-center text-xs font-medium text-muted-foreground">
        More
      </summary>
      <div className="absolute right-0 bottom-[calc(100%+0.75rem)] grid min-w-44 gap-1 rounded-lg border bg-card p-2 shadow-lg">
        <MerchantNavigation destinations={destinations} presentation="mobile" />
      </div>
    </details>
  )
}
