import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/page/panel'
import { type AttentionItem } from '@/lib/attention'

/**
 * The dashboard's attention feed panel: the ordered items the loader's
 * derivation produced, each with a severity badge from the status hues and a
 * link to the page that resolves it.
 */
export function AttentionFeed({
  workspaceSlug,
  items
}: {
  readonly workspaceSlug: string
  readonly items: ReadonlyArray<AttentionItem>
}) {
  if (items.length === 0) {
    return null
  }
  return (
    <Panel title="Needs attention">
      <ol className="grid gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm border border-border bg-muted/40 px-3 py-2"
          >
            <div className="grid min-w-0 gap-0.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                {/* One status hue per state: warn needs attention, info is
                    informational. Never the mauve `default` — that means
                    current/selected. */}
                <Badge variant={item.severity}>{item.severity}</Badge>
                <span className="min-w-0 truncate" title={item.title}>
                  {item.title}
                </span>
              </p>
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {item.description}
              </p>
            </div>
            <Link
              to={item.to}
              params={{ workspaceSlug }}
              className="flex shrink-0 items-center gap-1 text-sm underline underline-offset-2"
            >
              {item.linkLabel}
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
