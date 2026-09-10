import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BoxesIcon, ChevronsUpDownIcon } from 'lucide-react'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import {
  shellNav,
  isWorkspaceNavTarget,
  type WorkspaceNavTarget,
  type YouNavTarget
} from '@/lib/workspace-nav'
import { usePreview } from '@/lib/preview-context'
import { previewWorkspaceLocation } from '@/lib/preview-navigation'
import { m } from '@b2b-saas-starter/i18n/messages'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'

/**
 * Active and inactive treatments for nav links, kept as constants so the
 * active state reads as one statement: the page link is foreground text on
 * the sidebar's own accent plus `aria-current="page"` (set through
 * `activeProps`). The accent fill alone is under 2:1 against the sidebar, so
 * the active row also carries a one-pixel inset ring, a non-color cue that
 * clears the 3:1 floor for UI components. Mauve, because mauve means
 * current/selected (DESIGN.md), which leaves the lavender `sidebar-ring` to
 * mean focus alone; inset, so nothing shifts. Sidebar tokens otherwise, not
 * body tokens — the sidebar separates from the body independently.
 */
/** The active marker, typed here so no call site needs an assertion. */
const activeLinkProps = { 'aria-current': 'page' } satisfies {
  readonly 'aria-current': 'page'
}

const navLinkClasses =
  'flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground data-[status=active]:ring-1 data-[status=active]:ring-inset data-[status=active]:ring-primary max-md:min-h-11'

export function WorkspaceNav({
  workspace,
  viewer,
  systemRole,
  onNavigate
}: {
  /** The workspace the nav anchors to, or null in the degenerate state. */
  readonly workspace: SidebarWorkspace | null
  readonly viewer: Viewer
  readonly systemRole?: string | null | undefined
  readonly onNavigate?: (() => void) | undefined
}) {
  const preview = usePreview()
  // One pass over the nav table: build the visible rows in order, skipping
  // rows the viewer's role cannot read, rows that need a workspace when none
  // is in play, and the admin row for non-admins — emitting a section label
  // each time the group changes. Account and System admin are rows in the
  // same table, so they render under their own "You" label and can never
  // inherit the group printed before them.
  const navRows: Array<ReactNode> = []
  let lastGroup: string | undefined
  function sectionLabel(group: string | undefined) {
    if (group === lastGroup) {
      return
    }
    lastGroup = group
    if (group !== undefined) {
      navRows.push(
        <p
          key={`group-${group}`}
          className="px-3 pt-4 pb-1 font-mono text-2xs font-medium text-sidebar-foreground/60"
        >
          {group}
        </p>
      )
    }
  }
  for (const row of shellNav()) {
    if (row.adminOnly === true && (preview || systemRole !== 'admin')) {
      continue
    }
    if (row.permission !== undefined && !viewerCan(viewer, row.permission)) {
      continue
    }
    if (isWorkspaceNavTarget(row.to)) {
      // No workspace in play: the workspace rows are absent, their group
      // labels with them — the user-level rows below still render.
      if (workspace === null) {
        continue
      }
      sectionLabel(row.group)
      navRows.push(
        <NavLink
          key={row.to}
          to={row.to}
          workspaceSlug={workspace.slug}
          label={row.label}
          icon={row.icon}
          exact={row.exact ?? false}
          onNavigate={onNavigate}
        />
      )
    } else {
      sectionLabel(row.group)
      navRows.push(
        <NavLink
          key={row.to}
          to={row.to}
          label={row.label}
          icon={row.icon}
          exact={row.exact ?? false}
          onNavigate={onNavigate}
        />
      )
    }
  }

  return (
    <>
      <Link
        to="/"
        onClick={onNavigate}
        className="flex items-center gap-2 font-semibold"
      >
        <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
          <BoxesIcon className="size-4" />
        </span>
        B2B SaaS Starter
      </Link>
      {/* The switcher sits above the nav on every surface; the mobile sheet
          renders the same component, so both close on pick. Without a
          workspace in play the slot becomes the picker's doorway — the column
          keeps its shape instead of collapsing to a logo. */}
      <div className="mt-6">
        {preview ? (
          <div className="rounded-md border border-sidebar-border px-3 py-2 text-sm font-medium">
            {seedWorkspaceRecord.name}
          </div>
        ) : (
          <WorkspaceChoice workspace={workspace} onNavigate={onNavigate} />
        )}
      </div>
      <nav aria-label={m.main_navigation()} className="mt-6 grid gap-1">
        {navRows}
      </nav>
    </>
  )
}

/**
 * One nav row. A workspace row threads the slug (and follows the preview
 * shell's synthetic locations); a user-level row has no slug and, in the
 * preview, sends Account to sign-in instead.
 */
function NavLink(
  props: {
    readonly label: string
    readonly icon: ReactNode
    readonly exact?: boolean
    readonly onNavigate?: (() => void) | undefined
  } & (
    | { readonly to: WorkspaceNavTarget; readonly workspaceSlug: string }
    | { readonly to: YouNavTarget; readonly workspaceSlug?: undefined }
  )
) {
  const { label, icon, exact = false, onNavigate } = props
  const preview = usePreview()
  const treatment = {
    onClick: onNavigate,
    className: navLinkClasses,
    activeOptions: { exact },
    activeProps: activeLinkProps
  }

  if (props.workspaceSlug !== undefined) {
    const location = preview
      ? previewWorkspaceLocation(props.to)
      : { to: props.to, params: { workspaceSlug: props.workspaceSlug } }
    return (
      <Link {...location} {...treatment}>
        {icon}
        {label}
      </Link>
    )
  }

  const accountExit = preview && props.to === '/account'
  return (
    <Link
      to={accountExit ? '/sign-in' : props.to}
      reloadDocument={props.to === '/help'}
      {...treatment}
    >
      {icon}
      {accountExit ? m.demo_try_sign_in() : label}
    </Link>
  )
}

function WorkspaceChoice({
  workspace,
  onNavigate
}: {
  readonly workspace: SidebarWorkspace | null
  readonly onNavigate?: (() => void) | undefined
}) {
  if (workspace !== null) {
    return (
      <WorkspaceSwitcher
        workspaceSlug={workspace.slug}
        fallbackName={workspace.name}
        onNavigate={onNavigate}
      />
    )
  }
  return (
    <Link
      to="/workspaces"
      onClick={onNavigate}
      className="flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      {m.workspace_choose()}
      <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
