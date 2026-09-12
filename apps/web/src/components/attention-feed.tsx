import { WorkspaceLink } from '@/components/workspace-link'
import { ArrowRightIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/page/panel'
import { type AttentionItem } from '@/lib/attention'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The dashboard's attention feed panel: the ordered items the loader's
 * derivation produced, each with a severity badge from the status hues and a
 * link to the page that resolves it.
 */
function severityLabel(severity: AttentionItem['severity']): string {
  return severity === 'warn' ? m.attention_warning() : m.attention_information()
}

export function AttentionFeed({
  workspaceSlug,
  items
}: {
  readonly workspaceSlug: string
  readonly items: ReadonlyArray<AttentionItem>
}) {
  if (items.length === 0) {
    return (
      <Panel title={m.workspace_healthy_title()}>
        <p className="text-sm text-muted-foreground">
          {m.workspace_healthy_description()}
        </p>
      </Panel>
    )
  }
  return (
    <Panel title={m.needs_attention()} className="min-w-0">
      <ol className="grid divide-y divide-border">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
          >
            <div className="grid min-w-0 flex-1 gap-0.5 max-md:basis-full">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                {/* One status hue per state: warn needs attention, info is
                    informational. Never the mauve `default` — that means
                    current/selected. */}
                <Badge variant={item.severity}>{severityLabel(item.severity)}</Badge>
                <span className="min-w-0 flex-1 truncate" title={item.title}>
                  {item.title}
                </span>
              </p>
              <p className="min-w-0 text-sm text-muted-foreground">
                {item.description}
              </p>
            </div>
            <WorkspaceLink
              to={item.to}
              workspaceSlug={workspaceSlug}
              search={item.search}
              className="flex shrink-0 items-center gap-1 text-sm underline underline-offset-2 max-md:min-h-11 max-md:w-full max-md:justify-end"
            >
              {item.linkLabel}
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </WorkspaceLink>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
