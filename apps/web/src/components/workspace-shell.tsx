import { SupportDetails } from '@/components/support-details'
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { BellIcon, LogOutIcon, MenuIcon, ShieldIcon, UserRoundIcon } from 'lucide-react'
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
import { authClient } from '@/lib/auth-client'
import { SearchButton, CommandPaletteProvider } from '@/components/command-palette'
import { ImpersonationBanner } from '@/components/impersonation-banner'
import { ActionFeedback } from '@/components/page/action-feedback'
import { useImpersonation, type StopImpersonating } from '@/lib/impersonation'
import { type Viewer } from '@/lib/permissions'
import {
  findWorkspace,
  lastVisitedWorkspace,
  rememberWorkspace,
  useWorkspaceDirectory,
  type SidebarWorkspace
} from '@/lib/workspace-directory'
import { WorkspaceNav } from '@/components/workspace-nav'
import { PreviewShell } from '@/components/preview-shell'
import { usePreview } from '@/lib/preview-context'
import { m } from '@b2b-saas-starter/i18n/messages'
import { LanguageSwitcher } from '@/components/language-switcher'

export { type StopImpersonating }

export function WorkspaceShell(
  props: ComponentProps<typeof AuthenticatedWorkspaceShell>
) {
  const preview = usePreview()
  return preview ? (
    <PreviewShell unreadCount={props.unreadCount}>{props.children}</PreviewShell>
  ) : (
    <AuthenticatedWorkspaceShell {...props} />
  )
}

function AuthenticatedWorkspaceShell({
  children,
  unreadCount,
  workspaceSlug,
  viewer,
  systemRole,
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
      await authClient.signOut()
      // The remembered workspace is session memory: the next sign-in in this
      // tab may be someone else, and they have no business seeing which
      // workspace the last session had open.
      rememberWorkspace(router, null)
      await router.navigate({ to: '/sign-in' })
    },
    { failureMessage: m.auth_sign_out_failed(), invalidate: false }
  )
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
    // prettier-ignore
    <CommandPaletteProvider viewer={viewer} systemRole={systemRole}>
      <div className="grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground"
      >
        {m.common_skip_to_content()}
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
                    workspace={sidebarWorkspace}
                    viewer={viewer}
                    systemRole={systemRole}
                    onNavigate={() => setMobileNavOpen(false)}
                  />
                  <div className="mt-6 grid gap-4 border-t border-sidebar-border pt-4">
                    <SearchButton />
                    <LanguageSwitcher />
                  </div>
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
            {/* The secondary controls move into the mobile sheet below md. */}
            <div className="hidden shrink-0 md:block">
              <LanguageSwitcher />
            </div>
            <div className="hidden shrink-0 md:block">
              <SearchButton />
            </div>
            {unreadCount === undefined ? null : (
              // The badge is the notification feed's one always-visible entry
              // point: it lands on the user-level notifications route, where
              // the unread kinds are managed — same count, same label, now
              // clickable.
              <Badge
                variant="neutral"
                className="gap-1 font-mono tabular-nums max-md:min-h-11 max-md:min-w-11"
                render={
                  <Link
                    to="/account/notifications"
                    aria-label={m.unread_notifications({ count: unreadCount })}
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
          <div className="mx-auto grid w-full max-w-4xl gap-6">
            {children}
            <footer className="border-t border-border pt-6">
              <SupportDetails
                routeName={workspaceSlug === null ? 'application' : 'workspace'}
                workspaceId={
                  workspaceSlug === null
                    ? undefined
                    : findWorkspace(directory, workspaceSlug)?.id
                }
              />
            </footer>
          </div>
        </main>
      </div>
      </div>
    </CommandPaletteProvider>
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
        render={<Button variant="ghost" size="icon" aria-label={m.open_user_menu()} />}
      >
        <UserRoundIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          {/* The identity line: name and email, once the client session hook
              has answered; a quiet placeholder before that. */}
          <p className="truncate text-sm font-medium">
            {session.data?.user.name ?? m.signed_in()}
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
          {m.nav_account()}
        </DropdownMenuItem>
        {directory !== null && directory.length > 0 ? (
          <DropdownMenuSubmenu>
            <DropdownMenuSubmenuTrigger>
              {m.common_switch_workspace()}
            </DropdownMenuSubmenuTrigger>
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
            {m.nav_system_admin()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut.pending}
          onClick={() => signingOut.run()}
        >
          <LogOutIcon />
          {m.sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
