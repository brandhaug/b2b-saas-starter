import { type ReactNode, useEffect, useState, use } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BellIcon,
  BoxesIcon,
  LogOutIcon,
  MenuIcon,
  ShieldIcon,
  UserRoundIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { SearchButton } from '@/components/command-palette'
import { CommandPaletteContext } from '@/lib/command-palette-context'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { WORKSPACE_NAV, type WorkspaceNavTarget } from '@/lib/workspace-nav'

const SIGN_OUT_FAILED = 'Sign-out failed'

export { type SignOut }

export function WorkspaceShell({
  children,
  title,
  description,
  unreadCount,
  workspaceSlug,
  viewer,
  systemRole,
  signOut = signOutWithAuthClient
}: {
  readonly children: ReactNode
  readonly title: string
  readonly description: string
  /**
   * Unread-notification badge count. Omit on surfaces without a workspace
   * notification feed (e.g. /admin) — no badge is rendered.
   */
  readonly unreadCount?: number
  /**
   * Current workspace slug for nav links. Pass `null` on non-workspace
   * surfaces (e.g. /admin): the nav renders without the workspace links
   * instead of borrowing a workspace.
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
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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
          workspaceSlug={workspaceSlug}
          viewer={viewer}
          systemRole={systemRole}
        />
      </aside>
      <div className="min-w-0">
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
                  workspaceSlug={workspaceSlug}
                  viewer={viewer}
                  systemRole={systemRole}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            {/* `title` on the truncated text so the full page name survives
                hover/AT even when the column is too narrow to show it. */}
            <h1 className="truncate text-xl font-semibold" title={title}>
              {title}
            </h1>
            <p className="truncate text-sm text-muted-foreground" title={description}>
              {description}
            </p>
          </div>
          <SearchButton />
          {unreadCount === undefined ? null : (
            <Badge
              variant="secondary"
              className="gap-1 font-mono tabular-nums"
              aria-label={`${unreadCount} unread notifications`}
            >
              <BellIcon className="size-3" />
              {unreadCount}
            </Badge>
          )}
          <SignOutButton signOut={signOut} />
        </header>
        <main id="main-content" className="px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}

function SignOutButton({ signOut }: { readonly signOut: SignOut }) {
  const router = useRouter()
  // The hook keeps the Better Auth rejection in the error channel and never
  // rejects itself, so the busy flag clears on every path — a failed sign-out
  // can be retried instead of leaving the header stuck, and the failure is
  // reported rather than escaping as an unhandled rejection. The navigation is
  // the refresh, so there is no loader to invalidate on top of it.
  const signingOut = useServerAction(
    async () => {
      await signOut()
      await router.navigate({ to: '/sign-in' })
    },
    { failureMessage: SIGN_OUT_FAILED, invalidate: false }
  )
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        disabled={signingOut.pending}
        onClick={() => signingOut.run()}
      >
        <LogOutIcon className="size-4" />
      </Button>
      {signingOut.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {signingOut.error}
        </p>
      )}
    </>
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
  workspaceSlug,
  viewer,
  systemRole,
  onNavigate
}: {
  readonly workspaceSlug: string | null
  readonly viewer: Viewer
  readonly systemRole?: string | null | undefined
  readonly onNavigate?: (() => void) | undefined
}) {
  // One pass over the nav table: build the visible rows in order, skipping
  // rows the viewer's role cannot read.
  const navRows: Array<ReactNode> = []
  if (workspaceSlug !== null) {
    for (const row of WORKSPACE_NAV) {
      if (row.permission !== undefined && !viewerCan(viewer, row.permission)) {
        continue
      }
      navRows.push(
        <NavLink
          key={row.to}
          to={row.to}
          workspaceSlug={workspaceSlug}
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
      <nav aria-label="Workspace" className="mt-8 grid gap-1">
        {navRows}
        <Link
          to="/account"
          onClick={onNavigate}
          className={navLinkClasses}
          activeOptions={{ exact: true }}
          activeProps={{ 'aria-current': 'page' }}
        >
          <UserRoundIcon className="size-4" />
          Account
        </Link>
        {/* System admin 404s for every non-admin, so the link renders only
            for them (the route keeps its own `requireAdmin` gate — this is
            presentation, not enforcement). */}
        {systemRole === 'admin' ? (
          <Link
            to="/admin"
            onClick={onNavigate}
            className={navLinkClasses}
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            <ShieldIcon className="size-4" />
            System admin
          </Link>
        ) : null}
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
