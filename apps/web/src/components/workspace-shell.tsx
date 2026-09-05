import { type ReactNode, useEffect, useState, use } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BellIcon,
  BoxesIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  MenuIcon,
  ShieldIcon,
  UserRoundIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { useServerAction } from '@/hooks/use-server-action'
import {
  signOutWithAuthClient,
  type SignOut
} from '@/components/auth/auth-client-ports'
import { authClient } from '@/lib/auth-client'
import { SearchButton } from '@/components/command-palette'
import { ImpersonationBanner } from '@/components/impersonation-banner'
import { ActionFeedback } from '@/components/page/action-feedback'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import { useImpersonation, type StopImpersonating } from '@/lib/impersonation'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  findWorkspace,
  lastVisitedWorkspace,
  rememberWorkspace,
  useWorkspaceDirectory,
  type SidebarWorkspace
} from '@/lib/workspace-directory'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import {
  SHELL_NAV,
  isWorkspaceNavTarget,
  type WorkspaceNavGroup,
  type WorkspaceNavTarget,
  type YouNavTarget
} from '@/lib/workspace-nav'

const SIGN_OUT_FAILED = 'Sign-out failed'

export { type SignOut, type StopImpersonating }

export function WorkspaceShell({
  children,
  unreadCount,
  workspaceSlug,
  viewer,
  systemRole,
  signOut = signOutWithAuthClient,
  stopImpersonating
}: {
  readonly children: ReactNode
  /**
   * Unread-notification badge count. Omit on surfaces without a workspace
   * notification feed (e.g. /admin) — no badge is rendered.
   */
  readonly unreadCount?: number
  /**
   * Current workspace slug. Pass `null` on non-workspace surfaces (e.g.
   * /admin): the sidebar then anchors to the last workspace the user visited
   * (router context) instead of emptying the column — see `sidebarWorkspace`
   * below.
   */
  readonly workspaceSlug: string | null
  /**
   * The viewer from the page's loader payload (`viewer: { role }`). The nav
   * asks `viewerCan` per gated row from this one value, so the same entries
   * are visible on every workspace page — the owner sees API tokens and
   * Webhooks on the dashboard exactly as on the webhooks page. Pass `null` on
   * surfaces without a workspace viewer; the gated rows stay hidden.
   */
  readonly viewer: Viewer
  /**
   * The signed-in user's Better Auth system role, when the route's session
   * context carries one. The "System admin" link renders only for
   * `admin` — every other role meets a 404 behind it, so the link was a dead
   * end for them.
   */
  readonly systemRole?: string | null | undefined
  readonly signOut?: SignOut
  /** The impersonation banner's one server call, forwarded for tests. */
  readonly stopImpersonating?: StopImpersonating | undefined
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Read off the route context rather than threaded in: every gated route
  // carries `session`, and the banner has to show on all of them (ADR 0054).
  const impersonation = useImpersonation()
  // The sign-out call lives at the shell level so its failure can outlive the
  // menu that triggered it — a closed dropdown must not swallow the error.
  const router = useRouter()
  const signingOut = useServerAction(
    async () => {
      await signOut()
      // The remembered workspace is session memory: the next sign-in in this
      // tab may be someone else, and they have no business seeing which
      // workspace the last session had open.
      rememberWorkspace(router, null)
      await router.navigate({ to: '/sign-in' })
    },
    { failureMessage: SIGN_OUT_FAILED, invalidate: false }
  )
  // Publish the viewer and system role to the command palette for as long as
  // this shell is mounted, so its workspace and admin entries match what the
  // signed-in role can open (and vanish on public pages, where no shell runs).
  const palette = use(CommandPaletteContext)
  useEffect(() => {
    palette?.setViewer(viewer)
    palette?.setSystemRole(systemRole ?? null)
    return () => {
      palette?.setViewer(null)
      palette?.setSystemRole(null)
    }
  }, [palette, viewer, systemRole])
  const directory = useWorkspaceDirectory()
  // The header names the workspace on every page. The directory carries the
  // display name; the slug is the fallback when the page's payload has none.
  const workspaceName =
    workspaceSlug === null
      ? null
      : (findWorkspace(directory, workspaceSlug)?.name ?? workspaceSlug)
  // The workspace the sidebar anchors to: the surface's own when it has one,
  // else the last one the user visited. `null` is the degenerate state (first
  // visit, no workspace opened yet) — the column keeps its shape and points
  // at the picker instead of pretending there is nothing to navigate.
  const sidebarWorkspace: SidebarWorkspace | null =
    workspaceSlug === null
      ? lastVisitedWorkspace(router)
      : { slug: workspaceSlug, name: workspaceName ?? workspaceSlug }
  // Remember the visited workspace (client-session memory in router context)
  // so the next non-workspace surface can anchor its sidebar to it.
  useEffect(() => {
    if (workspaceSlug === null || workspaceName === null) {
      return
    }
    rememberWorkspace(router, { slug: workspaceSlug, name: workspaceName })
  }, [router, workspaceSlug, workspaceName])
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 lg:block">
        <WorkspaceNav
          workspace={sidebarWorkspace}
          viewer={viewer}
          systemRole={systemRole}
        />
      </aside>
      <div className="min-w-0">
        {impersonation === null ? null : (
          <ImpersonationBanner
            impersonation={impersonation}
            {...(stopImpersonating === undefined ? {} : { stopImpersonating })}
          />
        )}
        <div>
          <header className="flex min-h-16 items-center gap-4 border-b border-border px-4 sm:px-6">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" className="lg:hidden">
                    <MenuIcon className="size-5" />
                    <span className="sr-only">Open navigation</span>
                  </Button>
                }
              />
              <SheetContent
                side="left"
                className="flex flex-col gap-0 bg-sidebar text-sidebar-foreground border-sidebar-border"
              >
                <SheetHeader>
                  <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
                  <SheetDescription className="sr-only">
                    Switch between workspace sections
                  </SheetDescription>
                </SheetHeader>
                <div className="p-4">
                  <WorkspaceNav
                    workspace={sidebarWorkspace}
                    viewer={viewer}
                    systemRole={systemRole}
                    onNavigate={() => setMobileNavOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
            {workspaceSlug === null ? (
              <div className="min-w-0 flex-1" />
            ) : (
              <Link
                to="/workspaces/$workspaceSlug"
                params={{ workspaceSlug }}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline underline-offset-2"
                title={workspaceName ?? workspaceSlug}
              >
                {workspaceName}
              </Link>
            )}
            <SearchButton />
            {unreadCount === undefined ? null : (
              // The badge is the notification feed's one always-visible entry
              // point: it lands on the user-level notifications route, where
              // the unread kinds are managed — same count, same label, now
              // clickable.
              <Badge
                variant="neutral"
                className="gap-1 font-mono tabular-nums"
                render={
                  <Link
                    to="/account/notifications"
                    aria-label={`${unreadCount} unread notifications`}
                  />
                }
              >
                <BellIcon className="size-3" />
                {unreadCount}
              </Badge>
            )}
            <UserMenu
              workspaceSlug={workspaceSlug}
              signingOut={signingOut}
              systemRole={systemRole}
            />
          </header>
          {signingOut.error === null ? null : (
            <div className="border-b border-border px-4 py-2 sm:px-6">
              <ActionFeedback error={signingOut.error} />
            </div>
          )}
        </div>
        {/* One content width for every shell page — the page body centers at
            `max-w-4xl` instead of each page picking its own column. */}
        <main id="main-content" className="px-4 py-6 sm:px-6">
          <div className="mx-auto grid w-full max-w-4xl gap-6">{children}</div>
        </main>
      </div>
    </div>
  )
}

/**
 * The header's account menu: the signed-in identity, Account settings, a
 * switch-workspace submenu fed by the same directory the sidebar switcher
 * reads, and sign-out. The identity line hydrates client-side — the session
 * never rides the SSR payload (see `RouteSession`).
 */
function UserMenu({
  workspaceSlug,
  signingOut,
  systemRole
}: {
  readonly workspaceSlug: string | null
  /** The shell's own sign-out action, sliced to what the menu needs. */
  readonly signingOut: {
    readonly run: () => void
    readonly pending: boolean
    readonly error: string | null
  }
  readonly systemRole?: string | null | undefined
}) {
  const session = authClient.useSession()
  const router = useRouter()
  const directory = useWorkspaceDirectory()
  const admin = systemRole === 'admin'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Open user menu" />}
      >
        <UserRoundIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          {/* The identity line: name and email, once the client session hook
              has answered; a quiet placeholder before that. */}
          <p className="truncate text-sm font-medium">
            {session.data?.user.name ?? 'Signed in'}
          </p>
          {session.data === null ? null : (
            <p className="truncate text-xs text-muted-foreground">
              {session.data.user.email}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void router.navigate({ to: '/account' })}>
          <UserRoundIcon />
          Account
        </DropdownMenuItem>
        {directory !== null && directory.length > 0 ? (
          <DropdownMenuSubmenu>
            <DropdownMenuSubmenuTrigger>Switch workspace</DropdownMenuSubmenuTrigger>
            <DropdownMenuSubmenuContent>
              {directory.map(({ workspace }) => (
                <DropdownMenuItem
                  key={workspace.id}
                  disabled={workspace.slug === workspaceSlug}
                  onClick={() =>
                    void router.navigate({
                      to: '/workspaces/$workspaceSlug',
                      params: { workspaceSlug: workspace.slug }
                    })
                  }
                >
                  <span className="min-w-0 truncate">{workspace.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubmenuContent>
          </DropdownMenuSubmenu>
        ) : null}
        {admin ? (
          <DropdownMenuItem onClick={() => void router.navigate({ to: '/admin' })}>
            <ShieldIcon />
            System admin
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut.pending}
          onClick={() => signingOut.run()}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Active and inactive treatments for nav links, kept as constants so the
 * active state reads as one statement: the page link is foreground text on
 * the sidebar's own accent plus `aria-current="page"` (set through
 * `activeProps`). Sidebar tokens, not body tokens — the sidebar separates
 * from the body independently (DESIGN.md).
 */
const navLinkClasses =
  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground'

function WorkspaceNav({
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
  // One pass over the nav table: build the visible rows in order, skipping
  // rows the viewer's role cannot read, rows that need a workspace when none
  // is in play, and the admin row for non-admins — emitting a section label
  // each time the group changes. Account and System admin are rows in the
  // same table, so they render under their own "You" label and can never
  // inherit the group printed before them.
  const navRows: Array<ReactNode> = []
  let lastGroup: WorkspaceNavGroup | undefined
  function sectionLabel(group: WorkspaceNavGroup | undefined) {
    if (group === lastGroup) {
      return
    }
    lastGroup = group
    if (group !== undefined) {
      navRows.push(
        <p
          key={`group-${group}`}
          className="px-3 pt-4 pb-1 text-2xs font-medium text-sidebar-foreground/60"
        >
          {group}
        </p>
      )
    }
  }
  for (const row of SHELL_NAV) {
    if (row.adminOnly === true && systemRole !== 'admin') {
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
        <YouNavLink
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
        {workspace === null ? (
          <Link
            to="/workspaces"
            onClick={onNavigate}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-sm font-medium text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            Choose a workspace…
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ) : (
          <WorkspaceSwitcher
            workspaceSlug={workspace.slug}
            fallbackName={workspace.name}
            onNavigate={onNavigate}
          />
        )}
      </div>
      <nav aria-label="Main" className="mt-6 grid gap-1">
        {navRows}
      </nav>
    </>
  )
}

function NavLink({
  to,
  workspaceSlug,
  label,
  icon,
  exact = false,
  onNavigate
}: {
  readonly to: WorkspaceNavTarget
  readonly workspaceSlug: string
  readonly label: string
  readonly icon: ReactNode
  readonly exact?: boolean
  readonly onNavigate?: (() => void) | undefined
}) {
  return (
    <Link
      to={to}
      params={{ workspaceSlug }}
      onClick={onNavigate}
      className={navLinkClasses}
      activeOptions={{ exact }}
      activeProps={{ 'aria-current': 'page' }}
    >
      {icon}
      {label}
    </Link>
  )
}

/** The user-level twin of {@link NavLink}: same treatments, no slug to thread. */
function YouNavLink({
  to,
  label,
  icon,
  exact = false,
  onNavigate
}: {
  readonly to: YouNavTarget
  readonly label: string
  readonly icon: ReactNode
  readonly exact?: boolean
  readonly onNavigate?: (() => void) | undefined
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={navLinkClasses}
      activeOptions={{ exact }}
      activeProps={{ 'aria-current': 'page' }}
    >
      {icon}
      {label}
    </Link>
  )
}
