import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { type DemoShowcase } from '@/lib/server/demo-showcase'
import { m } from '@b2b-saas-starter/i18n/messages'

// Counts come from the showcase loader; the screenshot is a labeled sample.
export function DemoStrip({ demo }: { readonly demo: DemoShowcase }) {
  const stats: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: m.public_demo_members(), value: String(demo.memberCount) },
    { label: m.public_demo_roles(), value: String(demo.roleCount) },
    { label: m.public_demo_audit_events(), value: String(demo.auditEventTypeCount) },
    { label: m.public_demo_notifications(), value: String(demo.notificationCount) }
  ]
  return (
    <section
      aria-labelledby="workspace-preview-heading"
      className="mx-auto max-w-7xl px-5 py-12 sm:px-6 sm:py-20"
    >
      <div className="mb-8 grid items-end gap-5 lg:grid-cols-2 lg:gap-16">
        <h2
          id="workspace-preview-heading"
          className="font-display text-3xl font-medium leading-display sm:text-4xl"
        >
          {m.showcase_workspace_heading()}
        </h2>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
          {m.showcase_workspace_description()}
        </p>
      </div>
      <figure>
        <Link
          to="/demo"
          className="group block overflow-hidden border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          <picture>
            <source
              media="(max-width: 639px)"
              srcSet="/images/workspace-preview-mobile.webp"
            />
            <img
              src="/images/workspace-preview.webp"
              alt={m.showcase_workspace_preview_alt()}
              width={1440}
              height={1000}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="w-full max-sm:aspect-[390/720] max-sm:object-cover max-sm:object-top"
            />
          </picture>
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
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 sm:flex sm:flex-wrap sm:gap-x-10">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-baseline gap-2">
            <dt className="min-w-0 break-words text-sm text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="order-first font-mono text-sm font-medium tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
