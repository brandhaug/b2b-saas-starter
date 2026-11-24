import { useContext } from 'react'
import { Panel } from '@/components/page/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { PublicLayoutContext } from '@/components/public-layout-context'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The router's `defaultPendingComponent`: a coarse skeleton of the shape every
 * page shares (heading block, then one panel), not of any particular page.
 * Page components render their own shell, so a pending leaf replaces it; the
 * skeleton keeps the shell's content column. Inside a public layout it joins
 * the surrounding column instead, like `FallbackPage`.
 */
export function RoutePending() {
  const withinPublicLayout = useContext(PublicLayoutContext)
  const skeleton = (
    <output className="grid w-full gap-6" aria-live="polite">
      <span className="sr-only">{m.common_loading()}</span>
      <div className="grid gap-2">
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Panel>
        <Skeleton className="h-40 w-full" />
      </Panel>
    </output>
  )
  if (withinPublicLayout) {
    return skeleton
  }
  return <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">{skeleton}</div>
}
