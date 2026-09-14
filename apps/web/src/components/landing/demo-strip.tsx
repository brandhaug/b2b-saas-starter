import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { type DemoShowcase } from '@/lib/server/demo-showcase'
import { m } from '@b2b-saas-starter/i18n/messages'

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
    { label: m.public_demo_members(), value: String(demo.memberCount) },
    { label: m.public_demo_roles(), value: String(demo.roleCount) },
    { label: m.public_demo_audit_events(), value: String(demo.auditEventTypeCount) },
    { label: m.public_demo_notifications(), value: String(demo.notificationCount) }
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
          className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:no-underline max-md:min-h-11"
        >
          {m.public_demo_open()}
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      </div>
      <figure className="mx-auto max-w-7xl px-4 pb-8 sm:px-6">
        <Link
          to="/demo"
          className="group block overflow-hidden border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          {/* oxlint-disable-next-line react-doctor/no-image-hover-transform -- The approved public design calls for restrained image hover scaling. */}
          <img
            src="/images/workspace-preview.png"
            alt={m.showcase_workspace_preview_alt()}
            width={1440}
            height={1000}
            loading="lazy"
            decoding="async"
            className="w-full transition-transform duration-700 ease-out group-hover:scale-[1.025] group-focus-visible:scale-[1.025] motion-reduce:transition-none"
          />
        </Link>
        <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{m.showcase_workspace_preview_caption()}</span>
          <Link
            to="/demo"
            className="inline-flex min-h-11 items-center gap-2 text-foreground underline underline-offset-4"
          >
            {m.public_demo_open()}
            <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
        </figcaption>
      </figure>
    </section>
  )
}
