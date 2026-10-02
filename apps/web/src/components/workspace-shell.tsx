import { SupportDetails } from '@/components/support-details'
import { type ComponentProps, type ReactNode, useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { LogOutIcon, ShieldIcon, UserRoundIcon } from 'lucide-react'
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
import { useServerAction } from '@/hooks/use-server-action'
import { authClient } from '@/lib/auth-client'
import { CommandPaletteProvider } from '@/components/command-palette'
import { ImpersonationBanner } from '@/components/impersonation-banner'
import { ActionFeedback } from '@/components/page/action-feedback'
import { useImpersonation, type StopImpersonating } from '@/lib/impersonation'
import { adminSystemRole, type Viewer } from '@/lib/permissions'
import {
  findWorkspace,
  lastVisitedWorkspace,
  rememberWorkspace,
  useWorkspaceDirectory,
  type SidebarWorkspace
} from '@/lib/workspace-directory'
import { AppFrame } from '@/components/app-frame'
import { PreviewShell } from '@/components/preview-shell'
import { usePreview } from '@/lib/preview-context'
import { m } from '@b2b-saas-starter/i18n/messages'

export { type StopImpersonating }

export function WorkspaceShell(
  props: ComponentProps<typeof AuthenticatedWorkspaceShell>
) {
  const preview = usePreview()
  return preview ? (
    <PreviewShell unreadCount={props.unreadCount} layout={props.layout}>
      {props.children}
    </PreviewShell>
  ) : (
    <AuthenticatedWorkspaceShell {...props} />
  )
}

function AuthenticatedWorkspaceShell({
  children,
  layout = 'standard',
  unreadCount,
  workspaceSlug,
  viewer,
  systemRole,
  stopImpersonating
}: {
  readonly children: ReactNode
  readonly layout?: 'standard' | 'wide' | undefined
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
    <CommandPaletteProvider viewer={viewer} systemRole={systemRole}>
      <AppFrame
        workspace={sidebarWorkspace}
        viewer={viewer}
        systemRole={systemRole}
        unreadCount={unreadCount}
        layout={layout}
        accountMenu={
          <UserMenu
            workspaceSlug={workspaceSlug}
            signingOut={signingOut}
            systemRole={systemRole}
          />
        }
        banner={
          <>
            {impersonation === null ? null : (
              <ImpersonationBanner
                impersonation={impersonation}
                {...(stopImpersonating === undefined ? {} : { stopImpersonating })}
              />
            )}
            {signingOut.error === null ? null : (
              <div className="border-b border-border px-4 py-2 sm:px-6">
                <ActionFeedback error={signingOut.error} />
              </div>
            )}
          </>
        }
        support={
          <SupportDetails
            routeName={workspaceSlug === null ? 'application' : 'workspace'}
            workspaceId={
              workspaceSlug === null
                ? undefined
                : findWorkspace(directory, workspaceSlug)?.id
            }
          />
        }
      >
        {children}
      </AppFrame>
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
  const admin = systemRole === adminSystemRole
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
