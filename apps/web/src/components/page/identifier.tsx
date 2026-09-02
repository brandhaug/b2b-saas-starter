import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The one identifier rendering: mono, tabular, and break-all-safe, so a long
 * token, URL, slug, or id wraps inside a narrow column instead of forcing the
 * row off-screen. Replaces the per-site `break-all` code/span hacks.
 */
export function Identifier({
  children,
  className
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <code
      className={cn(
        'min-w-0 max-w-full rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs break-all',
        className
      )}
    >
      {children}
    </code>
  )
}
