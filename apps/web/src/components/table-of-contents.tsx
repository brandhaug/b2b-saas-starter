import { type RefObject } from 'react'

import { useHeadingObserver } from '@/hooks/use-heading-observer'
import { cn } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'

export function TableOfContents({
  containerRef
}: {
  readonly containerRef: RefObject<HTMLElement | null>
}) {
  const { headings, activeIds } = useHeadingObserver({ containerRef })

  if (headings.length === 0) {
    return null
  }

  return (
    <nav aria-label={m.public_knowledge_on_page()} className="sticky top-18">
      <p className="mb-3 text-xs font-medium text-foreground">
        {m.public_knowledge_on_page()}
      </p>
      <ul className="flex flex-col gap-1">
        {headings.map((heading) => {
          const isActive = activeIds.has(heading.id)
          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  const reducedMotion = window.matchMedia(
                    '(prefers-reduced-motion: reduce)'
                  ).matches
                  const target = document.getElementById(heading.id)
                  target?.scrollIntoView({
                    behavior: reducedMotion ? 'instant' : 'smooth'
                  })
                  history.replaceState(null, '', `#${heading.id}`)
                  // Preventing the default navigation also keeps the sequential
                  // focus start point on the link, so Tab would walk the nav
                  // again instead of the section just jumped to. Focusing the
                  // heading moves it; `preventScroll` leaves the smooth scroll
                  // above in charge of the viewport.
                  if (target !== null) {
                    target.tabIndex = -1
                    target.focus({ preventScroll: true })
                  }
                }}
                aria-current={isActive ? 'location' : undefined}
                className={cn(
                  'block border-l-2 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  heading.level === 3 ? 'pl-5' : 'pl-3',
                  isActive
                    ? 'border-foreground font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {heading.text}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
