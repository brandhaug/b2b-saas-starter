import { type ReactNode, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BellIcon, MenuIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger
} from '@/components/ui/sheet'
import { WorkspaceNav } from '@/components/workspace-nav'
import { CommandPaletteProvider, SearchButton } from '@/components/command-palette'
import { LanguageSwitcher } from '@/components/language-switcher'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type WorkspaceViewer } from '@/lib/permissions'

const workspace = { slug: DEMO_WORKSPACE_SLUG, name: 'Starter Lab' }
const viewer = { role: 'owner' } satisfies WorkspaceViewer

export function PreviewShell({
  children,
  unreadCount
}: {
  readonly children: ReactNode
  readonly unreadCount?: number | undefined
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <CommandPaletteProvider viewer={viewer}>
      <div className="grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground"
        >
          {m.common_skip_to_content()}
        </a>
        <aside className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 lg:block">
          <WorkspaceNav workspace={workspace} viewer={viewer} />
        </aside>
        <div className="min-w-0">
          <header className="flex min-h-16 items-center gap-4 border-b border-border px-4 sm:px-6">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" className="lg:hidden">
                    <MenuIcon className="size-5" />
                    <span className="sr-only">{m.common_open_navigation()}</span>
                  </Button>
                }
              />
              <SheetContent
                side="left"
                className="flex min-h-0 flex-col gap-0 overflow-hidden bg-sidebar text-sidebar-foreground border-sidebar-border"
              >
                <SheetHeader>
                  <SheetTitle className="sr-only">
                    {m.common_workspace_navigation()}
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    {m.switch_workspace_sections()}
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                  <WorkspaceNav
                    workspace={workspace}
                    viewer={viewer}
                    onNavigate={() => setMobileNavOpen(false)}
                  />
                  <div className="mt-6 grid gap-4 border-t border-sidebar-border pt-4">
                    <SearchButton />
                    <LanguageSwitcher />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <Link
              to="/demo"
              className="min-w-0 flex-1 truncate text-sm font-medium hover:underline underline-offset-2"
            >
              {workspace.name}
            </Link>
            <div className="hidden shrink-0 md:block">
              <LanguageSwitcher />
            </div>
            <div className="hidden shrink-0 md:block">
              <SearchButton />
            </div>
            {unreadCount === undefined ? null : (
              <Badge
                variant="neutral"
                className="gap-1 font-mono tabular-nums max-md:min-h-11 max-md:min-w-11"
                render={
                  <Link
                    to="/demo/$section"
                    params={{ section: 'notifications' }}
                    aria-label={m.unread_notifications({ count: unreadCount })}
                  />
                }
              >
                <BellIcon className="size-3" />
                {unreadCount}
              </Badge>
            )}
          </header>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3 sm:px-6">
            <p className="text-sm">{m.demo_preview_notice()}</p>
            <Button
              nativeButton={false}
              variant="outline"
              size="xs"
              render={<Link to="/sign-in" />}
            >
              {m.demo_try_sign_in()}
            </Button>
          </div>
          <main id="main-content" className="px-4 py-6 sm:px-6">
            <div className="mx-auto grid w-full max-w-4xl gap-6">{children}</div>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
