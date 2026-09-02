import { type RefObject } from 'react'

import { useHeadingObserver } from '@/hooks/use-heading-observer'
import { cn } from '@/lib/utils'

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
    <nav aria-label="Table of contents" className="sticky top-18">
      <p className="mb-3 text-xs font-medium text-foreground">On this page</p>
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
                  document.getElementById(heading.id)?.scrollIntoView({
                    behavior: reducedMotion ? 'instant' : 'smooth'
                  })
                  history.replaceState(null, '', `#${heading.id}`)
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
