import { type ReactNode, useId } from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'

import { cn } from '@/lib/utils'

/**
 * The single workspace wrapper: the sharp card surface with an `h2` title,
 * optional description, and an action row. Every workspace panel — rosters,
 * forms, transcripts, tables — renders inside one of these, so pages read as
 * `WorkspaceShell > PageHeader + Panel(s)` end to end. Presentation only: it
 * owns no state and makes no calls.
 *
 * The `h2` names a landmark: `aria-labelledby` turns the `<section>` into a
 * region screen readers can list and jump to (`useId` is SSR-stable).
 */
export function Panel({
  title,
  description,
  actions,
  footer,
  children,
  className
}: {
  /** Omit when the page header already names the panel's content. */
  readonly title?: string
  readonly description?: string
  /** Buttons or badges aligned to the title row's far edge. */
  readonly actions?: ReactNode
  /** Trailing copy or controls under the body, such as a denied-action reason. */
  readonly footer?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}) {
  const titleId = useId()
  const hasHeader =
    title !== undefined || description !== undefined || actions !== undefined
  return (
    <section
      aria-labelledby={title === undefined ? undefined : titleId}
      className={cn(
        'grid gap-4 rounded-none border border-border bg-card p-4 text-card-foreground sm:p-6',
        className
      )}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            {title === undefined ? null : (
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
            )}
            {description === undefined ? null : (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      ) : null}
      {children}
      {footer}
    </section>
  )
}

/**
 * The list half of the resource-panel shape, and `CreateSection`'s sibling:
 * the section's `h3`, then its rows — the list, or the empty state in the
 * list's place — and an optional trailing footer (a denied-action reason, a
 * mutation's failure). Panels whose page title already names the list put the
 * create action in `Panel`'s `actions` slot and skip the heading; the rest
 * read as `Panel > CreateSection + ListSection`, so a new one copies the
 * anatomy instead of hand-rolling the heading-and-empty markup again.
 * Like `Panel`, the `h3` names a landmark region.
 */
export function ListSection({
  title,
  as: Heading = 'h3',
  footer,
  children
}: {
  readonly as?: 'h2' | 'h3'
  readonly title: string
  /** Trailing copy under the rows, such as a denied-action reason. */
  readonly footer?: ReactNode
  /** The rows, or the empty state in their place when the list is empty. */
  readonly children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="grid gap-2">
      <Heading id={titleId} className="text-sm font-semibold">
        {title}
      </Heading>
      {children}
      {footer}
    </section>
  )
}

/**
 * The create-or-reason half of the resource-panel shape: a titled form when
 * the viewer's role may create, the reason in its place when it may not.
 * `allowed` is `viewerCan(...)` at every call site — never a role name — and
 * the server re-checks the permission in the server fn regardless.
 */
export function CreateSection({
  allowed,
  title,
  deniedReason,
  children
}: {
  readonly allowed: boolean
  readonly title: string
  /** Shown in the form's place when the viewer's role cannot create. */
  readonly deniedReason: string
  readonly children: ReactNode
}) {
  const titleId = useId()
  if (!allowed) {
    // No heading, no landmark: an unnamed region is noise to a screen
    // reader's landmark list.
    return <p className="text-xs text-muted-foreground">{deniedReason}</p>
  }
  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <h3 id={titleId} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * A focused creation form opened from an explicit action.
 *
 * `allowed` is `viewerCan(...)` on the permission-gated surfaces, and the
 * reason takes the trigger's place when it is false. Both are omitted on the
 * surfaces that gate nothing — creating your own workspace is open to every
 * signed-in account — rather than inventing a refusal that cannot happen.
 */
export function CreateAction({
  allowed = true,
  title,
  deniedReason,
  children
}: {
  readonly allowed?: boolean
  readonly title: string
  /** Shown in the trigger's place when the viewer's role cannot create. */
  readonly deniedReason?: string
  readonly children: ReactNode
}) {
  if (!allowed) {
    return deniedReason === undefined ? null : (
      <p className="text-sm text-muted-foreground">{deniedReason}</p>
    )
  }
  return (
    <div className="flex justify-end">
      <Sheet>
        <SheetTrigger render={<Button />}>{title}</SheetTrigger>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 px-4 pb-6">{children}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
