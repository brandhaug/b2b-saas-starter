import { cn } from '@/lib/utils'
import { type ReactElement, type ReactNode, useState } from 'react'
import { useRender } from '@base-ui/react/use-render'
import { BellIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CommandPaletteProvider, SearchButton } from '@/components/command-palette'
import { LanguageSwitcher } from '@/components/language-switcher'
import { MobileNavSheet } from '@/components/mobile-nav-sheet'
import { WorkspaceNav } from '@/components/workspace-nav'
import { type Viewer } from '@/lib/permissions'
import { type SidebarWorkspace } from '@/lib/workspace-directory'
import { m } from '@b2b-saas-starter/i18n/messages'
import { formatNumber } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'

/**
 * The workspace chrome both shells compose: sidebar, header controls, unread
 * badge, and the main column's reading width. It holds no session, actions or
 * routes of its own. `WorkspaceShell` fills the slots with the signed-in
 * user's banner, account menu and support footer; `PreviewShell` fills them
 * with the `/demo` notice and links that stay inside the preview, so the two
 * differ only in what they pass here.
 */
export function WorkspaceChrome({
  children,
  layout = 'standard',
  workspace,
  viewer,
  systemRole,
  home,
  notifications,
  banner,
  accountMenu,
  notice,
  footer
}: {
  readonly children: ReactNode
  readonly layout?: 'standard' | 'wide' | undefined
  /** The workspace the sidebar and mobile nav anchor to. */
  readonly workspace: SidebarWorkspace | null
  readonly viewer: Viewer
  readonly systemRole: string | null
  /**
   * The header's workspace-name link, rendered with the chrome's title
   * styling (visible below `lg`, where the sidebar is hidden). `null` keeps
   * the header's spacing without a link.
   */
  readonly home: ReactElement | null
  /** The unread count and the link the badge opens; `null` hides the badge. */
  readonly notifications: {
    readonly count: number
    readonly link: ReactElement
  } | null
  /** Rendered above the header, e.g. the impersonation banner. */
  readonly banner?: ReactNode
  /** Rendered at the header's end, e.g. the account menu. */
  readonly accountMenu?: ReactNode
  /** Rendered between the header and main content. */
  readonly notice?: ReactNode
  /** Rendered after the page content inside the reading width. */
  readonly footer?: ReactNode
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <CommandPaletteProvider viewer={viewer} systemRole={systemRole}>
      <div className="grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground"
        >
          {m.common_skip_to_content()}
        </a>
        <aside className="sticky top-0 hidden h-dvh overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 lg:block">
          <WorkspaceNav workspace={workspace} viewer={viewer} systemRole={systemRole} />
        </aside>
        <div className="min-w-0">
          {banner}
          <header className="flex min-h-16 items-center gap-4 border-b border-border px-4 sm:px-6">
            <MobileNavSheet
              open={mobileNavOpen}
              onOpenChange={setMobileNavOpen}
              workspace={workspace}
              viewer={viewer}
              systemRole={systemRole}
            />
            {home === null ? (
              <div className="min-w-0 flex-1" />
            ) : (
              <HeaderHome render={home} />
            )}
            {/* The secondary controls move into the mobile sheet below md. */}
            <div className="hidden shrink-0 md:block">
              <LanguageSwitcher />
            </div>
            {/* The search control yields width first, so raised text sizes
                keep the badge and account menu on screen. */}
            <div className="hidden min-w-0 md:block">
              <SearchButton />
            </div>
            {notifications === null ? null : (
              // The badge is the notification feed's one always-visible entry
              // point: same count, same label, clickable.
              <Badge
                variant="neutral"
                typography="numeric"
                size="touch"
                className="shrink-0"
                aria-label={m.unread_notifications({ count: notifications.count })}
                render={notifications.link}
              >
                <BellIcon className="size-3" />
                {unreadBadgeLabel(notifications.count)}
              </Badge>
            )}
            {accountMenu}
          </header>
          {notice}
          {/* Forms keep a reading width; operational lists can use the available space. */}
          <main
            id="main-content"
            tabIndex={-1}
            className="px-4 py-8 sm:px-8 outline-none"
          >
            <div
              className={cn(
                'mx-auto grid w-full gap-8',
                layout === 'wide' ? 'max-w-7xl' : 'max-w-4xl'
              )}
            >
              {children}
              {footer}
            </div>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}

function HeaderHome({ render }: { readonly render: ReactElement }) {
  return useRender({
    render,
    props: {
      className:
        'min-w-0 flex-1 truncate text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4 lg:invisible'
    }
  })
}

/**
 * The header badge's visible count: locale-grouped, capped at 99+ so a busy
 * workspace's 1,284 unread notifications cannot widen the header. The
 * accessible label carries the exact number.
 */
function unreadBadgeLabel(count: number): string {
  const locale = getLocale()
  return count > 99 ? `${formatNumber(99, locale)}+` : formatNumber(count, locale)
}
