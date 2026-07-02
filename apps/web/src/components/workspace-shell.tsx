import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  BellIcon,
  BoxesIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldIcon
} from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
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

export function WorkspaceShell({
  children,
  title,
  description,
  unreadCount,
  workspaceSlug
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
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside className="hidden border-r border-border p-4 lg:block">
        <WorkspaceNav workspaceSlug={workspaceSlug} />
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
            <SheetContent side="left" className="flex flex-col gap-0">
              <SheetHeader>
                <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Switch between workspace sections
                </SheetDescription>
              </SheetHeader>
              <div className="p-4">
                <WorkspaceNav
                  workspaceSlug={workspaceSlug}
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
            <Badge variant="secondary" className="gap-1">
              <BellIcon className="size-3" />
              {unreadCount}
            </Badge>
          )}
          <ThemeToggle />
          <SignOutButton />
        </header>
        <main id="main-content" className="px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}

function SignOutButton() {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      disabled={signingOut}
      onClick={async () => {
        setSigningOut(true)
        try {
          await authClient.signOut()
          await router.navigate({ to: '/sign-in' })
        } finally {
          setSigningOut(false)
        }
      }}
    >
      <LogOutIcon className="size-4" />
    </Button>
  )
}

function WorkspaceNav({
  workspaceSlug,
  onNavigate
}: {
  readonly workspaceSlug: string | null
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
      <nav className="mt-8 grid gap-1">
        {workspaceSlug === null ? null : (
          <>
            <NavLink
              to="/workspaces/$workspaceSlug"
              workspaceSlug={workspaceSlug}
              label="Overview"
              icon={<LayoutDashboardIcon className="size-4" />}
              onNavigate={onNavigate}
            />
            <NavLink
              to="/workspaces/$workspaceSlug/settings"
              workspaceSlug={workspaceSlug}
              label="Settings"
              icon={<SettingsIcon className="size-4" />}
              onNavigate={onNavigate}
            />
          </>
        )}
        <Link
          to="/admin"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ShieldIcon className="size-4" />
          System admin
        </Link>
      </nav>
    </>
  )
}

function NavLink({
  to,
  workspaceSlug,
  label,
  icon,
  onNavigate
}: {
  readonly to: '/workspaces/$workspaceSlug' | '/workspaces/$workspaceSlug/settings'
  readonly workspaceSlug: string
  readonly label: string
  readonly icon: ReactNode
  readonly onNavigate?: (() => void) | undefined
}) {
  return (
    <Link
      to={to}
      params={{ workspaceSlug }}
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  )
}
