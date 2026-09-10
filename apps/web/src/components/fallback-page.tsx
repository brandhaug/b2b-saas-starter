import { type ReactNode, useContext } from 'react'
import { PublicLayout } from '@/components/public-layout'
import { PublicLayoutContext } from './public-layout-context'

/**
 * Router fallbacks provide a public shell when no parent page survives.
 * Nested failures reuse the parent's header, footer, main and skip link.
 *
 * `tabIndex={-1}` makes the `<main>` a programmatic focus target so the skip
 * link moves focus and not just the scroll position; the outline is suppressed
 * because the element is a destination, never an operable control.
 */
export function FallbackPage({ children }: { readonly children: ReactNode }) {
  const withinPublicLayout = useContext(PublicLayoutContext)
  if (withinPublicLayout) {
    return <div className="flex flex-col items-start gap-4 py-16">{children}</div>
  }
  return (
    <PublicLayout>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-4 px-4 py-16 outline-none sm:px-6"
      >
        {children}
      </main>
    </PublicLayout>
  )
}
