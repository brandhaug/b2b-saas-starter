import { useOverflowFade } from '@/hooks/use-overflow-fade'
import { cn } from '@/lib/utils'

function SnippetPanel({
  label,
  code,
  path
}: {
  readonly label: string
  readonly code: string
  /** The real file the snippet is excerpted from, printed in the caption. */
  readonly path?: string | undefined
}) {
  const { ref, fadeRight } = useOverflowFade<HTMLPreElement>()

  return (
    <figure className="min-w-0 border border-border bg-card">
      <figcaption className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-2 font-mono text-xs text-muted-foreground">
        <span className="shrink-0">{label}</span>
        {path === undefined ? null : (
          <span className="truncate text-2xs" title={path}>
            {path}
          </span>
        )}
      </figcaption>
      {/* The cap keeps a long body from setting the section's height; after
          the caller's truncation the code fits inside it, and the scroll is
          the safety net, not the reading experience. The right-edge mask is
          on only while code hides past the edge, so the scroll is visible
          before it is found. */}
      <pre
        ref={ref}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <pre> is the semantic element for preformatted code; role="region" exposes the scrollable area without losing it.
        role="region"
        aria-label={`${label}, scrollable code`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a focus stop to pan the overflowing code.
        tabIndex={0}
        className={cn(
          'max-h-108 overflow-auto p-4 font-mono text-xs leading-normal text-foreground/90',
          fadeRight &&
            '[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent_100%)]'
        )}
      >
        <code>{code}</code>
      </pre>
    </figure>
  )
}

export { SnippetPanel }
