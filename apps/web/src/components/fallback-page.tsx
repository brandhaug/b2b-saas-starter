import { type ReactNode } from 'react'
import { PublicLayout } from '@/components/public-layout'

/**
 * The shell the router's own fallback screens render into — "not found", the
 * application error, and any other state reached without a matched page.
 *
 * They are ordinary pages of the site, so they keep its landmarks (banner,
 * `<main>`, contentinfo) and the skip link `PublicLayout` owns, instead of
 * dropping the reader onto a bare centered heading. `PublicLayout` reads no
 * loader data, which is what lets a failed match still use it.
 *
 * `tabIndex={-1}` makes the `<main>` a programmatic focus target so the skip
 * link moves focus and not just the scroll position; the outline is suppressed
 * because the element is a destination, never an operable control.
 */
export function FallbackPage({ children }: { readonly children: ReactNode }) {
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
