import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The one identifier rendering: mono and tabular, wrapping anywhere only when
 * it must, so a long token, URL, slug, or id stays inside a narrow column
 * instead of forcing the row off-screen, while a domain that fits on the next
 * line moves there whole rather than splitting `co.u` / `k`.
 */
export function Identifier({
  children,
  className,
  title
}: {
  readonly children: ReactNode
  readonly className?: string
  /** The full value, for a consumer that clamps a long identifier. */
  readonly title?: string
}) {
  return (
    <code
      title={title}
      className={cn(
        'min-w-0 max-w-full rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs wrap-anywhere',
        className
      )}
    >
      {children}
    </code>
  )
}
