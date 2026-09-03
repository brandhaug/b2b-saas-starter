import { type ReactNode } from 'react'

/**
 * The top of every page: an optional breadcrumb slot, the `h1`, its
 * description, and an action row. The shell's top bar carries chrome only —
 * the page names itself here, which is what lets every page share one
 * `WorkspaceShell > PageHeader + Panel(s)` anatomy.
 */
export function PageHeader({
  breadcrumb,
  title,
  description,
  actions
}: {
  /** e.g. the workspace name linking back to the workspace overview. */
  readonly breadcrumb?: ReactNode
  readonly title: string
  readonly description?: string
  /** Buttons or badges aligned to the title row's far edge. */
  readonly actions?: ReactNode
}) {
  return (
    <header className="grid gap-2">
      {breadcrumb === undefined ? null : (
        <nav
          aria-label="Breadcrumb"
          className="text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground"
        >
          {breadcrumb}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* `title` on the truncated text so the full page name survives
            hover/AT even when the column is too narrow to show it. */}
        <div className="grid min-w-0 gap-1">
          <h1 className="truncate text-xl font-semibold" title={title}>
            {title}
          </h1>
          {description === undefined ? null : (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  )
}
