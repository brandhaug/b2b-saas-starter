import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { type DemoShowcase } from '@/lib/server/demo-showcase'

/**
 * The landing page's live-numbers band, read actorless by the route's loader
 * from the same capability services the REST endpoint serves. The selection
 * argues for the starter, not against it: the live member and notification
 * counts beside the vocabulary the product enforces (every workspace role
 * RBAC gates on, every audit event type the write boundary records) — the
 * numbers that prove breadth. Hidden entirely when the showcase workspace is
 * missing — the strip never renders zeros it did not read.
 */
export function DemoStrip({ demo }: { readonly demo: DemoShowcase }) {
  const stats: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: 'Members', value: String(demo.memberCount) },
    { label: 'Workspace roles', value: String(demo.roleCount) },
    { label: 'Audit event types', value: String(demo.auditEventTypeCount) },
    { label: 'Notifications', value: String(demo.notificationCount) }
  ]
  return (
    <section className="border-b border-border bg-muted/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-10 gap-y-4 px-4 py-5 sm:px-6">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          {stats.map((stat) => (
            <div key={stat.label} className="grid gap-0.5">
              <dt className="text-2xs text-muted-foreground">{stat.label}</dt>
              <dd className="font-mono text-sm font-medium tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <Link
          to="/demo"
          className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:no-underline"
        >
          Open the live demo
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      </div>
    </section>
  )
}
