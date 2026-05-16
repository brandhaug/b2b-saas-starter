import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BellIcon,
  BoxesIcon,
  LayoutDashboardIcon,
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

export function WorkspaceShell({
  children,
  title,
  description,
  unreadCount
}: {
  readonly children: ReactNode
  readonly title: string
  readonly description: string
  readonly unreadCount: number
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
        <WorkspaceNav />
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
                <WorkspaceNav onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{title}</h1>
            <p className="truncate text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <BellIcon className="size-3" />
            {unreadCount}
          </Badge>
          <ThemeToggle />
        </header>
        <main id="main-content" className="px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}

function WorkspaceNav({
  onNavigate
}: {
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
        <NavLink
          to="/workspaces/$workspaceSlug"
          label="Overview"
          icon={<LayoutDashboardIcon className="size-4" />}
          onNavigate={onNavigate}
        />
        <NavLink
          to="/workspaces/$workspaceSlug/settings"
          label="Settings"
          icon={<SettingsIcon className="size-4" />}
          onNavigate={onNavigate}
        />
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
  label,
  icon,
  onNavigate
}: {
  readonly to: '/workspaces/$workspaceSlug' | '/workspaces/$workspaceSlug/settings'
  readonly label: string
  readonly icon: ReactNode
  readonly onNavigate?: (() => void) | undefined
}) {
  return (
    <Link
      to={to}
      params={{ workspaceSlug: 'starter-lab' }}
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  )
}
