import { type ReactNode, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BellIcon,
  BoxesIcon,
  CreditCardIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  UserRoundIcon,
  UsersIcon,
  WebhookIcon
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
import { authClient } from '@/lib/auth-client'
import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { useServerAction } from '@/hooks/use-server-action'
import { viewerCan, type Viewer } from '@/lib/permissions'

const SIGN_OUT_FAILED = 'Sign-out failed'

/**
 * Ending the session, as a port. Injected rather than reaching for the
 * `authClient` singleton at the call site so a test drives sign-out with a real
 * function of this shape instead of replacing `@/lib/auth-client` — which is a
 * Better Auth client with plugins attached, not something worth re-creating.
 */
export type SignOut = () => Promise<void>

/**
 * Hoisted to module scope rather than written inline as a default: a new
 * function expression per render would be a fresh prop value every time.
 */
async function signOutWithAuthClient(): Promise<void> {
  await authClient.signOut()
}

export function WorkspaceShell({
  children,
  title,
  description,
  unreadCount,
  workspaceSlug,
  viewer,
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
  readonly signOut?: SignOut
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 lg:block">
        <WorkspaceNav workspaceSlug={workspaceSlug} viewer={viewer} />
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
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{title}</h1>
            <p className="truncate text-sm text-muted-foreground">{description}</p>
          </div>
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

type WorkspaceNavTarget =
  | '/workspaces/$workspaceSlug'
  | '/workspaces/$workspaceSlug/assistant'
  | '/workspaces/$workspaceSlug/api-tokens'
  | '/workspaces/$workspaceSlug/billing'
  | '/workspaces/$workspaceSlug/members'
  | '/workspaces/$workspaceSlug/settings'
  | '/workspaces/$workspaceSlug/audit'
  | '/workspaces/$workspaceSlug/webhooks'

/**
 * The workspace nav as one table: target, label, and — for sections whose
 * read is itself a permission — the permission a viewer must hold. The nav
 * filters with `viewerCan`, the same pure `authorize()` the server guard
 * uses, so a row the viewer cannot read is absent rather than dead. Keeping
 * the permission on the row (instead of per-page booleans) is what keeps the
 * nav identical on every workspace page.
 */
const WORKSPACE_NAV: ReadonlyArray<{
  readonly to: WorkspaceNavTarget
  readonly label: string
  readonly icon: ReactNode
  readonly permission?: PermissionRequest
  /** The overview link must match exactly, or every subpage would also mark it current. */
  readonly exact?: boolean
}> = [
  {
    to: '/workspaces/$workspaceSlug',
    label: 'Overview',
    icon: <LayoutDashboardIcon className="size-4" />,
    exact: true
  },
  {
    to: '/workspaces/$workspaceSlug/members',
    label: 'Members',
    icon: <UsersIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/assistant',
    label: 'Assistant',
    icon: <SparklesIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/settings',
    label: 'Settings',
    icon: <SettingsIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/billing',
    label: 'Billing',
    icon: <CreditCardIcon className="size-4" />
  },
  {
    to: '/workspaces/$workspaceSlug/api-tokens',
    label: 'API tokens',
    icon: <KeyRoundIcon className="size-4" />,
    permission: { apiToken: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/webhooks',
    label: 'Webhooks',
    icon: <WebhookIcon className="size-4" />,
    permission: { webhook: ['list'] }
  },
  {
    to: '/workspaces/$workspaceSlug/audit',
    label: 'Audit trail',
    icon: <HistoryIcon className="size-4" />,
    permission: { auditLog: ['read'] }
  }
]

function WorkspaceNav({
  workspaceSlug,
  viewer,
  onNavigate
}: {
  readonly workspaceSlug: string | null
  readonly viewer: Viewer
  readonly onNavigate?: (() => void) | undefined
}) {
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
        B2B Starter
      </Link>
      <nav aria-label="Workspace" className="mt-8 grid gap-1">
        {workspaceSlug === null ? null : (
          <>
            {WORKSPACE_NAV.filter(
              (row) => row.permission === undefined || viewerCan(viewer, row.permission)
            ).map((row) => (
              <NavLink
                key={row.to}
                to={row.to}
                workspaceSlug={workspaceSlug}
                label={row.label}
                icon={row.icon}
                exact={row.exact ?? false}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
        <Link
          to="/account"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <UserRoundIcon className="size-4" />
          Account
        </Link>
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
      </nav>
    </>
  )
}

// Active and inactive treatments for nav links, kept as constants so the
// active state reads as one statement: the page link is foreground text on
// muted ground plus `aria-current="page"` (set through `activeProps`).
const navLinkClasses =
  'flex items-center gap-2 rounded-md px-3 py-2 text-sm data-[status=active]:bg-muted data-[status=active]:text-foreground text-muted-foreground hover:bg-muted hover:text-foreground'

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
